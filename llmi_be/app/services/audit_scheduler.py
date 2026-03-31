"""
Audit scheduler — single-owner model using audit_pipeline state machine.

Runs every 15s. For each active audit:
  1. Try to claim it (CAS lock)
  2. Process the current pipeline step
  3. Release the lock

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


async def _scheduler_tick():
    """One tick — find active audits and process them."""
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
