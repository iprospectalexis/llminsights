-- Cost reduction: retention policies on append-only log tables.
--
-- Three tables grow indefinitely with audit traffic but only the recent
-- tail is queried:
--
--   1. ``audit_pipeline_log``  — debugging journal. 30 days is plenty.
--   2. ``events``              — analytics/audit log. 60 days.
--   3. ``api_usage_events``    — provider cost ledger. 90 days
--                                 (long enough for monthly reconciliation).
--
-- Each gets a daily cron at 03:00 that deletes rows beyond the window.
-- Daily cadence keeps each delete batch small (< 1 day of inserts) so
-- it never piles up.
--
-- Note for storage: DELETE marks rows dead but does not reclaim disk —
-- autovacuum will TRUNCATE the dead tuples over the following hours.
-- For an immediate one-shot reclaim run ``VACUUM FULL <table>`` off-hours.

-- ── 1. audit_pipeline_log — 30 day retention ────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-audit-pipeline-log') THEN
    PERFORM cron.unschedule('prune-audit-pipeline-log');
  END IF;
END $$;

SELECT cron.schedule(
  'prune-audit-pipeline-log',
  '0 3 * * *',
  $$DELETE FROM public.audit_pipeline_log
    WHERE created_at < now() - interval '30 days';$$
);

-- ── 2. events — 60 day retention ────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-events') THEN
    PERFORM cron.unschedule('prune-events');
  END IF;
END $$;

SELECT cron.schedule(
  'prune-events',
  '5 3 * * *',
  $$DELETE FROM public.events
    WHERE created_at < now() - interval '60 days';$$
);

-- ── 3. api_usage_events — 90 day retention ──────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-api-usage-events') THEN
    PERFORM cron.unschedule('prune-api-usage-events');
  END IF;
END $$;

SELECT cron.schedule(
  'prune-api-usage-events',
  '10 3 * * *',
  $$DELETE FROM public.api_usage_events
    WHERE occurred_at < now() - interval '90 days';$$
);
