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

Only ONE executor processes each audit at a time.
"""

import asyncio
import logging

from app.services import audit_pipeline
from app.services.audit_pipeline import WORKER_ID

logger = logging.getLogger(__name__)

# Max concurrent audit processing
_semaphore = asyncio.Semaphore(5)
_running = False
_scheduled_tick_counter = 0  # only dispatch scheduled audits every Nth tick


async def start_scheduler():
    """Start the background scheduling loop."""
    global _running
    _running = True
    logger.info(f"Audit scheduler started (worker={WORKER_ID}, 15s interval, max 5 concurrent)")

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
    global _scheduled_tick_counter

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

    # Get active audits
    active_audits = await audit_pipeline.get_active_audits()
    if not active_audits:
        return

    logger.info(f"Scheduler: {len(active_audits)} active audit(s)")

    async def _process_one(audit: dict):
        async with _semaphore:
            audit_id = str(audit["id"])
            claimed = await audit_pipeline.try_claim(audit_id, WORKER_ID)
            if not claimed:
                return  # Another worker/tick owns it

            try:
                await audit_pipeline.process_step(audit, WORKER_ID)
            except Exception as e:
                logger.error(f"Scheduler pipeline error for {audit_id}: {e}")
            finally:
                await audit_pipeline.release(audit_id, WORKER_ID)

    tasks = [_process_one(a) for a in active_audits]
    await asyncio.gather(*tasks, return_exceptions=True)
