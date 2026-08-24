-- Disable legacy pg_cron polling jobs that cause deadlocks.
--
-- Background: The Python pipeline (audit_pipeline.py + audit_scheduler.py)
-- now handles all audit processing: polling OneSearch, competitor extraction,
-- sentiment analysis, and finalization. However, two pg_cron jobs from
-- migration 20260320120000_add_server_side_audit_polling.sql were still
-- active, calling the Edge Function `poll-audit-results` every ~30 seconds.
--
-- Both systems write to `audit_steps` and `audits` for the same audit
-- concurrently, causing PostgreSQL deadlocks (40P01) that cascade into
-- statement timeouts and block even frontend read queries.
--
-- Fix: unschedule both polling cron jobs and neutralize the SQL function.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-running-audits-a') THEN
    PERFORM cron.unschedule('poll-running-audits-a');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-running-audits-b') THEN
    PERFORM cron.unschedule('poll-running-audits-b');
  END IF;
END $$;

-- Replace with no-op so manual calls are harmless.
CREATE OR REPLACE FUNCTION poll_running_audits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE NOTICE 'poll_running_audits() is disabled. Python pipeline handles all polling.';
END;
$$;
