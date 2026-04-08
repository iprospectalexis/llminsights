"""Recover SearchGPT responses lost to a premature `polling_timeout` sweep.

Targets a single audit (Balenciaga_AUDIT_FR_non branded, audit_id
`d9193654-2c91-4794-a5a7-12176334afef`) where on 2026-04-08 all 145
SearchGPT rows were marked `poll_terminal_reason='polling_timeout'` with
`poll_attempts=0` because the global `POLLING_MAX_MINUTES=10` deadline
fired while the OneSearch batch job was still running. The bug was
fixed in commit c0d3a6d (deadline bumped to 90m, sentinel removed) but
the historical rows still need to be backfilled.

Recovery strategy:

  1. Find every SearchGPT row in the audit that has the polling_timeout
     sentinel and a job_id.
  2. Group by job_id, hit OneSearch `/api/v1/jobs/{job_id}` to confirm
     the job is still in `completed` state and the converted results
     blob is still on disk.
  3. Pull `/api/v1/jobs/{job_id}/results?format=converted`, match each
     result back to its prompt by prompt text (same matching logic as
     `audit_pipeline.handle_polling`), and build per-row update
     payloads (answer_text, raw_response_data, citations, ...).
  4. In one transaction per row: clear `poll_terminal_reason`, wipe the
     sentinel `raw_response_data`, write the real response.
  5. Optionally re-arm the audit by setting
     `pipeline_state='extracting_competitors'` + `status='running'` so
     the scheduler re-runs competitor extraction + sentiment for the
     newly-recovered rows.

Defaults to DRY-RUN. Pass `--apply` to actually write. Pass
`--resume-pipeline` (only with --apply) to re-arm the audit afterwards.

MUST be run inside the `llmi` container (or anywhere with network
access to the OneSearch host the backend is configured to use):

    docker compose exec llmi python /app/recover_fr_searchgpt.py
    docker compose exec llmi python /app/recover_fr_searchgpt.py --apply
    docker compose exec llmi python /app/recover_fr_searchgpt.py --apply --resume-pipeline
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import ssl
import sys
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import asyncpg
import httpx


def extract_domain(url: str) -> str:
    try:
        return urlparse(url).hostname.replace("www.", "")
    except Exception:
        return url


def collect_citations_for_searchgpt(matched: dict, audit_id: str, prompt_id: str) -> list[dict]:
    """Mirror of audits.collect_citations for the searchgpt branch only.

    SearchGPT path checks `links_attached` first, falls back to `citations`.
    Each citation dict gets the same shape as the live pipeline so that
    downstream readers (citation analytics, metrics) see no difference.
    """
    out: list[dict] = []
    base = {
        "audit_id":   audit_id,
        "prompt_id":  prompt_id,
        "llm":        LLM,
        "checked_at": datetime.now(timezone.utc),
    }

    def _add(url, text, position, cited=None):
        out.append({
            **base,
            "page_url":      url,
            "domain":        extract_domain(url),
            "citation_text": text or "No description available",
            "position":      position,
            **({"cited": cited} if cited is not None else {}),
        })

    if matched.get("links_attached"):
        for i, link in enumerate(matched["links_attached"]):
            _add(
                link.get("url", ""),
                link.get("text") or link.get("title"),
                link.get("position", i + 1),
                link.get("cited"),
            )
    elif matched.get("citations"):
        for i, cit in enumerate(matched["citations"]):
            _add(
                cit.get("url", ""),
                cit.get("text") or cit.get("title"),
                i + 1,
                cit.get("cited"),
            )
    return out


# ── Config ──────────────────────────────────────────────────────────────

AUDIT_ID = "d9193654-2c91-4794-a5a7-12176334afef"  # Balenciaga_AUDIT_FR_non branded
LLM = "searchgpt"
SENTINEL_REASON = "polling_timeout"

# Postgres DSN — same Supabase pooler the backend uses. Can be overridden
# via DATABASE_URL env var (which is what the backend itself reads).
DEFAULT_DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)

# OneSearch — read from the same env vars the backend uses, with safe
# defaults for the in-container setup.
ONESEARCH_URL = os.environ.get("ONESEARCH_API_URL", "http://localhost:8002")
ONESEARCH_KEY = os.environ.get("ONESEARCH_API_KEY", "")


# ── OneSearch client ────────────────────────────────────────────────────

async def fetch_onesearch_results(client: httpx.AsyncClient, job_id: str) -> tuple[str, Optional[list[dict]]]:
    """Returns (status, results_or_None). Mirrors audits.fetch_onesearch_results."""
    headers = {"X-API-Key": ONESEARCH_KEY} if ONESEARCH_KEY else {}

    status_resp = await client.get(
        f"{ONESEARCH_URL}/api/v1/jobs/{job_id}", headers=headers, timeout=30.0
    )
    if status_resp.status_code == 404:
        return ("not_found", None)
    status_resp.raise_for_status()
    sd = status_resp.json()
    job_status = sd.get("status")

    if job_status in ("failed", "Failed"):
        return ("failed", None)
    if job_status != "completed" or not sd.get("converted_results_file"):
        return (job_status or "unknown", None)

    results_resp = await client.get(
        f"{ONESEARCH_URL}/api/v1/jobs/{job_id}/results?format=converted",
        headers=headers,
        timeout=120.0,
    )
    results_resp.raise_for_status()
    data = results_resp.json()
    results = data.get("results", data) if isinstance(data, dict) else data
    return ("completed", results)


# ── DB helpers ──────────────────────────────────────────────────────────

async def fetch_target_rows(conn: asyncpg.Connection) -> list[dict[str, Any]]:
    """Pull every SearchGPT row in the audit that's stuck on polling_timeout."""
    rows = await conn.fetch(
        """
        SELECT r.id, r.prompt_id, r.job_id, r.poll_terminal_reason,
               r.poll_attempts, r.answer_text IS NOT NULL AS has_answer,
               r.raw_response_data, p.prompt_text
        FROM llm_responses r
        LEFT JOIN prompts p ON p.id = r.prompt_id
        WHERE r.audit_id = $1
          AND r.llm = $2
          AND r.poll_terminal_reason = $3
        ORDER BY r.created_at
        """,
        AUDIT_ID, LLM, SENTINEL_REASON,
    )
    return [dict(r) for r in rows]


