"""
Recover audits that failed at polling stage when the provider was
slow but the data is still available on the OneSearch backend.

Symptom this fixes:
  status='failed'
  error_message='Polling finished but 0/N responses contain data...'
  llm_responses rows have job_id set and poll_terminal_reason='provider_no_response'

What it does:
  1. Find the most recent failed audit per supplied project_id (or all
     audits with that exact error message if no project filter).
  2. For each, reset its llm_responses rows that have a job_id but no
     answer_text — clear poll_attempts and poll_terminal_reason.
  3. Reset the audit itself back to pipeline_state='polling',
     status='running' so the scheduler picks it up again and re-polls
     OneSearch — which by now has the data ready.

Safe to re-run: idempotent (only touches rows still in the failed
"no provider data" state).

Usage (on VPS):
    docker cp recover_polling_audits.py llmi:/app/
    docker exec llmi python /app/recover_polling_audits.py
    # or with explicit project ids:
    docker exec llmi python /app/recover_polling_audits.py <project_id_1> <project_id_2>
"""
import asyncio
import sys

from sqlalchemy import text

from app.database import async_engine


FAILED_POLL_MSG_PREFIX = "Polling finished but"


async def recover_one(conn, audit_id: str) -> dict:
    # Reset llm_responses: clear terminal flag + poll_attempts for rows
    # that have a job_id and still no answer_text.
    reset = (await conn.execute(text("""
        UPDATE llm_responses
        SET poll_terminal_reason = NULL,
            poll_attempts = 0,
            last_polled_at = NULL
        WHERE audit_id = :aid
          AND job_id IS NOT NULL
          AND (answer_text IS NULL OR answer_text = '')
          AND poll_terminal_reason IS NOT NULL
        RETURNING id
    """), {"aid": audit_id})).fetchall()

    # Reset audit to polling state so scheduler picks it up.
    audit_row = (await conn.execute(text("""
        UPDATE audits
        SET status = 'running',
            pipeline_state = 'polling',
            progress = 10,
            current_step = 'getting_results',
            finished_at = NULL,
            error_message = NULL,
            locked_by = NULL,
            locked_at = NULL,
            last_activity_at = now(),
            pipeline_state_entered_at = now()
        WHERE id = :aid
        RETURNING id, project_id
    """), {"aid": audit_id})).first()

    return {
        "audit_id": audit_id,
        "rows_reset": len(reset),
        "audit_reset": audit_row is not None,
    }


async def main():
    explicit_projects = [a.strip() for a in sys.argv[1:] if a.strip()]
    async with async_engine.begin() as conn:
        if explicit_projects:
            rows = (await conn.execute(text("""
                SELECT id, project_id, error_message
                FROM audits
                WHERE project_id::text = ANY(:pids)
                  AND status = 'failed'
                  AND error_message LIKE :prefix
                ORDER BY created_at DESC
            """), {"pids": explicit_projects, "prefix": f"{FAILED_POLL_MSG_PREFIX}%"})).mappings().all()
        else:
            # All audits across all projects that match this exact failure mode
            rows = (await conn.execute(text("""
                SELECT id, project_id, error_message
                FROM audits
                WHERE status = 'failed'
                  AND error_message LIKE :prefix
                ORDER BY created_at DESC
            """), {"prefix": f"{FAILED_POLL_MSG_PREFIX}%"})).mappings().all()

        if not rows:
            print("No matching failed audits found.")
            return

        print(f"Found {len(rows)} failed audit(s) to recover:\n")
        for r in rows:
            print(f"  - {r['id']} (project {r['project_id']})")
            print(f"    {r['error_message']}")
        print()

        for r in rows:
            result = await recover_one(conn, str(r["id"]))
            print(f"Recovered {result['audit_id']}: "
                  f"{result['rows_reset']} rows reset, audit reset: {result['audit_reset']}")

    print("\nDone. Scheduler will pick up the audits within 15s and re-poll OneSearch.")
    print("Monitor with: docker logs -f llmi 2>&1 | grep '\\[polling\\]'")


if __name__ == "__main__":
    asyncio.run(main())
