"""Diagnose missing sentiment data on project 1606c700."""
from __future__ import annotations

import asyncio
import ssl

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)
PROJECT_ID = "1606c700-6c73-4f97-b303-592fa38f214f"


async def main() -> None:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        print("=" * 80)
        print("1. Project metadata")
        print("=" * 80)
        proj = await conn.fetchrow(
            """
            SELECT p.id, p.name, p.created_at, p.created_by,
                   u.email AS creator_email
            FROM projects p
            LEFT JOIN auth.users u ON u.id = p.created_by
            WHERE p.id = $1
            """,
            PROJECT_ID,
        )
        if not proj:
            print(f"   NO SUCH PROJECT {PROJECT_ID}")
            return
        print(f"   name          = {proj['name']!r}")
        print(f"   created_at    = {proj['created_at']}")
        print(f"   created_by    = {proj['created_by']}")
        print(f"   creator_email = {proj['creator_email']}")

        print()
        print("=" * 80)
        print("2. Audits in project")
        print("=" * 80)
        audits = await conn.fetch(
            """
            SELECT id, status, pipeline_state, sentiment, created_at,
                   finished_at, responses_expected, responses_received,
                   competitors_processed, competitors_total,
                   sentiment_processed, sentiment_total,
                   left(coalesce(error_message,''),180) AS err
            FROM audits
            WHERE project_id = $1
            ORDER BY created_at DESC
            """,
            PROJECT_ID,
        )
        print(f"   {len(audits)} audits total")
        for a in audits:
            print(f"   - {str(a['id'])[:8]}  {a['created_at']}  "
                  f"status={a['status']:<10} ps={a['pipeline_state']}")
            print(f"     sentiment_flag={a['sentiment']}  "
                  f"resp={a['responses_received']}/{a['responses_expected']}  "
                  f"comp={a['competitors_processed']}/{a['competitors_total']}  "
                  f"sent={a['sentiment_processed']}/{a['sentiment_total']}")
            if a['err']:
                print(f"     err: {a['err']}")

        if not audits:
            print("   — no audits, nothing else to check")
            return

        print()
        print("=" * 80)
        print("3. Per-audit data counts (citations / rbs / responses w/ answer)")
        print("=" * 80)
        for a in audits:
            aid = a['id']
            cit = await conn.fetchval(
                "SELECT count(*) FROM citations WHERE audit_id=$1", aid)
            rbs = await conn.fetchval(
                "SELECT count(*) FROM response_brand_sentiment WHERE audit_id=$1", aid)
            resp_total = await conn.fetchval(
                "SELECT count(*) FROM llm_responses WHERE audit_id=$1", aid)
            resp_ans = await conn.fetchval(
                "SELECT count(*) FROM llm_responses WHERE audit_id=$1 "
                "AND answer_text IS NOT NULL", aid)
            print(f"   {str(aid)[:8]}  cit={cit:<4} rbs={rbs:<4} "
                  f"resp={resp_ans}/{resp_total} (w_answer/total)")

        print()
        print("=" * 80)
        print("4. Sentiment pipeline log entries (any audit)")
        print("=" * 80)
        logs = await conn.fetch(
            """
            SELECT audit_id, state, phase, level, created_at,
                   left(coalesce(message,''),180) AS msg
            FROM audit_pipeline_log
            WHERE audit_id = ANY($1::uuid[])
            ORDER BY created_at DESC
            LIMIT 60
            """,
            [a['id'] for a in audits],
        )
        if not logs:
            print("   — NO pipeline log entries at all")
        for l in logs:
            print(f"   {str(l['audit_id'])[:8]}  state={l['state']:<24} "
                  f"phase={l['phase'] or '-':<12} lvl={l['level']:<6} {l['created_at']}")
            if l['msg']:
                print(f"      {l['msg']}")

        print()
        print("=" * 80)
        print("5. Brand sentiment sample (if any rbs rows exist)")
        print("=" * 80)
        sample = await conn.fetch(
            """
            SELECT rbs.id, rbs.audit_id, rbs.brand_kind, rbs.sentiment,
                   rbs.created_at
            FROM response_brand_sentiment rbs
            WHERE rbs.audit_id = ANY($1::uuid[])
            ORDER BY rbs.created_at DESC
            LIMIT 5
            """,
            [a['id'] for a in audits],
        )
        print(f"   {len(sample)} sample rbs rows (first 5)")
        for s in sample:
            print(f"   {str(s['audit_id'])[:8]}  kind={s['brand_kind']:<10} "
                  f"sent={s['sentiment']} at={s['created_at']}")

        print()
        print("=" * 80)
        print("6. Brands in project")
        print("=" * 80)
        brands = await conn.fetch(
            """
            SELECT id, name, is_primary, created_at
            FROM brands
            WHERE project_id = $1
            ORDER BY is_primary DESC, name
            """,
            PROJECT_ID,
        )
        print(f"   {len(brands)} brands")
        for b in brands[:10]:
            marker = "*" if b['is_primary'] else " "
            print(f"   {marker} {b['name']}")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
