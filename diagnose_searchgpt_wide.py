"""How widespread is SearchGPT polling_timeout? Look across recent audits."""
import asyncio
import ssl
import sys

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"


async def main() -> int:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        # 1) Last 30 audits with searchgpt — % of rows that got an answer
        rows = await conn.fetch(
            """
            SELECT
              a.id           AS audit_id,
              a.status,
              a.started_at,
              p.name         AS project,
              count(*)                                                    AS sgpt_total,
              count(*) FILTER (WHERE r.answer_text IS NOT NULL)           AS sgpt_with_answer,
              count(*) FILTER (WHERE r.poll_terminal_reason = 'polling_timeout') AS sgpt_polling_to,
              count(*) FILTER (WHERE r.poll_terminal_reason IS NOT NULL)  AS sgpt_terminal,
              count(DISTINCT r.job_id)                                    AS distinct_jobs
            FROM audits a
            JOIN projects p ON p.id = a.project_id
            JOIN llm_responses r ON r.audit_id = a.id
            WHERE r.llm = 'searchgpt'
            GROUP BY a.id, a.status, a.started_at, p.name
            ORDER BY a.started_at DESC NULLS LAST
            LIMIT 30
            """
        )
        print(f"=== Last {len(rows)} audits using SearchGPT ===")
        print(
            f"  {'started':<20} {'status':<11} {'tot':>4}{'ans':>5}{'pTO':>5}{'term':>5}{'jobs':>5}  project"
        )
        for r in rows:
            started = r["started_at"].strftime("%Y-%m-%d %H:%M") if r["started_at"] else "—"
            print(
                f"  {started:<20} {r['status']:<11}"
                f" {r['sgpt_total']:>4}"
                f" {r['sgpt_with_answer']:>4}"
                f" {r['sgpt_polling_to']:>4}"
                f" {r['sgpt_terminal']:>4}"
                f" {r['distinct_jobs']:>4}"
                f"  {r['project'][:55]}"
            )

        # 2) Same picture for perplexity (control group)
        rows2 = await conn.fetch(
            """
            SELECT
              count(*)                                                AS perp_total,
              count(*) FILTER (WHERE r.answer_text IS NOT NULL)       AS perp_with_answer,
              count(*) FILTER (WHERE r.poll_terminal_reason = 'polling_timeout') AS perp_polling_to,
              count(*) FILTER (WHERE r.poll_terminal_reason IS NOT NULL) AS perp_terminal
            FROM llm_responses r
            JOIN audits a ON a.id = r.audit_id
            WHERE r.llm = 'perplexity'
              AND a.started_at >= now() - interval '14 days'
            """
        )
        print("\n=== Perplexity control (last 14d) ===")
        for r in rows2:
            print(f"  total={r['perp_total']} ans={r['perp_with_answer']} pTO={r['perp_polling_to']} term={r['perp_terminal']}")

        # 3) Same for searchgpt aggregate (last 14d)
        rows3 = await conn.fetch(
            """
            SELECT
              count(*)                                                AS sgpt_total,
              count(*) FILTER (WHERE r.answer_text IS NOT NULL)       AS sgpt_with_answer,
              count(*) FILTER (WHERE r.poll_terminal_reason = 'polling_timeout') AS sgpt_polling_to,
              count(*) FILTER (WHERE r.poll_terminal_reason IS NOT NULL) AS sgpt_terminal,
              count(*) FILTER (WHERE r.poll_attempts = 0 AND r.poll_terminal_reason IS NOT NULL) AS sgpt_term_att0
            FROM llm_responses r
            JOIN audits a ON a.id = r.audit_id
            WHERE r.llm = 'searchgpt'
              AND a.started_at >= now() - interval '14 days'
            """
        )
        print("\n=== SearchGPT aggregate (last 14d) ===")
        for r in rows3:
            print(
                f"  total={r['sgpt_total']}"
                f"  with_answer={r['sgpt_with_answer']}"
                f"  polling_to={r['sgpt_polling_to']}"
                f"  terminal={r['sgpt_terminal']}"
                f"  terminal_with_att0={r['sgpt_term_att0']}"
            )

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
