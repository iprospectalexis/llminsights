"""Repair Google AI Overview citations corrupted by the BrightData path.

Two problems are fixed retroactively:
1. Junk rows: organic entries were recorded via their `url` field, which for
   BrightData is the SERP's own URL — thousands of google.com/search?q=...
   "citations". These are deleted everywhere (they are never legitimate).
2. Missing real references: the converter only parsed page_html CSS classes
   (KEVENd/NDNGvf) which rarely match, and collect_citations never read the
   converted `citations` field. Re-extracts from the retained merged raw
   files using the fixed converter (native aio_citations first) and rebuilds
   citations rows + llm_responses.citations/all_sources.

Dry-run by default. Usage:
    docker exec llmi python fix_aio_citations_backfill.py 7           # report
    docker exec llmi python fix_aio_citations_backfill.py 7 --apply   # fix
"""
import asyncio
import glob
import json
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.supabase_db import db
from app.services.json_converter import convert_google_aio_record
from app.api.v1.endpoints.audits import collect_citations

RESULTS_DIR = "/app/results"
JUNK_WHERE = (
    "llm IN ('google-ai-overview', 'google-ai-mode') "
    "AND page_url ~* '^https?://(www\\.)?google\\.[a-z.]+(/|$)'"
)


def _norm_prompt(p: str) -> str:
    return " ".join((p or "").split()).casefold()


async def main() -> None:
    days = 7
    apply = "--apply" in sys.argv
    for a in sys.argv[1:]:
        if a.isdigit():
            days = int(a)

    async with AsyncSessionLocal() as s:
        junk = (await s.execute(text(
            f"SELECT count(*) FROM citations WHERE {JUNK_WHERE}"
        ))).scalar()
        print(f"junk google-internal citation rows (all time): {junk}", flush=True)

        rows = (await s.execute(text("""
            SELECT lr.id, lr.audit_id, lr.prompt_id, lr.run_index, lr.job_id,
                   p.prompt_text
            FROM llm_responses lr
            JOIN prompts p ON p.id = lr.prompt_id
            JOIN audits a ON a.id = lr.audit_id
            WHERE lr.llm = 'google-ai-overview'
              AND lr.job_id IS NOT NULL
              AND a.created_at > now() - make_interval(days => :d)
        """), {"d": days})).mappings().all()

    by_job: dict = {}
    for r in rows:
        by_job.setdefault(r["job_id"], []).append(dict(r))
    print(f"AIO responses in last {days}d: {len(rows)} across {len(by_job)} jobs", flush=True)

    shown_shape = False
    total_updated = total_cits = files_missing = 0
    for job_id, resps in by_job.items():
        merged = [
            f for f in glob.glob(f"{RESULTS_DIR}/{job_id}_*.json")
            if "_converted" not in f
        ]
        if not merged:
            files_missing += 1
            continue
        try:
            with open(merged[0], encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as e:
            print(f"  job {job_id}: cannot read {merged[0]}: {e}", flush=True)
            continue
        if not isinstance(data, list):
            continue

        by_prompt: dict = {}
        for item in data:
            if isinstance(item, dict) and item.get("keyword"):
                by_prompt[_norm_prompt(item["keyword"])] = item
                if not shown_shape:
                    shown_shape = True
                    print("  sample raw aio_citations:",
                          repr(item.get("aio_citations"))[:400], flush=True)

        updates = []
        del_keys = []
        new_cits = []
        for resp in resps:
            item = by_prompt.get(_norm_prompt(resp["prompt_text"]))
            if item is None:
                continue
            record = convert_google_aio_record(item)
            cits = collect_citations(record, {
                "audit_id": resp["audit_id"],
                "prompt_id": resp["prompt_id"],
                "llm": "google-ai-overview",
                "run_index": resp["run_index"] or 1,
            })
            updates.append({
                "id": str(resp["id"]),
                "citations": json.dumps(record["citations"]) if record.get("citations") else None,
                "all_sources": json.dumps(record["all_sources"], ensure_ascii=False) if record.get("all_sources") else None,
            })
            del_keys.append({
                "audit_id": resp["audit_id"], "prompt_id": resp["prompt_id"],
                "llm": "google-ai-overview", "run_index": resp["run_index"] or 1,
            })
            new_cits.extend(cits)

        if apply and updates:
            async with AsyncSessionLocal() as s:
                for u in updates:
                    await s.execute(text(
                        "UPDATE llm_responses SET citations = :c, all_sources = :a WHERE id = :id"
                    ), {"c": u["citations"], "a": u["all_sources"], "id": u["id"]})
                await s.commit()
            await db.delete_citations_batch(del_keys)
            await db.insert_citations_batch(new_cits)
        total_updated += len(updates)
        total_cits += len(new_cits)
        print(f"  job {job_id}: {len(updates)} responses re-extracted, "
              f"{len(new_cits)} citations{'' if apply else ' (dry-run)'}", flush=True)

    if apply:
        async with AsyncSessionLocal() as s:
            res = await s.execute(text(f"DELETE FROM citations WHERE {JUNK_WHERE}"))
            await s.commit()
            print(f"deleted {res.rowcount} junk google-internal rows", flush=True)

    print(f"DONE{' (dry-run — nothing written)' if not apply else ''}: "
          f"{total_updated} responses, {total_cits} citations rebuilt, "
          f"{files_missing} jobs without raw files", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
