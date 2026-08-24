"""Apply migration 20260409200000_audits_status_pipeline_state_consistency.sql."""
import asyncio
import ssl
from pathlib import Path

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)
MIGRATION = (
    Path(__file__).parent
    / "supabase" / "migrations"
    / "20260409200000_audits_status_pipeline_state_consistency.sql"
)


async def main() -> int:
    sql = MIGRATION.read_text(encoding="utf-8")
    print(f"Applying {MIGRATION.name}")
    print(f"  {len(sql)} bytes")

    s = ssl.create_default_context()
    s.check_hostname = False
    s.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=s)
    try:
        # Pre-check: count zombies.
        pre = await conn.fetchval("""
            SELECT count(*) FROM audits
            WHERE status = 'completed'
              AND pipeline_state NOT IN ('completed', 'failed')
        """)
        print(f"  pre-migration zombies: {pre}")

        # Pre-check: does constraint already exist?
        existing = await conn.fetchval("""
            SELECT 1 FROM pg_constraint
            WHERE conname = 'audits_status_pipeline_state_consistent'
        """)
        if existing:
            print("  constraint already exists — nothing to do")
            return 0

        await conn.execute(sql)
        print("  migration executed OK")

        # Post-check: constraint listed?
        post = await conn.fetchrow("""
            SELECT conname, pg_get_constraintdef(c.oid) def
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            WHERE cl.relname = 'audits'
              AND conname = 'audits_status_pipeline_state_consistent'
        """)
        if post:
            print(f"  constraint: {post['conname']}")
            print(f"    {post['def']}")
        else:
            print("  WARN: constraint not found post-migration")
            return 1

        # Post-check: zombies left?
        left = await conn.fetchval("""
            SELECT count(*) FROM audits
            WHERE status = 'completed'
              AND pipeline_state NOT IN ('completed', 'failed')
        """)
        print(f"  zombies left after repair: {left}")
        if left > 0:
            print("  ERROR: constraint should have refused to validate")
            return 1

        # Smoke test: try to insert a zombie — should fail.
        print()
        print("Smoke test: attempt to write a zombie UPDATE → expected failure")
        test_aid = await conn.fetchval(
            "SELECT id FROM audits WHERE status = 'completed' LIMIT 1"
        )
        try:
            async with conn.transaction():
                await conn.execute(
                    "UPDATE audits SET pipeline_state = 'polling' WHERE id = $1",
                    test_aid,
                )
                print("  FAIL: UPDATE succeeded, constraint not enforced")
                return 1
        except asyncpg.exceptions.CheckViolationError as e:
            print(f"  PASS: constraint blocked the update")
            print(f"    detail: {str(e)[:200]}")

        print()
        print("Migration complete. Defense-in-depth is active.")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))
