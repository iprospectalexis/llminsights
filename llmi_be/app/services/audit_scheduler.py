"""
Background audit scheduler — replaces pg_cron poll_running_audits jobs.

Runs every 10s, polls at most 5 running audits concurrently.
Starts automatically on app startup via lifespan.
"""

import asyncio
import logging

from app.services.supabase_db import db

logger = logging.getLogger(__name__)

# Max concurrent audit polls
_poll_semaphore = asyncio.Semaphore(5)
_running = False


async def start_scheduler():
    """Start the background polling loop."""
    global _running
    _running = True
    logger.info("Audit scheduler started (10s interval, max 5 concurrent)")

    while _running:
        try:
            await _poll_tick()
        except Exception as e:
            logger.error(f"Scheduler tick error: {e}")
        await asyncio.sleep(10)


def stop_scheduler():
    """Signal the scheduler to stop."""
    global _running
    _running = False
    logger.info("Audit scheduler stopped")


async def _poll_tick():
    """One scheduler tick — find running audits and poll them."""
    running_audits = await db.get_running_audits()
    if not running_audits:
        return

    logger.info(f"Scheduler: {len(running_audits)} running audit(s)")

    async def _poll_one(audit_id: str):
        async with _poll_semaphore:
            try:
                # Import here to avoid circular imports
                from app.api.v1.endpoints.audits import _poll_for_results
                await _poll_for_results(audit_id)
            except Exception as e:
                logger.error(f"Scheduler poll error for {audit_id}: {e}")

    tasks = [_poll_one(str(a["id"])) for a in running_audits]
    await asyncio.gather(*tasks, return_exceptions=True)
