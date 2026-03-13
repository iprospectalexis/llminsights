/*
  # Create Scheduled Job for Audit Metrics Refresh

  1. Purpose
    - Automatically refresh audit metrics every 2 minutes
    - Improves Status page performance by removing on-demand refresh
    - Only refreshes recent and running audits

  2. Changes
    - Enable pg_cron extension if not already enabled
    - Create a function to refresh recent audit metrics
    - Create a scheduled job that runs every 2 minutes

  3. Notes
    - Runs as a background job without blocking user requests
    - Only processes audits from last 7 days or currently running
*/

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function to refresh recent audit metrics
CREATE OR REPLACE FUNCTION scheduled_refresh_audit_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  seven_days_ago timestamptz;
  audit_ids uuid[];
BEGIN
  -- Calculate 7 days ago
  seven_days_ago := now() - interval '7 days';
  
  -- Get recent and running audit IDs
  SELECT array_agg(id)
  INTO audit_ids
  FROM audits
  WHERE status = 'running' 
     OR created_at >= seven_days_ago
  LIMIT 100;
  
  -- Queue them for refresh if any found
  IF audit_ids IS NOT NULL AND array_length(audit_ids, 1) > 0 THEN
    INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
    SELECT unnest(audit_ids), now()
    ON CONFLICT (audit_id) DO UPDATE
    SET queued_at = EXCLUDED.queued_at;
    
    -- Refresh the queued metrics
    PERFORM refresh_queued_audit_metrics();
  END IF;
END;
$$;

-- Remove any existing audit metrics refresh job
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname = 'refresh-audit-metrics-job';

-- Create a scheduled job that refreshes audit metrics every 2 minutes
SELECT cron.schedule(
  'refresh-audit-metrics-job',
  '*/2 * * * *',
  'SELECT scheduled_refresh_audit_metrics();'
);