async def apply_update(conn: asyncpg.Connection, row_id: str, update: dict[str, Any]) -> None:
    """Atomically restore one row: clear sentinel, write real data."""
    await conn.execute(
        """
        UPDATE llm_responses
        SET poll_terminal_reason   = NULL,
            answer_text            = $2,
            answer_text_markdown   = $3,
            response_url           = $4,
            response_timestamp     = $5,
            raw_response_data      = $6,
            web_search_query       = $7,
            citations              = $8,
            all_sources            = $9,
            links_attached         = $10,
            last_polled_at         = now()
        WHERE id = $1
        """,
        row_id,
        update.get("answer_text"),
        update.get("answer_text_markdown"),
        update.get("response_url"),
        update.get("response_timestamp"),
        json.dumps(update["raw_response_data"]) if update.get("raw_response_data") is not None else None,
        update.get("web_search_query"),
        update.get("citations"),
        update.get("all_sources"),
        update.get("links_attached"),
    )


async def reinsert_citations(
    conn: asyncpg.Connection, audit_id: str, prompt_id: str, matched: dict
) -> int:
    """Delete-then-insert citations for one row. Returns number inserted.

    Uses the exact same shape as `collect_citations` in the backend so the
    recovered rows are indistinguishable from a normal pipeline run.
    """
    await conn.execute(
        "DELETE FROM citations WHERE audit_id=$1 AND prompt_id=$2 AND llm=$3",
        audit_id, prompt_id, LLM,
    )
    citations = collect_citations_for_searchgpt(matched, audit_id, prompt_id)
    inserted = 0
    for c in citations:
        if not c.get("page_url"):
            continue
        try:
            await conn.execute(
                """
                INSERT INTO citations
                  (audit_id, prompt_id, llm, page_url, domain, citation_text,
                   position, cited, checked_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                c["audit_id"], c["prompt_id"], c["llm"],
                c["page_url"], c["domain"], c["citation_text"],
                c["position"], c.get("cited"), c["checked_at"],
            )
            inserted += 1
        except Exception as e:
            print(f"    [citations] insert failed for {c['page_url'][:60]}: {e}")
    return inserted


async def resume_pipeline(conn: asyncpg.Connection) -> None:
    """Re-arm the audit so the scheduler re-runs extraction + sentiment."""
    await conn.execute(
        """
        UPDATE audits
        SET status         = 'running',
            pipeline_state = 'extracting_competitors',
            current_step   = 'extracting_competitors',
            error_message  = NULL,
            finished_at    = NULL,
            last_activity_at = now()
        WHERE id = $1
        """,
        AUDIT_ID,
    )


# ── Main ────────────────────────────────────────────────────────────────

async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry run)")
    parser.add_argument(
        "--resume-pipeline",
        action="store_true",
        help="Re-arm the audit (status=running, pipeline_state=extracting_competitors). Requires --apply.",
    )
    args = parser.parse_args()

    if args.resume_pipeline and not args.apply:
        print("--resume-pipeline requires --apply")
        return 2

    print(f"=== Recovery for audit {AUDIT_ID} ({LLM}) ===")
    print(f"OneSearch: {ONESEARCH_URL}  (key configured: {bool(ONESEARCH_KEY)})")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}"
          f"{'  + RESUME PIPELINE' if args.resume_pipeline else ''}")
    print()

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    dsn = os.environ.get("DATABASE_URL", DEFAULT_DSN)
    conn = await asyncpg.connect(dsn, ssl=sslctx)

    try:
        # 1) Pull target rows
        rows = await fetch_target_rows(conn)
        print(f"[1] Found {len(rows)} SearchGPT rows with poll_terminal_reason='{SENTINEL_REASON}'")
        if not rows:
            print("    Nothing to do.")
            return 0

        # Distinct job_ids
        job_ids = sorted({r["job_id"] for r in rows if r["job_id"]})
        rows_without_job = [r for r in rows if not r["job_id"]]
        print(f"    Distinct job_ids: {len(job_ids)} → {job_ids}")
        if rows_without_job:
            print(f"    !! {len(rows_without_job)} rows have NO job_id — unrecoverable, will skip")

        # 2) Fetch each job from OneSearch
        async with httpx.AsyncClient() as client:
            job_results: dict[str, list[dict]] = {}
            for jid in job_ids:
                print(f"\n[2] OneSearch GET job {jid} ...")
                try:
                    status, results = await fetch_onesearch_results(client, jid)
                except Exception as e:
                    print(f"    !! HTTP error: {e}")
                    continue
                print(f"    status={status}, results_count={len(results) if results else 0}")
                if results:
                    job_results[jid] = results

        if not job_results:
            print("\n!! No usable job results from OneSearch. Likely the job's "
                  "converted_results_file has been GC'd. Recovery impossible.")
            print("   Recommendation: re-run the audit from scratch.")
            return 1

        # 3) Match results to rows by prompt text
        print(f"\n[3] Matching {sum(len(v) for v in job_results.values())} provider results "
              f"to {len(rows)} target rows by prompt text ...")

        matched_updates: list[tuple[str, str, dict, dict]] = []  # (row_id, prompt_id, update, raw_match)
        unmatched_rows: list[dict] = []

        for r in rows:
            jid = r["job_id"]
            if not jid or jid not in job_results:
                unmatched_rows.append(r)
                continue
            prompt_text = r.get("prompt_text") or ""
            matched = next(
                (m for m in job_results[jid] if m.get("prompt") == prompt_text),
                None,
            )
            if not matched:
                unmatched_rows.append(r)
                continue

            update = {
                "response_url": matched.get("url"),
                "answer_text": matched.get("answer_text"),
                "answer_text_markdown": matched.get("answer_text_markdown"),
                "response_timestamp": datetime.now(timezone.utc),
                "raw_response_data": matched,
                "web_search_query": matched.get("web_search_query"),
                "citations": json.dumps(matched["citations"]) if matched.get("citations") else None,
                "all_sources": json.dumps(matched["all_sources"]) if matched.get("all_sources") else None,
                "links_attached": json.dumps(matched["links_attached"]) if matched.get("links_attached") else None,
            }
            matched_updates.append((str(r["id"]), str(r["prompt_id"]), update, matched))

        print(f"    matched   = {len(matched_updates)}")
        print(f"    unmatched = {len(unmatched_rows)}")
        if unmatched_rows[:3]:
            print("    sample unmatched prompts:")
            for r in unmatched_rows[:3]:
                pt = (r.get("prompt_text") or "")[:80]
                print(f"      - row {r['id']}  prompt={pt!r}")

        # Sample one matched row for verification
        if matched_updates:
            sample = matched_updates[0]
            ans = (sample[2].get("answer_text") or "")[:160]
            print(f"\n[3a] Sample matched row {sample[0]}:")
            print(f"     answer_text[:160] = {ans!r}")
            print(f"     has citations    = {bool(sample[3].get('citations'))}")
            print(f"     has all_sources  = {bool(sample[3].get('all_sources'))}")

        # 4) Apply
        if not args.apply:
            print("\n[4] DRY-RUN — not writing. Re-run with --apply to commit.")
            return 0

        print(f"\n[4] Applying {len(matched_updates)} row updates ...")
        cit_total = 0
        for i, (row_id, prompt_id, update, matched) in enumerate(matched_updates, 1):
            try:
                async with conn.transaction():
                    await apply_update(conn, row_id, update)
                    inserted = await reinsert_citations(conn, AUDIT_ID, prompt_id, matched)
                    cit_total += inserted
            except Exception as e:
                print(f"    !! row {row_id} failed: {e}")
                continue
            if i % 25 == 0 or i == len(matched_updates):
                print(f"    {i}/{len(matched_updates)} rows updated, {cit_total} citations inserted")

        # 5) Resume pipeline
        if args.resume_pipeline:
            print("\n[5] Re-arming audit (status=running, pipeline_state=extracting_competitors) ...")
            await resume_pipeline(conn)
            print("    Done. Next scheduler tick will pick it up.")
        else:
            print("\n[5] Skipped pipeline resume. The audit stays at status='completed' "
                  "but with patched SearchGPT data. Pass --resume-pipeline to also re-run "
                  "competitor extraction + sentiment for the recovered rows.")

        # Final state check
        final = await conn.fetchrow(
            """
            SELECT
              count(*) FILTER (WHERE answer_text IS NOT NULL) AS with_answer,
              count(*) FILTER (WHERE poll_terminal_reason IS NOT NULL) AS still_terminal,
              count(*) AS total
            FROM llm_responses
            WHERE audit_id = $1 AND llm = $2
            """,
            AUDIT_ID, LLM,
        )
        print(f"\n=== Final SearchGPT row state for audit {AUDIT_ID} ===")
        print(f"  total          = {final['total']}")
        print(f"  with_answer    = {final['with_answer']}")
        print(f"  still_terminal = {final['still_terminal']}")
        return 0

    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
