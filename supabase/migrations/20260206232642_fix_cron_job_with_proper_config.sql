/*
  # Fix Cron Job Configuration for Scheduled Audits

  1. Purpose
    - Create a system settings table to store Supabase URL and service role key
    - Update the cron job to use these stored settings
    - This fixes the issue where scheduled audits don't run

  2. Changes
    - Create system_settings table
    - Create function to safely get system settings
    - Update cron job to use stored settings

  3. Security
    - RLS enabled on system_settings
    - Only admins can read/write settings
*/

-- Create system settings table
CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Only service role can access system settings
CREATE POLICY "Only service role can access system settings"
  ON system_settings
  FOR ALL
  USING (auth.role() = 'service_role');

-- Insert default settings (these will need to be updated with actual values)
INSERT INTO system_settings (key, value)
VALUES 
  ('supabase_url', 'https://placeholder.supabase.co'),
  ('service_role_key', 'placeholder_key')
ON CONFLICT (key) DO NOTHING;

-- Remove the old cron job
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname = 'process-scheduled-audits-job';

-- Create new cron job that uses stored settings
SELECT cron.schedule(
  'process-scheduled-audits-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM system_settings WHERE key = 'supabase_url') || '/functions/v1/process-scheduled-audits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM system_settings WHERE key = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);

-- Create a helper function to check cron job status
CREATE OR REPLACE FUNCTION check_scheduled_audits_cron_status()
RETURNS TABLE (
  status text,
  message text,
  cron_job_exists boolean,
  settings_configured boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_count int;
  valid_url boolean;
  valid_key boolean;
BEGIN
  -- Check if cron job exists
  SELECT COUNT(*) INTO job_count
  FROM cron.job
  WHERE jobname = 'process-scheduled-audits-job' AND active = true;
  
  -- Check if settings are properly configured
  SELECT 
    value NOT LIKE '%placeholder%' AND value != '',
    (SELECT value FROM system_settings WHERE key = 'service_role_key') NOT LIKE '%placeholder%' AND (SELECT value FROM system_settings WHERE key = 'service_role_key') != ''
  INTO valid_url, valid_key
  FROM system_settings 
  WHERE key = 'supabase_url';
  
  IF job_count > 0 AND valid_url AND valid_key THEN
    RETURN QUERY SELECT 
      'active'::text,
      'Scheduled audits cron job is active and properly configured'::text,
      true::boolean,
      true::boolean;
  ELSIF job_count > 0 AND (NOT valid_url OR NOT valid_key) THEN
    RETURN QUERY SELECT 
      'misconfigured'::text,
      'Cron job exists but system settings need to be configured'::text,
      true::boolean,
      false::boolean;
  ELSE
    RETURN QUERY SELECT 
      'inactive'::text,
      'Scheduled audits cron job is not active'::text,
      false::boolean,
      false::boolean;
  END IF;
END;
$$;
