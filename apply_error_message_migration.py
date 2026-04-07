"""One-shot: apply 20260408160000_audits_error_message.sql to Supabase prod.

Adds the long-missing `audits.error_message` column. Until now every UPDATE
that touched it (auto-fail sweep, process_step except blocks, handle_polling
terminal sweeps) silently failed with 42703, leaving us blind to crashes.
"""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408160000_audits_error_message.sql")


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
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'audits' AND column_name = 'error_message'
        """)
        print(f"\naudits.error_message: {'OK' if cols else 'MISSING'}")
        for c in cols:
            print(f"  {c['column_name']:<16} {c['data_type']:<12} nullable={c['is_nullable']}")

        # Sanity: how many audits are currently in a terminal-failed state with
        # no error_message — these are the ones the broken auto-fail sweep
        # left without an explanation.
        n = await conn.fetchval("""
            SELECT count(*) FROM audits
            WHERE status = 'failed' AND error_message IS NULL
        """)
        print(f"\nfailed audits with NULL error_message: {n}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
