"""One-shot: apply 20260408150000_llm_responses_poll_state.sql to Supabase prod."""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408150000_llm_responses_poll_state.sql")


async def main() -> int:
    sql = SQL_PATH.read_text(encoding="utf-8")
    print(f"Loaded {SQL_PATH} ({len(sql)} bytes)")

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        async with conn.transaction():
            await conn.execute(sql)
        print("OK: migration executed")

        cols = await conn.fetch("""
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'llm_responses'
              AND column_name IN ('poll_attempts', 'first_polled_at',
                                  'last_polled_at', 'poll_terminal_reason')
            ORDER BY column_name
        """)
        print(f"\nNew columns ({len(cols)}):")
        for c in cols:
            print(f"  {c['column_name']:<22} {c['data_type']:<25} default={c['column_default']}")

        idx = await conn.fetch("""
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'llm_responses' AND indexname = 'llm_responses_poll_idx'
        """)
        print(f"\nPartial index: {'OK' if idx else 'MISSING'}")

        # Sanity: count of currently active-pending rows under the new definition.
        n = await conn.fetchval("""
            SELECT count(*) FROM llm_responses
            WHERE answer_text IS NULL
              AND raw_response_data IS NULL
              AND poll_terminal_reason IS NULL
        """)
        print(f"\nllm_responses currently active-pending: {n}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
