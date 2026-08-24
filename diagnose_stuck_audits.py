"""Diagnose audits stuck in pipeline_state='polling' (UI label 'Receiving answers').

Pulls the 4 most recent audits that are NOT in a terminal status
(completed / failed / cancelled) and for each one prints:

  - identity: project, started_at, age, status, pipeline_state
  - scheduler liveness: last_activity_at (heartbeat), worker_id
  - llm_responses breakdown per LLM:
        total, with_answer, active_pending, terminal (+ reason counts),
        poll_attempts distribution, min/max last_polled_at
  - recent pipeline log tail (10 entries)

Safe — read-only. Run locally against prod pooler.
"""
from __future__ import annotations

import asyncio
import ssl
from datetime import datetime, timezone

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)


def _age(ts: datetime | None) -> str:
    if ts is None:
        return "—"
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - ts
    s = int(delta.total_seconds())
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m{s % 60:02d}s ago"
    h = s // 3600
    m = (s % 3600) // 60
    return f"{h}h{m:02d}m ago"


async def main() -> None:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)

    try:
        # 1) Find the 4 most recently started audits that are not terminal.
        rows = await conn.fetch(
            """
            SELECT a.id, a.project_id, a.status, a.pipeline_state,
                   a.current_step, a.started_at, a.last_activity_at,
                   a.error_message, a.responses_expected, a.responses_received,
                   a.llms, a.locked_by, a.locked_at,
                   p.name AS project_name
            FROM audits a
            LEFT JOIN projects p ON p.id = a.project_id
            WHERE a.status NOT IN ('completed', 'failed', 'cancelled')
            ORDER BY a.started_at DESC NULLS LAST
            LIMIT 4
            """
        )

        if not rows:
            print("No non-terminal audits found.")
            return

        print(f"Found {len(rows)} non-terminal audits:\n")
        for i, a in enumerate(rows, 1):
            aid = str(a["id"])
            print("=" * 80)
            print(f"[{i}] {a['project_name']}")
            print(f"    audit_id       = {aid}")
            print(f"    status         = {a['status']}")
            print(f"    pipeline_state = {a['pipeline_state']}")
            print(f"    current_step   = {a['current_step']}")
            print(f"    llms           = {a['llms']}")
            print(f"    started_at     = {a['started_at']}  ({_age(a['started_at'])})")
            print(f"    last_activity  = {a['last_activity_at']}  ({_age(a['last_activity_at'])})")
            print(f"    locked_by      = {a['locked_by']}  at {a['locked_at']} ({_age(a['locked_at'])})")
            print(f"    expected/recvd = {a['responses_expected']} / {a['responses_received']}")
            if a["error_message"]:
                print(f"    error_message  = {a['error_message'][:200]}")

            # 2) Per-LLM llm_responses breakdown
            per_llm = await conn.fetch(
                """
                SELECT llm,
                       count(*)                                                 AS total,
                       count(*) FILTER (WHERE answer_text IS NOT NULL)          AS with_answer,
                       count(*) FILTER (WHERE poll_terminal_reason IS NOT NULL) AS terminal,
                       count(*) FILTER (
                         WHERE answer_text IS NULL
                           AND poll_terminal_reason IS NULL
                       ) AS active_pending,
                       count(*) FILTER (WHERE job_id IS NOT NULL)               AS with_job,
                       count(*) FILTER (WHERE snapshot_id IS NOT NULL)          AS with_snap,
                       count(*) FILTER (WHERE job_id IS NULL AND snapshot_id IS NULL) AS orphan,
                       min(first_polled_at)                                     AS first_poll,
                       max(last_polled_at)                                      AS last_poll,
                       coalesce(max(poll_attempts), 0)                          AS max_att,
                       coalesce(avg(poll_attempts), 0)::numeric(10,1)           AS avg_att
                FROM llm_responses
                WHERE audit_id = $1
                GROUP BY llm
                ORDER BY llm
                """,
                aid,
            )
            print("\n    Per-LLM llm_responses breakdown:")
            print(f"    {'llm':<20} {'tot':>4} {'ans':>4} {'actv':>4} {'term':>4} "
                  f"{'job':>4} {'snap':>4} {'orph':>4} {'maxA':>4} {'avgA':>5}  last_poll")
            for r in per_llm:
                print(
                    f"    {r['llm']:<20} "
                    f"{r['total']:>4} {r['with_answer']:>4} {r['active_pending']:>4} "
                    f"{r['terminal']:>4} {r['with_job']:>4} {r['with_snap']:>4} "
                    f"{r['orphan']:>4} {r['max_att']:>4} {r['avg_att']:>5}  "
                    f"{_age(r['last_poll'])}"
                )

            # 3) Terminal reasons if any
            term_reasons = await conn.fetch(
                """
                SELECT llm, poll_terminal_reason, count(*) AS n
                FROM llm_responses
                WHERE audit_id = $1 AND poll_terminal_reason IS NOT NULL
                GROUP BY llm, poll_terminal_reason
                ORDER BY llm, n DESC
                """,
                aid,
            )
            if term_reasons:
                print("\n    Terminal reasons:")
                for r in term_reasons:
                    print(f"      {r['llm']:<20} {r['poll_terminal_reason']:<25} {r['n']:>4}")

            # 4) Active-pending rows — what they look like
            active_sample = await conn.fetch(
                """
                SELECT llm, job_id, snapshot_id, poll_attempts,
                       first_polled_at, last_polled_at
                FROM llm_responses
                WHERE audit_id = $1
                  AND answer_text IS NULL
                  AND poll_terminal_reason IS NULL
                ORDER BY last_polled_at NULLS FIRST
                LIMIT 5
                """,
                aid,
            )
            if active_sample:
                print(f"\n    Sample active_pending rows (up to 5, oldest last_polled first):")
                for r in active_sample:
                    jid = (r["job_id"] or "")[:8] if r["job_id"] else "—"
                    snap = (r["snapshot_id"] or "")[:8] if r["snapshot_id"] else "—"
                    print(
                        f"      {r['llm']:<20} job={jid} snap={snap} "
                        f"att={r['poll_attempts']} last_poll={_age(r['last_polled_at'])}"
                    )

            # 5) Distinct job_ids for this audit (useful — one batch per LLM)
            jobs = await conn.fetch(
                """
                SELECT llm, job_id, count(*) AS n,
                       count(*) FILTER (WHERE answer_text IS NOT NULL) AS ans
                FROM llm_responses
                WHERE audit_id = $1 AND job_id IS NOT NULL
                GROUP BY llm, job_id
                ORDER BY llm
                """,
                aid,
            )
            if jobs:
                print(f"\n    Job IDs:")
                for r in jobs:
                    print(
                        f"      {r['llm']:<20} job={r['job_id']} "
                        f"rows={r['n']} answered={r['ans']}"
                    )

            # 6) Recent pipeline log
            log = await conn.fetch(
                """
                SELECT state, phase, level, message, created_at
                FROM audit_pipeline_log
                WHERE audit_id = $1
                ORDER BY created_at DESC
                LIMIT 10
                """,
                aid,
            )
            if log:
                print(f"\n    Pipeline log (last 10):")
                for r in reversed(list(log)):
                    ts = r["created_at"].strftime("%H:%M:%S") if r["created_at"] else "—"
                    msg = (r["message"] or "")[:100]
                    print(
                        f"      {ts}  [{r['level'] or '?':<5}] "
                        f"{(r['state'] or '?'):<22} {(r['phase'] or '—'):<28} {msg}"
                    )
            print()

        # 7) Global: is the scheduler alive at all? Look at the most recent
        # heartbeat across ALL running audits — if it's old, the worker is dead.
        print("=" * 80)
        print("Scheduler liveness (newest last_activity_at across all running audits):")
        global_liveness = await conn.fetch(
            """
            SELECT id, pipeline_state, last_activity_at, locked_by
            FROM audits
            WHERE status NOT IN ('completed', 'failed', 'cancelled')
              AND last_activity_at IS NOT NULL
            ORDER BY last_activity_at DESC
            LIMIT 5
            """
        )
        for r in global_liveness:
            print(
                f"  {str(r['id'])[:8]}  state={r['pipeline_state']:<24} "
                f"worker={r['locked_by']}  {_age(r['last_activity_at'])}"
            )

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
