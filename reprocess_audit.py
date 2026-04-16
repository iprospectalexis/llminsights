"""
Re-enter the pipeline for a completed/failed audit so that
competitor extraction and sentiment analysis run on rows that
need (re)processing.

Clears force_skipped_stuck sentinels back to NULL so extraction
can attempt them fresh. Resets progress counters to avoid the
force-skip guard.

Usage (on VPS):
    docker cp reprocess_audit.py llmi:/app/
    docker exec llmi python /app/reprocess_audit.py
    docker exec llmi python /app/reprocess_audit.py <audit-id>
"""
import asyncio
import sys
from datetime import datetime, timezone

from sqlalchemy import text

from app.database import async_engine

# Default audit IDs to reprocess (add more as needed)
DEFAULT_AUDIT_IDS = [
    "5f55e516-3b0d-462f-9fa4-191f0010cc80",  # DAZN backfill
    "d9012d8e-d1f2-4f8a-8e29-dd02c1b17a85",  # Latest — force_skipped_stuck
]


async def reprocess(audit_id: str):
    print(f"\n{'='*50}")
    print(f"Audit: {audit_id}")
    print(f"{'='*50}")

    async with async_engine.begin() as conn:
        # 1. Check current state
        row = (await conn.execute(text("""
            SELECT status, pipeline_state, progress,
                   competitors_processed, competitors_total,
                   sentiment_processed, sentiment_total
            FROM audits WHERE id = :aid
        """), {"aid": audit_id})).mappings().first()

        if not row:
            print("ERROR: Audit not found!")
            return

        print(f"State: status={row['status']}, pipeline={row['pipeline_state']}, "
              f"progress={row['progress']}")
        print(f"Competitors: {row['competitors_processed']}/{row['competitors_total']}")
        print(f"Sentiment:   {row['sentiment_processed']}/{row['sentiment_total']}")

        if row["pipeline_state"] not in ("completed", "failed"):
            print(f"SKIP: pipeline_state is '{row['pipeline_state']}' — "
                  f"can only reprocess completed or failed audits.")
            return

        # 2. Clear force_skipped_stuck sentinels → NULL so extraction retries
        cleared = (await conn.execute(text("""
            UPDATE llm_responses
            SET answer_competitors = NULL
            WHERE audit_id = :aid
              AND answer_competitors->>'error' = 'force_skipped_stuck'
            RETURNING id
        """), {"aid": audit_id})).fetchall()
        if cleared:
            print(f"Cleared {len(cleared)} force_skipped_stuck sentinels → NULL")

        # 3. Check pending work
        comp_pending = (await conn.execute(text("""
            SELECT COUNT(*)
            FROM llm_responses lr
            JOIN prompts p ON lr.prompt_id = p.id
            WHERE lr.audit_id = :aid
              AND lr.answer_text IS NOT NULL
              AND (lr.answer_competitors IS NULL
                   OR (lr.answer_competitors ? 'error'
                       AND lr.answer_competitors ? '_retry'
                       AND (lr.answer_competitors->>'_retry')::int < 3))
        """), {"aid": audit_id})).scalar()

        sent_pending = (await conn.execute(text("""
            SELECT COUNT(*)
            FROM llm_responses lr
            WHERE lr.audit_id = :aid
              AND lr.answer_text IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM response_brand_sentiment rbs
                  WHERE rbs.response_id = lr.id
              )
        """), {"aid": audit_id})).scalar()

        print(f"Pending competitor extraction: {comp_pending}")
        print(f"Pending sentiment analysis:    {sent_pending}")

        if comp_pending == 0 and sent_pending == 0:
            print("Nothing to reprocess!")
            return

        # 4. Reset pipeline state — scheduler picks it up within 15s
        result = await conn.execute(text("""
            UPDATE audits SET
                pipeline_state = 'extracting_competitors',
                status = 'running',
                progress = 60,
                current_step = 'processing_results',
                competitors_processed = 0,
                competitors_total = 0,
                sentiment_processed = 0,
                sentiment_total = 0,
                locked_by = NULL,
                locked_at = NULL,
                last_activity_at = now(),
                finished_at = NULL,
                error_message = NULL
            WHERE id = :aid
              AND pipeline_state IN ('completed', 'failed')
            RETURNING id
        """), {"aid": audit_id})

        if result.first():
            print(f"Pipeline reset to 'extracting_competitors'")
            print(f"Monitor: docker logs -f llmi 2>&1 | grep '{audit_id[:12]}'")
        else:
            print("ERROR: UPDATE failed (state may have changed)")


async def main():
    audit_ids = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_AUDIT_IDS
    print(f"=== Reprocess {len(audit_ids)} audit(s) ===")
    for aid in audit_ids:
        await reprocess(aid.strip())
    print(f"\nDone. Scheduler picks up within 15 seconds.")


if __name__ == "__main__":
    asyncio.run(main())
