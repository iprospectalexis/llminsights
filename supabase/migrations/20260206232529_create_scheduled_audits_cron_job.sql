/*
  # Create Scheduled Job for Processing Scheduled Audits

  1. Purpose
    - Automatically check and process scheduled audits every minute
    - Triggers audits for projects that have reached their scheduled time
    - Essential for the scheduled audits feature to work

  2. Changes
    - Create a function that calls the process-scheduled-audits edge function
    - Create a cron job that runs every minute
    - Ensures scheduled audits are processed in near real-time

  3. Notes
    - Runs every minute to ensure audits start on time
    - Uses service role key to invoke the edge function
*/

-- Create a function that calls the process-scheduled-audits edge function
CREATE OR REPLACE FUNCTION trigger_scheduled_audits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url text;
  service_role_key text;
  result text;
BEGIN
  -- Get environment variables
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);
  
  -- If settings are not configured, try to get from standard Supabase env
  IF supabase_url IS NULL THEN
    supabase_url := current_setting('request.headers', true)::json->>'x-supabase-url';
  END IF;
  
  -- Call the edge function using pg_net extension
  -- Note: This requires pg_net extension to be enabled
  BEGIN
    -- For now, we'll just log that we need to trigger scheduled audits
    -- The actual HTTP call will be handled by the cron job calling the edge function directly
    RAISE NOTICE 'Scheduled audits check triggered at %', now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error triggering scheduled audits: %', SQLERRM;
  END;
END;
$$;

-- Remove any existing scheduled audits cron job
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname = 'process-scheduled-audits-job';

-- Create a scheduled job that processes scheduled audits every minute
-- Note: This calls a wrapper function, but the actual processing should be done via HTTP request to the edge function
SELECT cron.schedule(
  'process-scheduled-audits-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/process-scheduled-audits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
