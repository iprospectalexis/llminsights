"""
One-off backfill for DAZN audit 5f55e516-3b0d-462f-9fa4-191f0010cc80.

280 rows were marked provider_dropped due to exact-string prompt matching.
This script fetches results from OneSearch API using the actual job IDs,
matches by normalized prompt text, and fills in missing data.

Usage (on VPS):
    docker exec llmi python backfill_dazn_dropped.py
"""
import asyncio
import json
import unicodedata
from datetime import datetime, timezone

import httpx
from sqlalchemy import text

from app.database import async_engine
from app.config import get_settings

settings = get_settings()

AUDIT_ID = "5f55e516-3b0d-462f-9fa4-191f0010cc80"


def normalize(s: str) -> str:
    """Normalize prompt text for matching."""
    return " ".join(unicodedata.normalize("NFC", s.strip()).split())


async def fetch_onesearch_results(job_id: str) -> list[dict]:
    """Fetch converted results from OneSearch API."""
    url = settings.onesearch_api_url
    key = settings.onesearch_api_key
    headers = {}
    if key:
        headers["X-API-Key"] = key

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(f"{url}/api/v1/jobs/{job_id}", headers=headers)
        resp.raise_for_status()
        status = resp.json()
        print(f"  Job {job_id[:12]}: status={status.get('status')}, "
              f"prompts={status.get('total_prompts')}")

        if status.get("status") != "completed":
            print(f"  WARNING: job not completed, skipping")
            return []

        results_resp = await client.get(
            f"{url}/api/v1/jobs/{job_id}/results?format=converted", headers=headers
        )
        results_resp.raise_for_status()
        data = results_resp.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        print(f"  Fetched {len(results)} results")
        return results


async def main():
    print(f"=== DAZN Audit Backfill ===")
    print(f"Audit: {AUDIT_ID}\n")

    async with async_engine.begin() as conn:
        # 1. Get dropped rows with their prompt texts and job IDs
        r = await conn.execute(text("""
            SELECT lr.id, lr.llm, lr.job_id, lr.prompt_id, p.prompt_text
            FROM llm_responses lr
            JOIN prompts p ON lr.prompt_id = p.id
            WHERE lr.audit_id = :aid
              AND lr.poll_terminal_reason = 'provider_dropped'
        """), {"aid": AUDIT_ID})
        dropped = [dict(row._mapping) for row in r]
        print(f"Dropped rows to backfill: {len(dropped)}")

        if not dropped:
            print("Nothing to backfill!")
            return

        # 2. Get unique job IDs
        job_ids = set(str(row["job_id"]) for row in dropped if row.get("job_id"))
        print(f"Unique job IDs: {job_ids}\n")

        # 3. Fetch OneSearch results for each job
        all_results_by_job: dict[str, dict[str, list[dict]]] = {}
        for job_id in job_ids:
            print(f"Fetching job {job_id[:12]}...")
            try:
                results = await fetch_onesearch_results(job_id)
                # Build normalized lookup
                lookup: dict[str, list[dict]] = {}
                for r in results:
                    key = normalize(r.get("prompt") or r.get("query") or "")
                    lookup.setdefault(key, []).append(r)
                all_results_by_job[job_id] = lookup
                print(f"  Unique normalized prompts: {len(lookup)}\n")
            except Exception as e:
                print(f"  ERROR fetching job {job_id}: {e}\n")

        # 4. Match and update
        matched = 0
        unmatched = 0
        for row in dropped:
            job_id = str(row["job_id"])
            lookup = all_results_by_job.get(job_id, {})
            norm_key = normalize(row["prompt_text"])
            candidates = lookup.get(norm_key)

            if candidates:
                result = candidates.pop(0)
                if not candidates:
                    del lookup[norm_key]

                answer_text = result.get("answer_text")
                answer_md = result.get("answer_text_markdown")
                citations = json.dumps(result["citations"]) if result.get("citations") else None
                all_sources = json.dumps(result["all_sources"]) if result.get("all_sources") else None
                links = json.dumps(result["links_attached"]) if result.get("links_attached") else None

                await conn.execute(text("""
                    UPDATE llm_responses SET
                        answer_text = :answer_text,
                        answer_text_markdown = :answer_md,
                        response_url = :url,
                        raw_response_data = :raw_data,
                        web_search_query = :ws_query,
                        citations = :citations,
                        all_sources = :all_sources,
                        links_attached = :links,
                        response_timestamp = :ts,
                        poll_terminal_reason = NULL
                    WHERE id = :id
                """), {
                    "id": str(row["id"]),
                    "answer_text": answer_text,
                    "answer_md": answer_md,
                    "url": result.get("url"),
                    "raw_data": json.dumps(result),
                    "ws_query": result.get("web_search_query"),
                    "citations": citations,
                    "all_sources": all_sources,
                    "links": links,
                    "ts": datetime.now(timezone.utc),
                })
                matched += 1
            else:
                if unmatched < 3:
                    sample_keys = list(lookup.keys())[:2]
                    print(f"  UNMATCHED: {norm_key[:80]!r}")
                    print(f"    Available keys sample: {[k[:60] for k in sample_keys]}")
                unmatched += 1

        print(f"\n=== Results ===")
        print(f"Matched & updated: {matched}")
        print(f"Unmatched: {unmatched}")
        print(f"Transaction will be committed automatically (async with begin)")


if __name__ == "__main__":
    asyncio.run(main())
