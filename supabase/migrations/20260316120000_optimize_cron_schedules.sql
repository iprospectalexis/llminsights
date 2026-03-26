-- Optimize cron job schedules to reduce CPU and Disk IO pressure
-- Previous: refresh-audit-metrics-job ran every 2 minutes
-- Previous: refresh-audit-metrics-periodic ran every 5 minutes (duplicate)

-- 1. Slow down refresh-audit-metrics-job from every 2 min to every 10 min
SELECT cron.unschedule('refresh-audit-metrics-job');
SELECT cron.schedule(
  'refresh-audit-metrics-job',
  '*/10 * * * *',
  $$SELECT scheduled_refresh_audit_metrics();$$
);

-- 2. Remove duplicate refresh-audit-metrics-periodic entirely
-- It duplicates job #1 (one via SQL function, one via HTTP edge function)
SELECT cron.unschedule('refresh-audit-metrics-periodic');
