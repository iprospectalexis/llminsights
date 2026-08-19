"""Return a completed-with-gaps audit to the polling state.

For audits whose rows were prematurely swept as provider_no_response while
their (fallback) jobs were still running: the jobs have since completed and
their results sit in OneSearch. Resetting the swept rows to pending and
putting the audit back into `polling` lets the normal pipeline match the
ready results on the next tick, then run competitors/sentiment for the
recovered rows and complete the audit through the standard path.

Only rows with poll_terminal_reason='provider_no_response' AND no answer
are reset; answered rows and other terminal reasons are untouched.

Dry-run by default. Usage:
    docker exec llmi python resurrect_audit_polling.py <audit_id>
    docker exec llmi python resurrect_audit_polling.py <audit_id> --apply
"""
import asyncio
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal


async def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("usage: resurrect_audit_polling.py <audit_id> [--apply]")
        return
    audit_id = args[0]
    apply = "--apply" in sys.argv

    async with AsyncSessionLocal() as s:
        audit = (await s.execute(text(
            "SELECT id, status, pipeline_state, finished_at FROM audits WHERE id = :a"
        ), {"a": audit_id})).mappings().first()
        if not audit:
            print(f"audit {audit_id} not found")
            return
        n = (await s.execute(text("""
            SELECT count(*) FROM llm_responses
            WHERE audit_id = :a AND poll_terminal_reason = 'provider_no_response'
              AND (answer_text IS NULL OR answer_text = '')
        """), {"a": audit_id})).scalar()
        print(f"audit: {audit['status']}/{audit['pipeline_state']}, "
              f"finished {audit['finished_at']}", flush=True)
        print(f"rows to reset: {n}", flush=True)
        if not apply:
            print("DRY-RUN — nothing written. Re-run with --apply.", flush=True)
            return
        if not n:
            print("nothing to reset", flush=True)
            return

        await s.execute(text("""
            UPDATE llm_responses
            SET poll_terminal_reason = NULL, poll_attempts = 0
            WHERE audit_id = :a AND poll_terminal_reason = 'provider_no_response'
              AND (answer_text IS NULL OR answer_text = '')
        """), {"a": audit_id})
        await s.execute(text("""
            UPDATE audits SET
                status = 'running', pipeline_state = 'polling',
                pipeline_state_entered_at = now(), finished_at = NULL,
                locked_by = NULL, locked_at = NULL, current_step = 'polling',
                error_message = NULL, progress = 60
            WHERE id = :a
        """), {"a": audit_id})
        await s.commit()
        print(f"reset {n} rows; audit returned to polling — the scheduler "
              f"will pick it up within a tick", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
