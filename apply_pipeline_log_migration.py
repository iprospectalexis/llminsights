"""One-shot: apply 20260408160100_audit_pipeline_log.sql to Supabase prod.

Creates the insert-only `audit_pipeline_log` journal — a permanent crash
ledger so we never have to dig through container logs to answer "what's
wrong with audit X" again.
"""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408160100_audit_pipeline_log.sql")


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

        exists = await conn.fetchval("SELECT to_regclass('public.audit_pipeline_log')")
        print(f"\naudit_pipeline_log: {exists or 'MISSING'}")

        cols = await conn.fetch("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'audit_pipeline_log'
            ORDER BY ordinal_position
        """)
        print(f"\nColumns ({len(cols)}):")
        for c in cols:
            print(f"  {c['column_name']:<14} {c['data_type']}")

        idx = await conn.fetch("""
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'audit_pipeline_log'
            ORDER BY indexname
        """)
        print(f"\nIndexes ({len(idx)}):")
        for i in idx:
            print(f"  {i['indexname']}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
