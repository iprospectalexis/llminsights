"""Re-link orphaned llm_responses/citations to prompts after a project edit.

The old project-edit flow deleted and re-inserted ALL prompts; the
llm_responses/citations FKs are ON DELETE SET NULL, so every historical
answer and citation lost its prompt (and prompt group) — by-group widgets
went empty. This script matches each orphaned response back to a current
prompt by the prompt text kept inside raw_response_data, restores
prompt_id, and rebuilds the project's orphaned citations from the stored
per-response JSON (citations / all_sources / links_attached / organic).

Dry-run by default. Usage (inside the llmi container or venv):
    python relink_prompts_backfill.py <project_id>            # report
    python relink_prompts_backfill.py <project_id> --apply    # fix
"""
import asyncio
import json
import ssl
import sys

import asyncpg

from app.api.v1.endpoints.audits import collect_citations
from app.services.prompt_augmentation import strip_known_provider_suffixes
from app.config import get_settings

settings = get_settings()

BATCH = 200


def _norm(text: str) -> str:
    t = strip_known_provider_suffixes(text or "")
    return " ".join(t.split()).casefold()


def _strip_group_prefix(text: str) -> str:
    """Old prompts sometimes carried the group baked into the text
    ("choix:quelles chaussures..."); strip one short leading prefix."""
    import re
    return re.sub(r"^\s*[^:;]{1,40}[:;]\s*", "", text or "", count=1)


def _dsn() -> str:
    # SQLAlchemy-style URL → plain asyncpg DSN (ssl passed explicitly).
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://").split("?")[0]


async def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("usage: relink_prompts_backfill.py <project_id> [--apply]")
        return
    project_id = args[0]
    apply = "--apply" in sys.argv

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(_dsn(), ssl=sslctx, command_timeout=300)
    try:
        prompts = await conn.fetch(
            "SELECT id, prompt_text FROM prompts WHERE project_id = $1", project_id)
        by_norm = {}
        for p in prompts:
            by_norm.setdefault(_norm(p["prompt_text"]), p["id"])
        # Prefix-stripped variants as fallback keys (never shadow exact ones).
        for p in prompts:
            key = _norm(_strip_group_prefix(p["prompt_text"]))
            if key:
                by_norm.setdefault(key, p["id"])
        print(f"project prompts: {len(prompts)}", flush=True)

        rows = await conn.fetch("""
            SELECT lr.id, lr.audit_id, lr.llm, lr.run_index, lr.created_at,
                   lr.raw_response_data->>'prompt' AS ptext
            FROM llm_responses lr
            JOIN audits a ON a.id = lr.audit_id
            WHERE a.project_id = $1 AND lr.prompt_id IS NULL
              AND lr.raw_response_data IS NOT NULL
        """, project_id)
        matched, unmatched = [], 0
        for r in rows:
            pid = by_norm.get(_norm(r["ptext"] or ""))
            if pid is None:
                stripped = _norm(_strip_group_prefix(r["ptext"] or ""))
                pid = by_norm.get(stripped) if stripped else None
            if pid is None:
                unmatched += 1
            else:
                matched.append((r, pid))
        no_raw = await conn.fetchval("""
            SELECT count(*) FROM llm_responses lr JOIN audits a ON a.id = lr.audit_id
            WHERE a.project_id = $1 AND lr.prompt_id IS NULL AND lr.raw_response_data IS NULL
        """, project_id)
        orphan_cits = await conn.fetchval("""
            SELECT count(*) FROM citations c JOIN audits a ON a.id = c.audit_id
            WHERE a.project_id = $1 AND c.prompt_id IS NULL
        """, project_id)
        print(f"orphaned responses: {len(rows)} with raw (+{no_raw} without raw), "
              f"matched to prompts: {len(matched)}, unmatched: {unmatched}", flush=True)
        print(f"orphaned citations: {orphan_cits}", flush=True)

        if not apply:
            print("DRY-RUN — nothing written. Re-run with --apply.", flush=True)
            return

        # 1. Restore prompt_id on responses.
        for i in range(0, len(matched), BATCH):
            chunk = matched[i:i + BATCH]
            await conn.executemany(
                "UPDATE llm_responses SET prompt_id = $2 WHERE id = $1",
                [(r["id"], pid) for r, pid in chunk])
        print(f"relinked {len(matched)} responses", flush=True)

        # 2. Drop the project's orphaned citations (unrecoverable per-prompt)
        #    and rebuild them from each relinked response's stored JSON.
        while True:
            n = await conn.fetchval("""
                WITH del AS (
                    DELETE FROM citations WHERE id IN (
                        SELECT c.id FROM citations c
                        JOIN audits a ON a.id = c.audit_id
                        WHERE a.project_id = $1 AND c.prompt_id IS NULL
                        LIMIT 5000)
                    RETURNING 1
                ) SELECT count(*) FROM del""", project_id)
            if not n:
                break
            print(f"deleted {n} orphaned citations...", flush=True)

        total_cits = 0
        for i in range(0, len(matched), 50):
            chunk = matched[i:i + 50]
            details = await conn.fetch("""
                SELECT id, citations, all_sources, links_attached, organic_results,
                       raw_response_data->'sources' AS sources
                FROM llm_responses WHERE id = ANY($1)
            """, [r["id"] for r, _ in chunk])
            det_by_id = {d["id"]: d for d in details}
            new_rows = []
            for r, pid in chunk:
                d = det_by_id.get(r["id"])
                if d is None:
                    continue
                def _j(v):
                    if v is None:
                        return None
                    return json.loads(v) if isinstance(v, str) else v
                record = {
                    "citations": _j(d["citations"]),
                    "all_sources": _j(d["all_sources"]),
                    "links_attached": _j(d["links_attached"]),
                    "organic": _j(d["organic_results"]),
                    "sources": _j(d["sources"]),
                }
                cits = collect_citations(record, {
                    "audit_id": r["audit_id"], "prompt_id": pid,
                    "llm": r["llm"], "run_index": r["run_index"] or 1,
                })
                for c in cits:
                    c["checked_at"] = r["created_at"]  # keep original timeline
                new_rows.extend(cits)
            if new_rows:
                await conn.executemany("""
                    INSERT INTO citations (audit_id, prompt_id, llm, run_index,
                        page_url, domain, citation_text, position, checked_at, cited)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                """, [(c["audit_id"], c["prompt_id"], c["llm"], c["run_index"],
                       c["page_url"], c["domain"], c["citation_text"], c["position"],
                       c["checked_at"], c.get("cited")) for c in new_rows])
            total_cits += len(new_rows)
            print(f"  rebuilt citations: {total_cits}", flush=True)

        print(f"DONE: {len(matched)} responses relinked, {total_cits} citations rebuilt, "
              f"{unmatched + no_raw} responses left orphaned", flush=True)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
