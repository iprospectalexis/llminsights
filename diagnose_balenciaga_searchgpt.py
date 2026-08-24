"""Diagnose missing SearchGPT responses for Balenciaga_AUDIT_FR_non branded.

Read-only inspection — no writes."""
import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

DSN = "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"


async def main() -> int:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        # 1) Find the project — FR specifically
        projects = await conn.fetch(
            """
            SELECT id, name, created_at
            FROM projects
            WHERE name ILIKE 'balenciaga_audit_fr_non%'
            ORDER BY created_at DESC
            """
        )
        print(f"=== PROJECTS matching ({len(projects)}) ===")
        for p in projects:
            print(f"  {p['id']}  {p['name']}")
        if not projects:
            print("  none found, widening search...")
            projects = await conn.fetch(
                "SELECT id, name FROM projects WHERE name ILIKE '%balenciaga%' ORDER BY name"
            )
            for p in projects:
                print(f"  {p['id']}  {p['name']}")
            return 0

        project_id = projects[0]["id"]
        print(f"\n>>> Using project_id = {project_id}")

        # 2) List audits for the project
        audits = await conn.fetch(
            """
            SELECT id, status, started_at, finished_at, llms, error_message
            FROM audits
            WHERE project_id = $1
            ORDER BY started_at DESC NULLS LAST
            LIMIT 10
            """,
            project_id,
        )
        print(f"\n=== AUDITS for project ({len(audits)}) ===")
        for a in audits:
            print(
                f"  {a['id']}  status={a['status']:<12}"
                f"  started={a['started_at']}  llms={a['llms']}"
            )
            if a["error_message"]:
                print(f"    error: {a['error_message'][:200]}")

        if not audits:
            return 0

        # 3) For the most recent completed audit, count llm_responses by llm
        latest = next(
            (a for a in audits if a["status"] == "completed"),
            audits[0],
        )
        audit_id = latest["id"]
        print(f"\n>>> Inspecting audit {audit_id} (status={latest['status']})")

        rows = await conn.fetch(
            """
            SELECT
              llm,
              count(*)                                               AS total,
              count(*) FILTER (WHERE answer_text IS NOT NULL)        AS with_answer,
              count(*) FILTER (WHERE raw_response_data IS NOT NULL)  AS with_raw,
              count(*) FILTER (WHERE poll_terminal_reason IS NOT NULL) AS terminal,
              count(*) FILTER (
                WHERE answer_text IS NULL
                  AND raw_response_data IS NULL
                  AND poll_terminal_reason IS NULL
              ) AS active_pending,
              count(*) FILTER (WHERE job_id IS NOT NULL)             AS with_job_id
            FROM llm_responses
            WHERE audit_id = $1
            GROUP BY llm
            ORDER BY llm
            """,
            audit_id,
        )
        print("\n=== llm_responses BREAKDOWN ===")
        print(
            f"  {'llm':<12}{'total':>7}{'answer':>8}{'raw':>6}"
            f"{'term':>6}{'active':>8}{'job_id':>8}"
        )
        for r in rows:
            print(
                f"  {r['llm']:<12}{r['total']:>7}{r['with_answer']:>8}"
                f"{r['with_raw']:>6}{r['terminal']:>6}"
                f"{r['active_pending']:>8}{r['with_job_id']:>8}"
            )

        # 4) Sample a few SearchGPT rows to see their actual state
        # First — what columns actually exist on llm_responses?
        cols = await conn.fetch(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name='llm_responses'
            ORDER BY ordinal_position
            """
        )
        col_names = [c["column_name"] for c in cols]
        print(f"\n=== llm_responses columns ({len(col_names)}) ===")
        print(" ", ", ".join(col_names))

        sgpt = await conn.fetch(
            """
            SELECT id, prompt_id, job_id,
                   answer_text IS NOT NULL        AS has_answer,
                   raw_response_data IS NOT NULL  AS has_raw,
                   poll_terminal_reason,
                   poll_attempts,
                   length(coalesce(answer_text, '')) AS ans_len,
                   length(coalesce(raw_response_data::text, '')) AS raw_len,
                   created_at,
                   last_polled_at
            FROM llm_responses
            WHERE audit_id = $1 AND llm = 'searchgpt'
            ORDER BY created_at
            LIMIT 5
            """,
            audit_id,
        )
        print(f"\n=== SAMPLE SearchGPT rows ({len(sgpt)}) ===")
        for s in sgpt:
            print(
                f"  id={s['id']}"
                f" job={s['job_id']}"
                f" answer={s['has_answer']} (len={s['ans_len']})"
                f" raw={s['has_raw']} (len={s['raw_len']})"
                f" term={s['poll_terminal_reason']}"
                f" att={s['poll_attempts']}"
            )

        # Distribution of poll_terminal_reason for SearchGPT
        reasons = await conn.fetch(
            """
            SELECT poll_terminal_reason, count(*) AS n
            FROM llm_responses
            WHERE audit_id = $1 AND llm = 'searchgpt'
            GROUP BY poll_terminal_reason
            ORDER BY n DESC
            """,
            audit_id,
        )
        print("\n=== SearchGPT poll_terminal_reason distribution ===")
        for r in reasons:
            print(f"  {r['poll_terminal_reason']!r}: {r['n']}")

        # Show one full raw_response_data sample to understand its shape
        sample = await conn.fetchrow(
            """
            SELECT id, raw_response_data
            FROM llm_responses
            WHERE audit_id = $1 AND llm = 'searchgpt'
              AND raw_response_data IS NOT NULL
            LIMIT 1
            """,
            audit_id,
        )
        if sample:
            import json
            raw = sample["raw_response_data"]
            try:
                obj = json.loads(raw) if isinstance(raw, str) else raw
                print(f"\n=== SAMPLE raw_response_data for searchgpt id={sample['id']} ===")
                if isinstance(obj, dict):
                    print(f"  top-level keys: {list(obj.keys())}")
                    for k, v in obj.items():
                        snippet = str(v)[:200]
                        print(f"    {k}: {snippet}")
                else:
                    print(f"  type={type(obj).__name__}, value={str(obj)[:400]}")
            except Exception as e:
                print(f"  parse error: {e}, raw[:400]={str(raw)[:400]}")

        # Compare to a perplexity sample for shape diff
        sample_p = await conn.fetchrow(
            """
            SELECT id, raw_response_data
            FROM llm_responses
            WHERE audit_id = $1 AND llm = 'perplexity'
              AND raw_response_data IS NOT NULL AND answer_text IS NOT NULL
            LIMIT 1
            """,
            audit_id,
        )
        if sample_p:
            import json
            raw = sample_p["raw_response_data"]
            try:
                obj = json.loads(raw) if isinstance(raw, str) else raw
                print(f"\n=== SAMPLE raw_response_data for perplexity id={sample_p['id']} (working) ===")
                if isinstance(obj, dict):
                    print(f"  top-level keys: {list(obj.keys())}")
            except Exception as e:
                print(f"  parse error: {e}")

        # 5) Number of prompts in the project vs SearchGPT row count
        cnt_prompts = await conn.fetchval(
            "SELECT count(*) FROM prompts WHERE project_id = $1", project_id
        )
        cnt_sgpt = await conn.fetchval(
            "SELECT count(*) FROM llm_responses WHERE audit_id = $1 AND llm = 'searchgpt'",
            audit_id,
        )
        print(f"\nproject prompts = {cnt_prompts}, audit searchgpt rows = {cnt_sgpt}")

        # Check audit_pipeline_log columns
        log_cols = await conn.fetch(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name='audit_pipeline_log' ORDER BY ordinal_position
            """
        )
        print(f"\n=== audit_pipeline_log cols: {[c['column_name'] for c in log_cols]}")

        log = await conn.fetch(
            """
            SELECT *
            FROM audit_pipeline_log
            WHERE audit_id = $1
            ORDER BY created_at DESC
            LIMIT 40
            """,
            audit_id,
        )
        print(f"\n=== PIPELINE LOG (last {len(log)}) ===")
        for ev in reversed(list(log)):
            print(f"  {dict(ev)}")

        # 7) Cross-audit picture: how widespread is polling_timeout for SearchGPT?
        wide = await conn.fetch(
            """
            SELECT a.id AS audit_id, p.name AS project,
                   count(*) FILTER (WHERE r.poll_terminal_reason = 'polling_timeout') AS sgpt_timeouts,
                   count(*) AS sgpt_total
            FROM audits a
            JOIN projects p ON p.id = a.project_id
            JOIN llm_responses r ON r.audit_id = a.id
            WHERE r.llm = 'searchgpt'
              AND a.started_at >= now() - interval '7 days'
            GROUP BY a.id, p.name
            HAVING count(*) FILTER (WHERE r.poll_terminal_reason = 'polling_timeout') > 0
            ORDER BY sgpt_timeouts DESC
            LIMIT 20
            """
        )
        print(f"\n=== SearchGPT polling_timeout — last 7d ({len(wide)} audits) ===")
        for w in wide:
            print(
                f"  {w['sgpt_timeouts']:>4}/{w['sgpt_total']:<4}"
                f"  {w['project'][:50]:<50}  audit={w['audit_id']}"
            )

    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
