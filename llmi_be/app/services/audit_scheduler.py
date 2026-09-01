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
import os
from datetime import datetime, timezone

from app.services import audit_pipeline
from app.services.audit_pipeline import WORKER_ID

logger = logging.getLogger(__name__)

# Max concurrent audit processing
_semaphore = asyncio.Semaphore(3)
_in_flight: set[str] = set()  # audit IDs currently being processed (prevents overlapping tasks)
_running = False
_scheduled_tick_counter = 0  # only dispatch scheduled audits every Nth tick

# ── Hang protection ──────────────────────────────────────────────────
# 2026-09-01: a wedged asyncpg connection (client command timeout whose
# CancelRequest the pooler never acknowledged) blocked the tick coroutine
# in an await that could never complete. No exception, so the tick loop's
# try/except never fired; /health stayed 200; five audits sat untouched
# for 11 hours. Three independent guards now bound that failure:
#   1. every tick runs under a timeout — a hung tick is abandoned and the
#      loop goes on;
#   2. every per-audit handler runs under a ceiling — a hung handler frees
#      its semaphore slot (there are only 3) and its _in_flight entry;
#   3. a watchdog restarts the process when ticks stop for good — Docker's
#      restart policy brings it back and recover_stale_audits() resumes
#      the work.
TICK_TIMEOUT_S = 180
# Handlers are bounded by MAX_BATCHES_PER_INVOCATION (≤ ~5 min); the SQL
# zombie watchdog fails an audit stuck in one state after 45 min. This
# ceiling only has to be lower than "forever".
HANDLER_CEILING_S = 40 * 60
WATCHDOG_STALE_S = 300
WATCHDOG_INTERVAL_S = 30

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
            # pipeline_state_entered_at is re-stamped too: it anchors both the
            # 45-min zombie sweep and the 90-min polling deadline. Without it
            # the recovered audits were killed within a minute of the restart
            # that was meant to save them (2026-09-01: 2 sentiment audits
            # zombie-killed, 2 polling audits swept as polling_timeout with
            # their job results already sitting in the jobs table).
            result = await s.execute(text("""
                UPDATE audits
                SET locked_by = NULL,
                    locked_at = NULL,
                    last_activity_at = now(),
                    pipeline_state_entered_at = now(),
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
            await asyncio.wait_for(_scheduler_tick(), timeout=TICK_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.error(
                f"Scheduler tick hung for >{TICK_TIMEOUT_S}s and was abandoned "
                "(wedged DB connection?) — continuing with the next tick"
            )
        except Exception as e:
            logger.error(f"Scheduler tick error: {e}")
        await asyncio.sleep(15)


def stop_scheduler():
    """Signal the scheduler to stop."""
    global _running
    _running = False
    logger.info("Audit scheduler stopped")


async def scheduler_watchdog():
    """Restart the process if the scheduler loop stops ticking.

    The tick loop is the single owner of every audit; if it dies, nothing
    else in the system notices (the API keeps serving, /health kept
    answering 200 for 11 hours on 2026-09-01). Exiting the process is the
    one recovery that needs no cooperation from the hung coroutine: the
    container's restart policy brings a fresh process up and
    recover_stale_audits() re-activates the stranded audits on the first
    tick.
    """
    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL_S)
        if not _running or _last_tick_at is None:
            continue
        stale = (datetime.now(timezone.utc) - _last_tick_at).total_seconds()
        if stale > WATCHDOG_STALE_S:
            logger.critical(
                f"[watchdog] scheduler has not ticked for {stale:.0f}s "
                f"(limit {WATCHDOG_STALE_S}s, in-flight={sorted(_in_flight)}) — "
                "exiting so the container restarts and recovers the audits"
            )
            # Flush handlers before the hard exit so the line above survives.
            for h in logging.getLogger().handlers:
                try:
                    h.flush()
                except Exception:
                    pass
            os._exit(70)


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
    from app.api.v1.endpoints.audits import run_audit, RunAuditRequest, LLM_NAME_MAP

    async with AsyncSessionLocal() as s:
        # Find due projects, skip those that already have a running audit.
        rows = (await s.execute(text("""
            SELECT p.id, p.name, p.schedule_frequency, p.schedule_time,
                   p.schedule_day_of_week, p.schedule_day_of_month, p.schedule_timezone,
                   p.schedule_llms
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
            # Per-project LLM selection (schedule_llms). Filter to known ids so
            # a stale/garbage value can't silently map to chatgpt downstream;
            # NULL/empty → None → run_audit's default (searchgpt + perplexity).
            schedule_llms = [
                llm for llm in (proj.get("schedule_llms") or []) if llm in LLM_NAME_MAP
            ]
            req = RunAuditRequest(
                projectId=proj_id, isScheduled=True, llms=schedule_llms or None
            )
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

                # State-duration watchdog: zombie audits that heartbeat but
                # never transition. Happens when a handler loops on a broken
                # OpenAI / broken schema — last_activity_at stays fresh so the
                # 60-min-idle sweep above misses them. If an audit has been in
                # the same pipeline_state for > 45 min, fail it loud.
                zombie_result = await s.execute(text("""
                    UPDATE audits
                    SET status = 'failed',
                        pipeline_state = 'failed',
                        current_step = NULL,
                        finished_at = now(),
                        locked_by = NULL,
                        locked_at = NULL,
                        error_message = COALESCE(
                            error_message,
                            'Auto-failed: stuck in ' || pipeline_state || ' for >45min (handler loop)'
                        )
                    WHERE pipeline_state IN ('extracting_competitors','analyzing_sentiment','finalizing')
                      AND pipeline_state_entered_at IS NOT NULL
                      AND pipeline_state_entered_at < now() - interval '45 minutes'
                      -- An audit waiting on an in-flight OpenAI Batch is NOT a
                      -- zombie: the Batch API's completion window is 24h and
                      -- the handler heartbeats on every poll. Scheduled audits
                      -- were auto-failed at 45 min while their batches went on
                      -- to complete successfully (2026-08-25: 4 audits).
                      -- Batch-waiting audits get a 6h ceiling instead.
                      AND (
                        (
                          (competitors_batch_id IS NULL OR competitors_batch_id = 'applied')
                          AND (sentiment_batch_id IS NULL OR sentiment_batch_id = 'applied')
                        )
                        OR pipeline_state_entered_at < now() - interval '6 hours'
                      )
                    RETURNING id, pipeline_state
                """))
                zombies = zombie_result.fetchall()
                await s.commit()
                if killed:
                    logger.warning(
                        f"Scheduler: auto-failed {len(killed)} idle audit(s): "
                        f"{[str(r[0]) for r in killed]}"
                    )
                if zombies:
                    logger.error(
                        f"Scheduler: zombie-killed {len(zombies)} stuck-in-state audit(s): "
                        f"{[(str(r[0]), r[1]) for r in zombies]}"
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
                try:
                    claimed = await audit_pipeline.try_claim(audit_id, WORKER_ID)
                except Exception as e:
                    # A DB timeout here is a routine retry-next-tick case, not
                    # an unretrieved task exception in the log.
                    logger.warning(f"Scheduler: claim failed for {audit_id}: {type(e).__name__}: {e}")
                    return
                if not claimed:
                    return  # Another worker/tick owns it

                try:
                    await asyncio.wait_for(
                        audit_pipeline.process_step(audit, WORKER_ID),
                        timeout=HANDLER_CEILING_S,
                    )
                except asyncio.TimeoutError:
                    logger.error(
                        f"Scheduler: handler for {audit_id} "
                        f"(state={audit.get('pipeline_state')}) exceeded "
                        f"{HANDLER_CEILING_S}s and was cancelled — the next tick retries"
                    )
                except Exception as e:
                    logger.error(f"Scheduler pipeline error for {audit_id}: {e}")
                finally:
                    try:
                        await audit_pipeline.release(audit_id, WORKER_ID)
                    except Exception as e:
                        # release_stale_audit_locks() clears the lock on a
                        # later tick; a failed release must not surface as an
                        # unretrieved task exception.
                        logger.warning(f"Scheduler: release failed for {audit_id}: {e}")
        finally:
            _in_flight.discard(audit_id)

    # Fire-and-forget: don't block the tick on in-flight work. The semaphore
    # caps real concurrency at 5; the _in_flight set prevents duplicate tasks
    # for the same audit across overlapping ticks.
    for a in active_audits:
        asyncio.create_task(_process_one(a))
