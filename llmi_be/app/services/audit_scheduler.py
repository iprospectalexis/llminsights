"""
Audit scheduler — single-owner model using audit_pipeline state machine.

Runs every 15s. For each active audit:
  1. Try to claim it (CAS lock)
  2. Process the current pipeline step
  3. Release the lock

Also handles scheduled-audit dispatch (every minute) — finds projects whose
`next_scheduled_audit_at` is due and triggers the same `run_audit` flow used
by the manual UI button. This replaces the legacy `process-scheduled-audits-job`
pg_cron, which dispatched via a Supabase edge function and produced audits
with `pipeline_state='created'` that the pipeline never picked up.

On startup, `recover_stale_audits()` re-activates any audits that were running
when the previous process died (stale `last_activity_at` > 5 min).

Only ONE executor processes each audit at a time.
"""

import asyncio
import logging
from datetime import datetime, timezone

from app.services import audit_pipeline
from app.services.audit_pipeline import WORKER_ID

logger = logging.getLogger(__name__)

# Max concurrent audit processing
_semaphore = asyncio.Semaphore(3)
_in_flight: set[str] = set()  # audit IDs currently being processed (prevents overlapping tasks)
_running = False
_scheduled_tick_counter = 0  # only dispatch scheduled audits every Nth tick

# ── Scheduler heartbeat ──────────────────────────────────────────────
# Updated every tick so external callers (health endpoint) can detect a
# dead scheduler without querying Postgres.
_last_tick_at: datetime | None = None
_tick_count: int = 0


def get_scheduler_health() -> dict:
    """Return scheduler liveness info (called by the health API)."""
    now = datetime.now(timezone.utc)
    stale_seconds = (
        round((now - _last_tick_at).total_seconds()) if _last_tick_at else None
    )
    return {
        "alive": _running and _last_tick_at is not None,
        "last_tick": _last_tick_at.isoformat() if _last_tick_at else None,
        "stale_seconds": stale_seconds,
        "tick_count": _tick_count,
        "worker_id": WORKER_ID,
    }


async def recover_stale_audits():
    """Re-activate audits stranded by a previous process crash.

    Called once on startup. Finds audits stuck in an active pipeline state
    with stale `last_activity_at` (> 5 min), clears their lock, and bumps
    `last_activity_at` so the scheduler picks them up on the first tick.
    """
    from app.database import AsyncSessionLocal
    from sqlalchemy import text

    try:
        async with AsyncSessionLocal() as s:
            result = await s.execute(text("""
                UPDATE audits
                SET locked_by = NULL,
                    locked_at = NULL,
                    last_activity_at = now(),
                    error_message = COALESCE(
                        NULLIF(error_message, ''),
                        'Recovered after scheduler restart'
                    )
                WHERE status = 'running'
                  AND pipeline_state IN (
                      'polling', 'extracting_competitors',
                      'analyzing_sentiment', 'finalizing'
                  )
                  AND COALESCE(last_activity_at, started_at, created_at)
                      < now() - interval '5 minutes'
                RETURNING id, pipeline_state
            """))
            recovered = result.fetchall()
            await s.commit()

        if recovered:
            for row in recovered:
                logger.warning(
                    f"[startup-recovery] Recovered stale audit {row[0]} "
                    f"(state={row[1]}) — will resume on next tick"
                )
            logger.info(f"[startup-recovery] Recovered {len(recovered)} stale audit(s)")
        else:
            logger.info("[startup-recovery] No stale audits to recover")
    except Exception as e:
        logger.error(f"[startup-recovery] Failed: {e}", exc_info=True)


async def start_scheduler():
    """Start the background scheduling loop."""
    global _running
    _running = True
    logger.info(f"Audit scheduler started (worker={WORKER_ID}, 15s interval, max 3 concurrent)")

    # Recover any audits stranded by a previous crash
    await recover_stale_audits()

    while _running:
        try:
            await _scheduler_tick()
        except Exception as e:
            logger.error(f"Scheduler tick error: {e}")
        await asyncio.sleep(15)


def stop_scheduler():
    """Signal the scheduler to stop."""
    global _running
    _running = False
    logger.info("Audit scheduler stopped")


