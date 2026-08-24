"""Drill down into TIPTOE Sentiment tab — find why 47 rbs rows don't show."""
from __future__ import annotations

import asyncio
import ssl

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)
PROJECT_ID = "06b9a92f-f1e7-4555-b342-c58a50980b6a"  # TIPTOE


async def main() -> None:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)

    try:
        # 1. Project info
        print("=" * 80)
        print("1. Project + its audits")
        print("=" * 80)
        proj = await conn.fetchrow(
            "SELECT id, name, created_by FROM projects WHERE id = $1", PROJECT_ID
        )
        print(f"   {proj['name']}  created_by={proj['created_by']}")

        audits = await conn.fetch(
            """
            SELECT id, status, pipeline_state, sentiment, started_at,
                   responses_expected, responses_received
            FROM audits
            WHERE project_id = $1
            ORDER BY started_at DESC
            """,
            PROJECT_ID,
        )
        print(f"   {len(audits)} audits:")
        for a in audits:
            print(f"     {a['id']}  status={a['status']:<10} state={a['pipeline_state']:<22} "
                  f"sent={a['sentiment']!s:<5} started={a['started_at']}")

        # Collect only 'completed' audit ids (same as frontend filter)
        completed_ids = [a['id'] for a in audits if a['status'] == 'completed']
        print(f"\n   Audit IDs that frontend query would pick up ({len(completed_ids)}):")
        for aid in completed_ids:
            print(f"     {aid}")

        if not completed_ids:
            print("   !! No completed audits — frontend will return empty. Done.")
            return

        # 2. Raw sentiment rows for these audits
        print()
        print("=" * 80)
        print("2. Raw response_brand_sentiment rows for these audits")
        print("=" * 80)
        rbs_rows = await conn.fetch(
            """
            SELECT rbs.id, rbs.audit_id, rbs.response_id, rbs.brand, rbs.brand_kind,
                   rbs.label, rbs.score, rbs.model, rbs.prompt_version, rbs.created_at
            FROM response_brand_sentiment rbs
            WHERE rbs.audit_id = ANY($1::uuid[])
            ORDER BY rbs.created_at DESC
            LIMIT 5
            """,
            completed_ids,
        )
        total_rbs = await conn.fetchval(
            "SELECT count(*) FROM response_brand_sentiment WHERE audit_id = ANY($1::uuid[])",
            completed_ids,
        )
        print(f"   total rbs rows for these audits: {total_rbs}")
        for r in rbs_rows:
            print(f"     {r['created_at']}  resp={str(r['response_id'])[:8]}  "
                  f"brand={r['brand']:<15} {r['label']:<10} score={r['score']}")

        # 3. Does the inner join work?
        print()
        print("=" * 80)
        print("3. Same rows joined to llm_responses (simulating frontend !inner join)")
        print("=" * 80)
        joined = await conn.fetchval(
            """
            SELECT count(*)
            FROM response_brand_sentiment rbs
            INNER JOIN llm_responses lr ON lr.id = rbs.response_id
            WHERE rbs.audit_id = ANY($1::uuid[])
            """,
            completed_ids,
        )
        print(f"   joined count: {joined}  (expected: {total_rbs})")
        if joined != total_rbs:
            print("   !! MISMATCH — some rbs rows don't have matching llm_responses")

        # 4. RLS policies on response_brand_sentiment
        print()
        print("=" * 80)
        print("4. RLS policies — response_brand_sentiment")
        print("=" * 80)
        policies = await conn.fetch(
            """
            SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
            FROM pg_policy
            WHERE polrelid = 'public.response_brand_sentiment'::regclass
            """
        )
        for p in policies:
            cmd = {'r': 'SELECT', 'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE', '*': 'ALL'}.get(p['polcmd'], p['polcmd'])
            print(f"   [{cmd}] {p['polname']}")
            print(f"         USING: {p['using_expr']}")

        rls_enabled = await conn.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.response_brand_sentiment'::regclass"
        )
        print(f"   RLS enabled: {rls_enabled}")

        # 5. RLS on llm_responses (inner join passes through)
        print()
        print("=" * 80)
        print("5. RLS policies — llm_responses (inner join target)")
        print("=" * 80)
        policies = await conn.fetch(
            """
            SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
            FROM pg_policy
            WHERE polrelid = 'public.llm_responses'::regclass
            """
        )
        for p in policies:
            cmd = {'r': 'SELECT', 'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE', '*': 'ALL'}.get(p['polcmd'], p['polcmd'])
            print(f"   [{cmd}] {p['polname']}")
            print(f"         USING: {(p['using_expr'] or '')[:200]}")

        rls_enabled = await conn.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.llm_responses'::regclass"
        )
        print(f"   RLS enabled: {rls_enabled}")

        # 6. Foreign key registration (PostgREST needs these)
        print()
        print("=" * 80)
        print("6. Foreign keys — does PostgREST see rbs.response_id -> llm_responses.id?")
        print("=" * 80)
        fks = await conn.fetch(
            """
            SELECT conname,
                   pg_get_constraintdef(oid) AS def
            FROM pg_constraint
            WHERE conrelid = 'public.response_brand_sentiment'::regclass
              AND contype = 'f'
            """
        )
        for fk in fks:
            print(f"   {fk['conname']}")
            print(f"     {fk['def']}")

        # 7. Is response_brand_sentiment in PostgREST exposed schema?
        print()
        print("=" * 80)
        print("7. Is response_brand_sentiment in the realtime publication / public schema?")
        print("=" * 80)
        sch = await conn.fetchrow(
            "SELECT table_schema, table_name FROM information_schema.tables "
            "WHERE table_name = 'response_brand_sentiment'"
        )
        print(f"   schema: {sch['table_schema']}, table: {sch['table_name']}")

        grants = await conn.fetch(
            """
            SELECT grantee, privilege_type
            FROM information_schema.role_table_grants
            WHERE table_name = 'response_brand_sentiment'
              AND grantee IN ('anon', 'authenticated', 'service_role')
            ORDER BY grantee, privilege_type
            """
        )
        print(f"   grants:")
        for g in grants:
            print(f"     {g['grantee']:<15} {g['privilege_type']}")
        if not grants:
            print("     !! NO grants for anon/authenticated/service_role — PostgREST can't read")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
