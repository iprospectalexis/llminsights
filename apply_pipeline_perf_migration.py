"""Apply pipeline performance migration to Supabase via asyncpg."""
import asyncio
import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"

STATEMENTS = [
    # 1. Drop MV-refresh triggers
    "DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_insert ON llm_responses",
    "DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_update ON llm_responses",
    "DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_delete ON llm_responses",
    # 2. Partial indexes
    """CREATE INDEX IF NOT EXISTS idx_lr_pending_competitors
       ON llm_responses (audit_id)
       WHERE answer_text IS NOT NULL
         AND (answer_competitors IS NULL OR answer_competitors ? 'error')""",
    """CREATE INDEX IF NOT EXISTS idx_lr_pending_sentiment
       ON llm_responses (audit_id)
       WHERE answer_text IS NOT NULL""",
    # 3. RLS optimization index
    """CREATE INDEX IF NOT EXISTS idx_project_members_lookup
       ON project_members (project_id, user_id)""",
]

VERIFY_QUERIES = [
    # Check triggers are gone
    ("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'llm_responses_queue_metrics_refresh%'", 0, "MV triggers dropped"),
    # Check indexes exist
    ("SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_lr_pending_competitors'", 1, "idx_lr_pending_competitors exists"),
    ("SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_lr_pending_sentiment'", 1, "idx_lr_pending_sentiment exists"),
    ("SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_project_members_lookup'", 1, "idx_project_members_lookup exists"),
]

async def main():
    print("Connecting to Supabase...")
    conn = await asyncpg.connect(DSN)
    try:
        for i, stmt in enumerate(STATEMENTS, 1):
            label = stmt.strip().split('\n')[0][:80]
            print(f"  [{i}/{len(STATEMENTS)}] {label}...")
            await conn.execute(stmt)
            print(f"    OK")

        print("\nVerifying...")
        all_ok = True
        for query, expected, label in VERIFY_QUERIES:
            val = await conn.fetchval(query)
            ok = val == expected
            status = "OK" if ok else f"FAIL (got {val}, expected {expected})"
            print(f"  {label}: {status}")
            if not ok:
                all_ok = False

        print(f"\n{'All checks passed!' if all_ok else 'Some checks FAILED!'}")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
