-- Zombie-audit detection: convert silent hangs into loud failures.
--
-- Root cause: the auto-fail sweep in audit_scheduler only triggers on
-- progress < 90 with stale last_activity_at. But handlers heartbeat on
-- every batch iteration (including failing ones), so last_activity_at is
-- always fresh. And progress=90 is the sentiment stage. Result: audits
-- stuck in a handler that fails every batch keep looping forever and
-- never surface as "failed" to the operator.
--
-- Two new columns let us detect this:
--   1. consecutive_batch_failures — incremented on each batch exception,
--      reset on success. Handler transitions audit to failed at 3.
--   2. pipeline_state_entered_at — timestamp when current state was
--      entered. Scheduler auto-fails audits stuck in the same state
--      for > 45 min, regardless of heartbeat.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS consecutive_batch_failures int NOT NULL DEFAULT 0;

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS pipeline_state_entered_at timestamptz;

-- Backfill pipeline_state_entered_at for in-flight audits so the watchdog
-- doesn't immediately fail them on first tick after deploy.
UPDATE audits
   SET pipeline_state_entered_at = COALESCE(last_activity_at, started_at, created_at)
 WHERE pipeline_state_entered_at IS NULL
   AND pipeline_state IS NOT NULL;
