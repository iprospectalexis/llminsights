"""One-shot: apply 20260408180100_tickets_storage.sql to Supabase prod.

Creates the private `ticket-attachments` storage bucket (10MB, MIME-restricted)
plus RLS policies on storage.objects so that:
  - authors can only access files under tickets/{their_uid}/...
  - managers can access everything
"""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
SQL_PATH = Path("supabase/migrations/20260408180100_tickets_storage.sql")


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

        # Sanity: bucket exists, is private, has the expected size limit
        row = await conn.fetchrow(
            """
            SELECT id, public, file_size_limit, allowed_mime_types
            FROM storage.buckets
            WHERE id = 'ticket-attachments'
            """
        )
        if row is None:
            print("  bucket ticket-attachments: MISSING")
        else:
            print(
                "  bucket ticket-attachments: OK"
                f" (public={row['public']},"
                f" size_limit={row['file_size_limit']},"
                f" mimes={len(row['allowed_mime_types'] or [])})"
            )

        # Sanity: 3 storage RLS policies
        pol_rows = await conn.fetch(
            """
            SELECT polname
            FROM pg_policy
            WHERE polname IN (
              'ticket_attach_select',
              'ticket_attach_insert',
              'ticket_attach_delete'
            )
            """
        )
        names = {r["polname"] for r in pol_rows}
        for p in ("ticket_attach_select", "ticket_attach_insert", "ticket_attach_delete"):
            print(f"  policy {p}: {'OK' if p in names else 'MISSING'}")

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