async def _dispatch_scheduled_audits():
    """
    Find projects whose `next_scheduled_audit_at` is due and create an audit
    for each via the same code path as the manual UI button. Updates
    `next_scheduled_audit_at` to the next occurrence so we don't double-fire.

    Replaces the legacy `process-scheduled-audits-job` pg_cron.
    """
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    from fastapi import BackgroundTasks
    from app.api.v1.endpoints.audits import run_audit, RunAuditRequest

    async with AsyncSessionLocal() as s:
        # Find due projects, skip those that already have a running audit.
        rows = (await s.execute(text("""
            SELECT p.id, p.name, p.schedule_frequency, p.schedule_time,
                   p.schedule_day_of_week, p.schedule_day_of_month, p.schedule_timezone
            FROM projects p
            WHERE p.scheduled_audits_enabled = true
              AND p.next_scheduled_audit_at IS NOT NULL
              AND p.next_scheduled_audit_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM audits a
                WHERE a.project_id = p.id
                  AND a.status IN ('pending', 'running')
              )
            LIMIT 20
        """))).mappings().all()

    if not rows:
        return

    logger.info(f"Scheduler: dispatching {len(rows)} scheduled audit(s)")

    for proj in rows:
        proj_id = str(proj["id"])
        try:
            req = RunAuditRequest(projectId=proj_id, isScheduled=True)
            bg = BackgroundTasks()
            result = await run_audit(req, bg)
            # Manually run the background task chain (we're not in a request scope).
            for task in bg.tasks:
                asyncio.create_task(task())
            logger.info(
                f"Scheduler: triggered scheduled audit for project {proj['name']} "
                f"({proj_id}) → audit {result.get('auditId')}"
            )
        except Exception as e:
            logger.error(
                f"Scheduler: failed to trigger scheduled audit for project {proj_id}: {e}",
                exc_info=True,
            )
            # Push next_scheduled_audit_at forward by 1h to avoid retry storm
            try:
                async with AsyncSessionLocal() as s:
                    await s.execute(text("""
                        UPDATE projects SET next_scheduled_audit_at = now() + interval '1 hour'
                        WHERE id = :pid
                    """), {"pid": proj_id})
                    await s.commit()
            except Exception:
                pass
            continue

        # Compute next run time via the existing SQL helper (handles freq + tz).
        try:
            async with AsyncSessionLocal() as s:
                next_row = (await s.execute(text("""
                    SELECT calculate_next_scheduled_run(
                        :freq, :time, :dow, :dom, :tz
                    ) AS next_run
                """), {
                    "freq": proj["schedule_frequency"],
                    "time": proj["schedule_time"],
                    "dow": proj["schedule_day_of_week"],
                    "dom": proj["schedule_day_of_month"],
                    "tz": proj["schedule_timezone"],
                })).mappings().first()
                next_run = (next_row or {}).get("next_run")

                await s.execute(text("""
                    UPDATE projects
                    SET last_scheduled_audit_at = now(),
                        next_scheduled_audit_at = :next_run
                    WHERE id = :pid
                """), {"pid": proj_id, "next_run": next_run})
                await s.commit()
        except Exception as e:
            logger.error(f"Scheduler: failed to update next_scheduled_audit_at for {proj_id}: {e}")


