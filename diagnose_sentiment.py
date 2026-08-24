"""Diagnose why the Sentiment Dashboard shows 'No sentiment data yet'.

Checks every possible failure mode in order and tells you which one is
the culprit. Read-only.
"""
from __future__ import annotations

import asyncio
import ssl

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)


async def main() -> None:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)

    try:
        print("=" * 80)
        print("1. Does response_brand_sentiment table exist and have ANY rows?")
        print("=" * 80)
        exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'response_brand_sentiment')"
        )
        print(f"   table exists: {exists}")
        if not exists:
            print("   !! Sentiment V2 migration has not been applied. Apply it first.")
            return

        total = await conn.fetchval("SELECT count(*) FROM response_brand_sentiment")
        print(f"   total rows   : {total}")

        if total == 0:
            print("   !! Table is EMPTY — no sentiment has ever been written by pipeline")

        # Last few inserts
        recent = await conn.fetch(
            """
            SELECT audit_id, brand, brand_kind, label, score, is_fallback,
                   model, prompt_version, created_at
            FROM response_brand_sentiment
            ORDER BY created_at DESC
            LIMIT 5
            """
        )
        if recent:
            print("\n   5 most recent sentiment rows:")
            for r in recent:
                print(f"     {r['created_at']}  audit={str(r['audit_id'])[:8]}  "
                      f"brand={r['brand']:<20} {r['brand_kind']:<10} "
                      f"{r['label']:<8} score={r['score']}  "
                      f"fallback={r['is_fallback']}")

        print()
        print("=" * 80)
        print("2. How many audits have sentiment=true?")
        print("=" * 80)
        sentiment_flag = await conn.fetch(
            """
            SELECT sentiment, status, count(*) AS n
            FROM audits
            WHERE started_at > now() - interval '30 days'
            GROUP BY sentiment, status
            ORDER BY sentiment, status
            """
        )
        print(f"   Last 30 days, grouped by (sentiment flag, status):")
        for r in sentiment_flag:
            print(f"     sentiment={r['sentiment']!s:<5}  status={r['status']:<12}  n={r['n']}")

        print()
        print("=" * 80)
        print("3. Per-project breakdown — which projects have sentiment data?")
        print("=" * 80)
        per_project = await conn.fetch(
            """
            SELECT p.name,
                   count(DISTINCT a.id) FILTER (WHERE a.sentiment = true
                                                 AND a.status = 'completed') AS sentiment_completed_audits,
                   count(DISTINCT a.id) FILTER (WHERE a.status = 'completed') AS completed_audits,
                   count(DISTINCT a.id) AS all_audits,
                   count(rbs.id) AS rbs_rows
            FROM projects p
            LEFT JOIN audits a ON a.project_id = p.id
               AND a.started_at > now() - interval '30 days'
            LEFT JOIN response_brand_sentiment rbs ON rbs.audit_id = a.id
            GROUP BY p.id, p.name
            HAVING count(DISTINCT a.id) > 0
            ORDER BY rbs_rows DESC, p.name
            LIMIT 20
            """
        )
        print(f"   {'project':<50} {'all':>5} {'done':>5} {'sentON':>7} {'rbs_rows':>10}")
        for r in per_project:
            name = (r['name'] or '—')[:48]
            print(f"   {name:<50} {r['all_audits']:>5} {r['completed_audits']:>5} "
                  f"{r['sentiment_completed_audits']:>7} {r['rbs_rows']:>10}")

        print()
        print("=" * 80)
        print("4. Most recent COMPLETED audits with sentiment=true — did pipeline actually run?")
        print("=" * 80)
        recent_completed = await conn.fetch(
            """
            SELECT a.id, p.name AS project_name, a.started_at, a.finished_at,
                   a.status, a.pipeline_state, a.current_step,
                   a.sentiment_processed, a.sentiment_total,
                   (SELECT count(*) FROM response_brand_sentiment
                    WHERE audit_id = a.id) AS rbs_rows,
                   (SELECT count(*) FROM llm_responses
                    WHERE audit_id = a.id AND answer_text IS NOT NULL) AS with_answer
            FROM audits a
            LEFT JOIN projects p ON p.id = a.project_id
            WHERE a.sentiment = true
              AND a.status = 'completed'
            ORDER BY a.finished_at DESC NULLS LAST
            LIMIT 10
            """
        )
        print(f"   {'project':<40} {'started':<20} {'sentProc':>8} {'answ':>5} {'rbs':>5} state")
        for r in recent_completed:
            name = (r['project_name'] or '—')[:38]
            started = r['started_at'].strftime('%Y-%m-%d %H:%M') if r['started_at'] else '—'
            print(f"   {name:<40} {started:<20} "
                  f"{r['sentiment_processed']!s:>8} {r['with_answer']:>5} {r['rbs_rows']:>5} "
                  f"{r['pipeline_state']}")

        print()
        print("=" * 80)
        print("5. Referential integrity — do rbs rows actually join to llm_responses?")
        print("=" * 80)
        orphaned = await conn.fetchval(
            """
            SELECT count(*)
            FROM response_brand_sentiment rbs
            LEFT JOIN llm_responses lr ON lr.id = rbs.response_id
            WHERE lr.id IS NULL
            """
        )
        print(f"   rbs rows with broken llm_responses FK: {orphaned}")
        print("   (If > 0, the frontend !inner join will silently drop these rows)")

        print()
        print("=" * 80)
        print("6. Brands table — do any projects have brands configured?")
        print("=" * 80)
        brands_stats = await conn.fetch(
            """
            SELECT p.name,
                   count(*) FILTER (WHERE b.is_competitor = false) AS own_brands,
                   count(*) FILTER (WHERE b.is_competitor = true)  AS competitor_brands
            FROM projects p
            LEFT JOIN brands b ON b.project_id = p.id
            GROUP BY p.id, p.name
            HAVING count(b.id) > 0
            ORDER BY p.name
            LIMIT 15
            """
        )
        print(f"   {'project':<50} {'own':>5} {'competitors':>12}")
        for r in brands_stats:
            print(f"   {(r['name'] or '—')[:48]:<50} {r['own_brands']:>5} {r['competitor_brands']:>12}")

        print()
        print("=" * 80)
        print("7. Are recent audits hitting analyzing_sentiment state at all?")
        print("=" * 80)
        sentiment_log = await conn.fetch(
            """
            SELECT apl.audit_id, p.name AS project_name,
                   apl.phase, apl.message, apl.level, apl.created_at
            FROM audit_pipeline_log apl
            LEFT JOIN audits a ON a.id = apl.audit_id
            LEFT JOIN projects p ON p.id = a.project_id
            WHERE apl.state = 'analyzing_sentiment'
              AND apl.created_at > now() - interval '48 hours'
            ORDER BY apl.created_at DESC
            LIMIT 15
            """
        )
        if sentiment_log:
            for r in sentiment_log:
                ts = r['created_at'].strftime('%m-%d %H:%M') if r['created_at'] else '—'
                name = (r['project_name'] or '—')[:25]
                msg = (r['message'] or '')[:60]
                print(f"   {ts}  {name:<25} [{r['level'] or '?'}] {r['phase'] or '—':<25} {msg}")
        else:
            print("   !! ZERO pipeline log entries with state='analyzing_sentiment' in last 48h")
            print("      Either no recent audits reached that state, or logging is off.")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
