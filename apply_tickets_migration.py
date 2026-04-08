"""One-shot: apply 20260408180000_tickets.sql to Supabase prod.

Creates the ticketing module schema:
  - tickets, ticket_comments, ticket_votes, ticket_history
  - triggers (touch, counters, audit log)
  - RLS policies (per role isolation via is_manager())
  - users.tickets_last_seen_at column
  - realtime publication entries
"""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408180000_tickets.sql")


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

        # Sanity: tables exist
        for tbl in ("tickets", "ticket_comments", "ticket_votes", "ticket_history"):
            row = await conn.fetchrow(
                "SELECT to_regclass($1) AS reg",
                f"public.{tbl}",
            )
            ok = row and row["reg"] is not None
            print(f"  table {tbl}: {'OK' if ok else 'MISSING'}")

        # Sanity: RLS enabled on each table
        rls_rows = await conn.fetch(
            """
            SELECT relname, relrowsecurity
            FROM pg_class
            WHERE relname IN ('tickets','ticket_comments','ticket_votes','ticket_history')
            """
        )
        for r in rls_rows:
            print(f"  RLS {r['relname']}: {'ON' if r['relrowsecurity'] else 'OFF'}")

        # Sanity: tickets_last_seen_at column on users
        col = await conn.fetchrow(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name='users' AND column_name='tickets_last_seen_at'
            """
        )
        print(f"  users.tickets_last_seen_at: {'OK' if col else 'MISSING'}")

        # Sanity: realtime publication
        pub_rows = await conn.fetch(
            """
            SELECT tablename FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND tablename IN ('tickets','ticket_comments')
            """
        )
        pub_set = {r["tablename"] for r in pub_rows}
        for t in ("tickets", "ticket_comments"):
            print(f"  realtime {t}: {'OK' if t in pub_set else 'MISSING'}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
