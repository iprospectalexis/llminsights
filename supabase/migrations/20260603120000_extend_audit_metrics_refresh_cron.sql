-- Cost reduction: extend audit_metrics_mv refresh cron from 10 min to 15 min.
--
-- Why: REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv is the
-- biggest single CPU consumer on the database. The view aggregates over
-- llm_responses, citations, prompts, and audits — a full rescan touches
-- the largest tables in the schema. Today this fires every 10 min (144
-- times/day); dashboards do not need second-by-second freshness, and
-- the user has accepted up to 15 min staleness.
--
-- Going from 144/day → 96/day cuts the REFRESH workload by ~33%.
--
-- The per-row enqueue triggers (queue_audit_metrics_refresh*) stay as-is
-- — they are statement-level and only insert into a tiny queue table,
-- so they are not a cost driver. The expensive work is the cron-driven
-- REFRESH itself, which is what this migration throttles.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-audit-metrics-job') THEN
    PERFORM cron.unschedule('refresh-audit-metrics-job');
  END IF;
END $$;

SELECT cron.schedule(
  'refresh-audit-metrics-job',
  '*/15 * * * *',
  $$SELECT scheduled_refresh_audit_metrics();$$
);
