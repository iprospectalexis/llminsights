/*
  # Fix Scheduled Audits Cron Job with pg_net

  1. Purpose
    - Enable pg_net extension for making HTTP requests from PostgreSQL
    - Create a proper cron job that calls the process-scheduled-audits edge function
    - This is the missing piece that prevents scheduled audits from running

  2. Changes
    - Enable pg_net extension
    - Remove previous cron job attempt
    - Create proper cron job using pg_net.http_post

  3. Notes
    - Runs every minute to check for scheduled audits
    - Uses net.http_post from pg_net extension to call the edge function
*/

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing scheduled audits cron job
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname = 'process-scheduled-audits-job';

-- Create a scheduled job that calls the process-scheduled-audits edge function every minute
-- This uses pg_net to make an HTTP POST request to the edge function
SELECT cron.schedule(
  'process-scheduled-audits-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT COALESCE(current_setting('app.settings.api_url', true), 'https://' || current_setting('request.jwt.claim.iss', true))) || '/functions/v1/process-scheduled-audits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('request.jwt.claim.role', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);

-- Verify the cron job was created
DO $$
DECLARE
  job_count int;
BEGIN
  SELECT COUNT(*) INTO job_count
  FROM cron.job
  WHERE jobname = 'process-scheduled-audits-job';
  
  IF job_count > 0 THEN
    RAISE NOTICE 'Scheduled audits cron job created successfully. It will run every minute.';
  ELSE
    RAISE WARNING 'Failed to create scheduled audits cron job!';
  END IF;
END $$;
