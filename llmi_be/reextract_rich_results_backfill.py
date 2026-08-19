"""Re-extract competitors for responses that carry rich result blocks.

Responses collected after the rich-results deploy but extracted BEFORE the
rich-digest change had their brands pulled from answer_text only — the ad
advertiser, shopping merchants and place brands were invisible. Re-runs
extraction with the block digest attached (extract_competitors handles the
luna/effort-none path, prefilter and NUL stripping internally).

Dry-run by default. Usage:
    docker exec llmi python reextract_rich_results_backfill.py
    docker exec llmi python reextract_rich_results_backfill.py --apply
"""
import asyncio
import json
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services import openai_client
from app.services.audit_pipeline import _rich_digest_from_row
from app.services.supabase_db import db

CONCURRENCY = 15

SELECT_ROWS = """
    SELECT lr.id, lr.audit_id, lr.answer_text, p.prompt_text,
           lr.shopping, lr.map_places, lr.business_locations, lr.ads
    FROM llm_responses lr
    LEFT JOIN prompts p ON p.id = lr.prompt_id
    WHERE (lr.ads IS NOT NULL
           OR jsonb_array_length(coalesce(lr.shopping, '[]'::jsonb)) > 0
           OR jsonb_array_length(coalesce(lr.map_places, '[]'::jsonb)) > 0
           OR jsonb_array_length(coalesce(lr.business_locations, '[]'::jsonb)) > 0)
      AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
"""


async def _one(row: dict, ctx_cache: dict) -> tuple[str, dict | None]:
    audit_id = str(row["audit_id"])
    ctx = ctx_cache.get(audit_id)
    if ctx is None:
        own_brands, _, _ = await db.get_own_brands(audit_id)
        competitor_brands = await db.get_competitor_brands(audit_id)
        name = await db.get_project_name(audit_id)
        ctx = {"own": own_brands, "comp": competitor_brands, "name": name or ""}
        ctx_cache[audit_id] = ctx
    result = await openai_client.extract_competitors(
        row["prompt_text"] or "",
        row["answer_text"] or "",
        industry=ctx["name"],
        known_brands=ctx["own"],
        known_competitors=ctx["comp"],
        rich_context=_rich_digest_from_row(row),
    )
    if result.get("error"):
        return str(row["id"]), None
    return str(row["id"]), result


async def main() -> None:
    apply = "--apply" in sys.argv
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(text(SELECT_ROWS))).mappings().all()
    print(f"responses with rich blocks: {len(rows)}", flush=True)
    if not apply:
        print("DRY-RUN — nothing written. Re-run with --apply.", flush=True)
        return

    done = failed = block_brands = 0
    ctx_cache: dict = {}
    for i in range(0, len(rows), CONCURRENCY):
        chunk = rows[i:i + CONCURRENCY]
        results = await asyncio.gather(
            *[_one(dict(r), ctx_cache) for r in chunk], return_exceptions=True)
        async with AsyncSessionLocal() as s:
            for res in results:
                if isinstance(res, Exception) or res[1] is None:
                    failed += 1
                    continue
                rid, data = res
                block_brands += sum(
                    1 for b in data.get("brands", [])
                    if b.get("mention_type") in ("shopping", "sponsored", "place"))
                await s.execute(text(
                    "UPDATE llm_responses SET answer_competitors = CAST(:c AS jsonb) WHERE id = :id"
                ), {"c": json.dumps(data).replace("\\u0000", ""), "id": rid})
                done += 1
            await s.commit()
        print(f"progress: {done} done, {failed} failed, {block_brands} block-sourced brands", flush=True)

    print(f"DONE: {done} re-extracted, {failed} failed, "
          f"{block_brands} brands came from rich blocks", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
