"""Confirm the TIPTOE sentiment RLS hypothesis."""
from __future__ import annotations

import asyncio
import ssl

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)
PROJECT_ID = "06b9a92f-f1e7-4555-b342-c58a50980b6a"


async def main() -> None:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        print("=" * 80)
        print("1. RLS policies on audits (does it have manager bypass?)")
        print("=" * 80)
        policies = await conn.fetch(
            """
            SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
            FROM pg_policy
            WHERE polrelid = 'public.audits'::regclass
            """
        )
        for p in policies:
            print(f"   [{p['polname']}]")
            print(f"     {(p['using_expr'] or '')[:300]}")

        print()
        print("=" * 80)
        print("2. project_members for TIPTOE")
        print("=" * 80)
        members = await conn.fetch(
            """
            SELECT pm.user_id, pm.role, u.email
            FROM project_members pm
            LEFT JOIN auth.users u ON u.id = pm.user_id
            WHERE pm.project_id = $1
            """,
            PROJECT_ID,
        )
        print(f"   {len(members)} members:")
        for m in members:
            print(f"     {m['user_id']}  role={m['role']}  email={m['email']}")

        print()
        print("=" * 80)
        print("3. TIPTOE creator")
        print("=" * 80)
        creator = await conn.fetchrow(
            """
            SELECT p.created_by, u.email
            FROM projects p
            LEFT JOIN auth.users u ON u.id = p.created_by
            WHERE p.id = $1
            """,
            PROJECT_ID,
        )
        print(f"   created_by={creator['created_by']}  email={creator['email']}")

        print()
        print("=" * 80)
        print("4. All admin/manager users in the system (candidates for who's looking)")
        print("=" * 80)
        admins = await conn.fetch(
            """
            SELECT id, email, raw_app_meta_data->>'role' AS app_role,
                   raw_user_meta_data->>'role' AS user_role
            FROM auth.users
            WHERE raw_app_meta_data->>'role' IN ('admin','manager')
               OR raw_user_meta_data->>'role' IN ('admin','manager')
            ORDER BY email
            """
        )
        for a in admins:
            print(f"     {str(a['id'])[:8]}  {a['email']:<40} app={a['app_role']} user={a['user_role']}")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
