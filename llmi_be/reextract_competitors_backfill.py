"""Re-extract competitors for rows that died with "No output from OpenAI".

gpt-5-nano burned its whole 4096-token budget on hidden reasoning for
~10-15% of answers (finish_reason=length → empty content), and because
reasoning depth is deterministic per input, all 3 pipeline retries failed
identically — leaving {"error": "No output from OpenAI", "_retry": 3}
sentinels on rows that DO have answers. The live path now escalates to
16384 on retry; this script repairs the backlog with a single
16384-budget call per row.

Dry-run by default. Usage:
    docker exec llmi python reextract_competitors_backfill.py            # report all
    docker exec llmi python reextract_competitors_backfill.py 30         # last 30 days
    docker exec llmi python reextract_competitors_backfill.py 30 --apply
"""
import asyncio
import json
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services import openai_client
from app.services.supabase_db import db

CONCURRENCY = 20


async def _reextract_row(row: dict, ctx_cache: dict) -> tuple[str, dict | None]:
    """One row → new answer_competitors dict (or None on failure)."""
    audit_id = str(row["audit_id"])
    ctx = ctx_cache.get(audit_id)
    if ctx is None:
        own_brands, project_id, _ = await db.get_own_brands(audit_id)
        competitor_brands = await db.get_competitor_brands(audit_id)
        async with AsyncSessionLocal() as s:
            project_name = (await s.execute(text(
                "SELECT p.name FROM projects p JOIN audits a ON a.project_id = p.id WHERE a.id = :a"
            ), {"a": audit_id})).scalar() or ""
        ctx = {"own": own_brands, "comp": competitor_brands, "name": project_name}
        ctx_cache[audit_id] = ctx

    messages = openai_client.build_competitors_messages(
        row["prompt_text"] or "",
        row["answer_text"] or "",
        ctx["name"],
        ctx["own"],
        ctx["comp"],
    )
    raw = await openai_client._call_openai(
        messages,
        max_tokens=16384,
        response_format={"type": "json_schema", "json_schema": openai_client.COMPETITORS_SCHEMA},
        _operation="competitors_extract",
        model=openai_client.MODEL_COMPETITORS,
        # 16384-budget calls reason for longer — 60s default times out.
        timeout_s=150.0,
    )
    if not raw:
        return str(row["id"]), None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return str(row["id"]), None
    if not isinstance(data.get("brands"), list):
        return str(row["id"]), None
    # NUL chars in model output crash the jsonb CAST (killed the first run).
    return str(row["id"]), openai_client.strip_nul(data)


async def main() -> None:
    days = 0
    apply = "--apply" in sys.argv
    for a in sys.argv[1:]:
        if a.isdigit():
            days = int(a)

    date_cond = "AND lr.created_at > now() - make_interval(days => :d)" if days else ""
    params = {"d": days} if days else {}

    async with AsyncSessionLocal() as s:
        stats = (await s.execute(text(f"""
            SELECT date_trunc('month', lr.created_at)::date AS m, count(*) AS n
            FROM llm_responses lr
            WHERE lr.answer_competitors->>'error' = 'No output from OpenAI'
              AND NOT (lr.answer_competitors ? '_reextract_failed')
              AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
              {date_cond}
            GROUP BY 1 ORDER BY 1 DESC
        """), params)).all()
    total = sum(n for _, n in stats)
    for m, n in stats:
        print(f"  {str(m)[:7]}: {n}", flush=True)
    # ~5-8k completion tokens per repaired row at $0.40/1M (gpt-5-nano)
    print(f"rows to re-extract: {total} (est. cost ~${total * 0.0025:.0f})", flush=True)
    if not apply:
        print("DRY-RUN — nothing written. Re-run with --apply.", flush=True)
        return
    if not total:
        return

    done = failed = 0
    ctx_cache: dict = {}
    while True:
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(text(f"""
                SELECT lr.id, lr.audit_id, lr.answer_text, p.prompt_text
                FROM llm_responses lr
                LEFT JOIN prompts p ON p.id = lr.prompt_id
                WHERE lr.answer_competitors->>'error' = 'No output from OpenAI'
                  AND NOT (lr.answer_competitors ? '_reextract_failed')
                  AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
                  {date_cond}
                LIMIT 200
            """), params)).mappings().all()
        if not rows:
            break

        results: list = []
        for i in range(0, len(rows), CONCURRENCY):
            chunk = rows[i:i + CONCURRENCY]
            results.extend(await asyncio.gather(
                *[_reextract_row(dict(r), ctx_cache) for r in chunk],
                return_exceptions=True,
            ))

        updates = []
        for res in results:
            if isinstance(res, Exception):
                failed += 1
                continue
            rid, data = res
            if data is None:
                # Mark so the selection loop does not spin on permanently
                # failing rows; distinguishable from the original sentinel.
                updates.append((rid, json.dumps(
                    {"brands": [], "error": "No output from OpenAI",
                     "_retry": 3, "_reextract_failed": True})))
                failed += 1
            else:
                updates.append((rid, json.dumps(data)))
                done += 1
        for rid, payload in updates:
            # Per-row transactions: one bad payload must not kill the run.
            try:
                async with AsyncSessionLocal() as s:
                    await s.execute(text(
                        "UPDATE llm_responses SET answer_competitors = CAST(:c AS jsonb) WHERE id = :id"
                    ), {"c": payload.replace("\\u0000", ""), "id": rid})
                    await s.commit()
            except Exception as e:
                print(f"  row {rid}: write failed: {str(e)[:120]}", flush=True)
                if '"_reextract_failed"' not in payload:
                    failed += 1
                    done = max(0, done - 1)
                try:
                    async with AsyncSessionLocal() as s:
                        await s.execute(text(
                            "UPDATE llm_responses SET answer_competitors = CAST(:c AS jsonb) WHERE id = :id"
                        ), {"c": json.dumps({"brands": [], "error": "No output from OpenAI",
                                             "_retry": 3, "_reextract_failed": True}), "id": rid})
                        await s.commit()
                except Exception:
                    pass
        print(f"progress: {done} re-extracted, {failed} failed", flush=True)

    print(f"DONE: {done} re-extracted, {failed} failed", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
