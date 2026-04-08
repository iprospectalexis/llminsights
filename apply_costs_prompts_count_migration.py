"""One-shot: apply 20260408170000_costs_prompts_count.sql to Supabase prod.

Adds a `prompts_count` column to `get_costs_by_project` and
`get_costs_by_audit` so the admin/costs UI can show how many prompts
each project/audit holds alongside its cost.
"""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408170000_costs_prompts_count.sql")


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

        # Sanity: confirm both RPCs now expose `prompts_count`.
        for fn in ("get_costs_by_project", "get_costs_by_audit"):
            cols = await conn.fetch("""
                SELECT pg_get_function_result(oid) AS sig
                FROM pg_proc
                WHERE proname = $1
            """, fn)
            for c in cols:
                has_pc = "prompts_count" in (c["sig"] or "")
                print(f"  {fn}: prompts_count {'OK' if has_pc else 'MISSING'}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
