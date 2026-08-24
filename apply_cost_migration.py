"""One-shot: apply 20260408120000_api_cost_tracking.sql to Supabase prod."""
import asyncio
import re
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408120000_api_cost_tracking.sql")


async def main() -> int:
    sql = SQL_PATH.read_text(encoding="utf-8")
    print(f"Loaded {SQL_PATH} ({len(sql)} bytes)")

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        # Execute the whole migration as a single transaction
        async with conn.transaction():
            await conn.execute(sql)
        print("OK: migration executed")

        rates = await conn.fetch(
            "SELECT provider, model, operation, unit, unit_cost_usd FROM api_pricing_rates ORDER BY provider, unit"
        )
        print(f"\napi_pricing_rates ({len(rates)} rows):")
        for r in rates:
            print(f"  {r['provider']:<11} {str(r['model'] or '-'):<11} {r['operation']:<8} {r['unit']:<14} {r['unit_cost_usd']}")

        events_count = await conn.fetchval("SELECT count(*) FROM api_usage_events")
        print(f"\napi_usage_events: {events_count} rows (should be 0)")

        funcs = await conn.fetch("""
            SELECT proname FROM pg_proc
            WHERE proname LIKE 'get_costs%' OR proname = 'get_audit_cost_events'
            ORDER BY proname
        """)
        print(f"\nRPCs created ({len(funcs)}):")
        for f in funcs:
            print(f"  - {f['proname']}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
