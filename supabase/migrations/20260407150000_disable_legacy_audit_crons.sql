-- Disable legacy SQL-side audit cron jobs that bypass the Python pipeline.
--
-- Background: scheduled audits used to be dispatched by a pg_cron job
-- (process_scheduled_audits_direct) which called a legacy Supabase edge
-- function `/functions/v1/run-audit`. That edge function inserted audit
-- rows without setting `pipeline_state`, so the column defaulted to
-- 'created' and was invisible to the new Python state-machine scheduler.
--
-- Two other cron jobs (recover_stuck_audits, force_complete_stuck_audits)
-- then quietly force-marked these stranded audits as `status='completed'`
-- after 5-10 minutes — without ever running competitor extraction or
-- sentiment analysis. The result: charts showing zero brand data on every
-- scheduled audit, with no visible error.
--
-- Fix: disable all three legacy cron jobs. Scheduled audit dispatch is
-- now handled entirely inside the Python `audit_scheduler.py` loop, which
-- creates audits via the same path as manual UI runs (pipeline_state='fetching')
-- so they flow through the full state machine.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-complete-stuck-audits') THEN
    PERFORM cron.unschedule('auto-complete-stuck-audits');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-stuck-audits-job') THEN
    PERFORM cron.unschedule('recover-stuck-audits-job');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-audits-job') THEN
    PERFORM cron.unschedule('process-scheduled-audits-job');
  END IF;
END $$;