async def _scheduler_tick():
    """One tick — find active audits and process them."""
    global _scheduled_tick_counter, _last_tick_at, _tick_count
    _last_tick_at = datetime.now(timezone.utc)
    _tick_count += 1

    # Release stale locks first (workers that died)
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text
        async with AsyncSessionLocal() as s:
            result = await s.execute(text("SELECT release_stale_audit_locks()"))
            released = result.scalar()
            if released and released > 0:
                logger.info(f"Scheduler: released {released} stale lock(s)")
            await s.commit()
    except Exception as e:
        logger.warning(f"Scheduler: stale lock cleanup error: {e}")

    # Dispatch scheduled audits every 4th tick (~ every 60s with 15s tick).
    _scheduled_tick_counter += 1
    if _scheduled_tick_counter % 4 == 0:
        try:
            await _dispatch_scheduled_audits()
        except Exception as e:
            logger.error(f"Scheduler: scheduled-audit dispatch error: {e}", exc_info=True)

        # Auto-fail audits with no activity for 60 min, regardless of which
        # in-progress state they are stuck in. Generalises the polling-only
        # 30-min deadline and catches the `fetching → polling` handoff hole
        # where a failed _trigger_jobs leaves an audit invisible to recovery.
        try:
            from app.database import AsyncSessionLocal
            from sqlalchemy import text
            async with AsyncSessionLocal() as s:
                # Auto-COMPLETE audits with progress >= 90 (data fully processed,
                # only finalization/metrics missing — safer to mark completed).
                completed_result = await s.execute(text("""
                    UPDATE audits
                    SET status = 'completed',
                        pipeline_state = 'completed',
                        progress = 100,
                        current_step = NULL,
                        finished_at = now(),
                        locked_by = NULL,
                        locked_at = NULL,
                        error_message = NULL
                    WHERE pipeline_state IN ('finalizing', 'analyzing_sentiment')
                      AND progress >= 90
                      AND COALESCE(last_activity_at, started_at, created_at) < now() - interval '60 minutes'
                    RETURNING id
                """))
                auto_completed = completed_result.fetchall()
                if auto_completed:
                    logger.warning(
                        f"Scheduler: auto-completed {len(auto_completed)} near-done audit(s): "
                        f"{[str(r[0]) for r in auto_completed]}"
                    )

                # Auto-FAIL the rest (early stages or low progress — genuinely stuck).
                result = await s.execute(text("""
                    UPDATE audits
                    SET status = 'failed',
                        pipeline_state = 'failed',
                        current_step = NULL,
                        finished_at = now(),
                        locked_by = NULL,
                        locked_at = NULL,
                        error_message = COALESCE(error_message, 'Auto-failed: no activity for 60 minutes')
                    WHERE pipeline_state IN ('fetching','polling','extracting_competitors','analyzing_sentiment','finalizing')
                      AND progress < 90
                      AND COALESCE(last_activity_at, started_at, created_at) < now() - interval '60 minutes'
                    RETURNING id
                """))
                killed = result.fetchall()
                await s.commit()
                if killed:
                    logger.warning(
                        f"Scheduler: auto-failed {len(killed)} stuck audit(s): "
                        f"{[str(r[0]) for r in killed]}"
                    )
        except Exception as e:
            logger.error(f"Scheduler: auto-fail sweep error: {e}", exc_info=True)

        # Staleness warning: flag audits with no activity for 5+ min (pre-zombie detection)
        try:
            async with AsyncSessionLocal() as s:
                stale_rows = (await s.execute(text("""
                    SELECT id, pipeline_state,
                           EXTRACT(EPOCH FROM now() - COALESCE(last_activity_at, started_at, created_at))::int AS stale_seconds
                    FROM audits
                    WHERE pipeline_state IN ('fetching','polling','extracting_competitors','analyzing_sentiment','finalizing')
                      AND COALESCE(last_activity_at, started_at, created_at) < now() - interval '5 minutes'
                """))).fetchall()
                for row in stale_rows:
                    logger.warning(
                        f"Scheduler: audit {row[0]} stale for {row[2]}s in state '{row[1]}' — may become zombie"
                    )
        except Exception as e:
            logger.warning(f"Scheduler: staleness check error: {e}")

    # Get active audits
    active_audits = await audit_pipeline.get_active_audits()
    if not active_audits:
        return

    logger.info(f"Scheduler: {len(active_audits)} active audit(s) ({len(_in_flight)} in-flight)")

    async def _process_one(audit: dict):
        audit_id = str(audit["id"])
        # Guard: skip if a task from a previous tick is still processing this audit.
        # Without this, overlapping ticks create duplicate tasks that fight over
        # CAS locks and corrupt state transitions.
        if audit_id in _in_flight:
            return
        _in_flight.add(audit_id)
        try:
            async with _semaphore:
                claimed = await audit_pipeline.try_claim(audit_id, WORKER_ID)
                if not claimed:
                    return  # Another worker/tick owns it

                try:
                    await audit_pipeline.process_step(audit, WORKER_ID)
                except Exception as e:
                    logger.error(f"Scheduler pipeline error for {audit_id}: {e}")
                finally:
                    await audit_pipeline.release(audit_id, WORKER_ID)
        finally:
            _in_flight.discard(audit_id)

    # Fire-and-forget: don't block the tick on in-flight work. The semaphore
    # caps real concurrency at 5; the _in_flight set prevents duplicate tasks
    # for the same audit across overlapping ticks.
    for a in active_audits:
        asyncio.create_task(_process_one(a))
