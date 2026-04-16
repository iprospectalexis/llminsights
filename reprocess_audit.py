"""
Re-enter the pipeline for a completed/failed audit so that
competitor extraction and sentiment analysis run on rows that
were backfilled after the original pipeline pass.

Critical: resets competitors_processed / competitors_total / sentiment_*
counters to 0 to avoid the force-skip guard that would otherwise poison
all pending rows (audit_pipeline.py lines 795, 1016).

Usage (on VPS):
    docker cp reprocess_audit.py llmi:/app/
    docker exec llmi python /app/reprocess_audit.py
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import text

from app.database import async_engine

AUDIT_ID = "5f55e516-3b0d-462f-9fa4-191f0010cc80"


async def main():
    print(f"=== Reprocess Audit ===")
    print(f"Audit: {AUDIT_ID}\n")

    async with async_engine.begin() as conn:
        # 1. Check current state
        row = (await conn.execute(text("""
            SELECT status, pipeline_state, progress,
                   competitors_processed, competitors_total,
                   sentiment_processed, sentiment_total
            FROM audits WHERE id = :aid
        """), {"aid": AUDIT_ID})).mappings().first()

        if not row:
            print("ERROR: Audit not found!")
            return

        print(f"Current state: status={row['status']}, pipeline_state={row['pipeline_state']}, "
              f"progress={row['progress']}")
        print(f"Competitors: {row['competitors_processed']}/{row['competitors_total']}")
        print(f"Sentiment:   {row['sentiment_processed']}/{row['sentiment_total']}")

        if row["pipeline_state"] not in ("completed", "failed"):
            print(f"\nERROR: Audit pipeline_state is '{row['pipeline_state']}' — "
                  f"can only reprocess completed or failed audits.")
            return

        # 2. Check how many rows need processing
        comp_pending = (await conn.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM llm_responses lr
            JOIN prompts p ON lr.prompt_id = p.id
            WHERE lr.audit_id = :aid
              AND lr.answer_text IS NOT NULL
              AND (lr.answer_competitors IS NULL
                   OR (lr.answer_competitors ? 'error'
                       AND lr.answer_competitors ? '_retry'
                       AND (lr.answer_competitors->>'_retry')::int < 3))
        """), {"aid": AUDIT_ID})).scalar()

        sent_pending = (await conn.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM llm_responses lr
            WHERE lr.audit_id = :aid
              AND lr.answer_text IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM response_brand_sentiment rbs
                  WHERE rbs.response_id = lr.id
              )
        """), {"aid": AUDIT_ID})).scalar()

        print(f"\nPending competitor extraction: {comp_pending}")
        print(f"Pending sentiment analysis:    {sent_pending}")

        if comp_pending == 0 and sent_pending == 0:
            print("\nNothing to reprocess!")
            return

        # 3. Reset pipeline state — scheduler picks it up within 15s
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
        """), {"aid": AUDIT_ID})

        if result.first():
            print(f"\n=== Pipeline reset to 'extracting_competitors' ===")
            print(f"Scheduler will pick it up within 15 seconds.")
            print(f"Monitor with: docker logs -f llmi 2>&1 | grep '{AUDIT_ID[:12]}'")
        else:
            print("\nERROR: UPDATE failed (CAS guard — state may have changed)")


if __name__ == "__main__":
    asyncio.run(main())
