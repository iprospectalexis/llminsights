"""
cleanup_test_maeva_garbage_audit.py

One-shot cleanup for the force-completed garbage audit on Test_Maeva
(project 624ccdcf-f9a8-4cea-884a-1bb38d4d987d).

Context: audit c909051d-7dcc-4e38-b693-32aeaf6129d4 was created 2026-04-09
while the backend container was down (DATABASE_URL_OVERRIDE pointed at the
IPv6-only direct endpoint on docker bridge). The pipeline never started —
all 16 llm_responses have job_id=NULL, poll_attempts=0, answer_text=NULL,
zero citations, zero rbs, zero audit_pipeline_log entries — but a legacy
force-complete cron wrote status='completed', progress=100, finished_at.
That bogus "latest audit" is what poisons ProjectDetailPage's default
`lastAudit` filter and makes every widget / table / graph on the Test_Maeva
page appear empty, hiding the real successful run from 2026-04-08.

This script:
  1. Sanity-checks that the audit has zero data (refuses to run otherwise)
  2. In dry-run (default), prints what it would delete
  3. With --apply, deletes the audit inside a transaction — the existing
     ON DELETE CASCADE FKs from llm_responses / citations /
     response_brand_sentiment / audit_pipeline_log take care of the rest.

Usage:
    python cleanup_test_maeva_garbage_audit.py           # dry-run
    python cleanup_test_maeva_garbage_audit.py --apply   # actually delete
"""
from __future__ import annotations

import argparse
import asyncio
import ssl
import sys

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)
PROJECT_ID = "624ccdcf-f9a8-4cea-884a-1bb38d4d987d"
AUDIT_ID = "c909051d-7dcc-4e38-b693-32aeaf6129d4"


async def main(apply: bool) -> int:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        print("=" * 72)
        print("Sanity check")
        print("=" * 72)
        row = await conn.fetchrow(
            """
            SELECT a.id,
                   a.project_id,
                   a.status,
                   a.pipeline_state,
                   a.responses_expected,
                   a.responses_received,
                   a.created_at,
                   (SELECT count(*) FROM llm_responses     WHERE audit_id = a.id) AS lr_total,
                   (SELECT count(*) FROM llm_responses
                       WHERE audit_id = a.id AND answer_text IS NOT NULL)        AS lr_with_answer,
                   (SELECT count(*) FROM llm_responses
                       WHERE audit_id = a.id AND job_id IS NOT NULL)             AS lr_with_job,
                   (SELECT count(*) FROM citations         WHERE audit_id = a.id) AS cit,
                   (SELECT count(*) FROM response_brand_sentiment
                       WHERE audit_id = a.id)                                    AS rbs,
                   (SELECT count(*) FROM audit_pipeline_log
                       WHERE audit_id = a.id)                                    AS log_entries
            FROM audits a
            WHERE a.id = $1
            """,
            AUDIT_ID,
        )
        if row is None:
            print(f"Audit {AUDIT_ID} not found — already deleted?")
            return 0

        for k, v in dict(row).items():
            print(f"  {k:<20} {v}")

        if str(row["project_id"]) != PROJECT_ID:
            print()
            print(f"ABORT: audit belongs to project {row['project_id']}, "
                  f"not expected {PROJECT_ID}.")
            return 2

        # Refuse if anything looks like real data.
        checks = {
            "responses_received": row["responses_received"],
            "lr_with_answer": row["lr_with_answer"],
            "lr_with_job": row["lr_with_job"],
            "citations": row["cit"],
            "response_brand_sentiment": row["rbs"],
            "audit_pipeline_log entries": row["log_entries"],
        }
        non_zero = [k for k, v in checks.items() if (v or 0) > 0]
        if non_zero:
            print()
            print("ABORT: audit has non-zero data on:",
                  ", ".join(non_zero))
            print("Refusing to delete — investigate manually.")
            return 3

        print()
        print("All sanity checks pass — audit is empty.")
        print()

        if not apply:
            print("=" * 72)
            print("DRY RUN — no changes made. Rerun with --apply to delete.")
            print("=" * 72)
            return 0

        print("=" * 72)
        print("Applying DELETE (with ON DELETE CASCADE to children)")
        print("=" * 72)
        async with conn.transaction():
            deleted = await conn.execute(
                """
                DELETE FROM audits
                WHERE id = $1
                  AND project_id = $2
                  AND responses_received = 0
                """,
                AUDIT_ID,
                PROJECT_ID,
            )
            print(f"  DELETE result: {deleted}")

        # Confirm.
        still = await conn.fetchval(
            "SELECT count(*) FROM audits WHERE id = $1", AUDIT_ID
        )
        remaining = await conn.fetch(
            """
            SELECT id, status, pipeline_state, responses_received,
                   created_at
            FROM audits
            WHERE project_id = $1
            ORDER BY created_at DESC
            """,
            PROJECT_ID,
        )
        print(f"  Post-delete count for {AUDIT_ID}: {still}")
        print(f"  Remaining audits in Test_Maeva: {len(remaining)}")
        for r in remaining:
            print(f"    {str(r['id'])[:8]}  {r['status']:<10} "
                  f"{r['pipeline_state']:<12} received={r['responses_received']}  "
                  f"{r['created_at'].isoformat()}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete the audit. Without this flag, runs in dry-run.",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(apply=args.apply)))
