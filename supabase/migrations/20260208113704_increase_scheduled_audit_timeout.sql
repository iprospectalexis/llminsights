/*
  # Increase Scheduled Audit Timeout

  1. Changes
    - Increase pg_net timeout from 30 to 60 seconds
    - run-audit can take longer when triggering multiple LLM queries
  
  2. Notes
    - Audits are being created successfully
    - Just need more time for the HTTP response
*/

-- Update the process_scheduled_audits_direct function with longer timeout
CREATE OR REPLACE FUNCTION process_scheduled_audits_direct()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_record RECORD;
  next_run timestamptz;
  supabase_url text;
  service_key text;
  running_count int;
BEGIN
  -- Get Supabase URL from environment or use default
  supabase_url := current_setting('app.settings.api_url', true);
  
  -- If not set, use production URL
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://gpjkhdsonsdbnvmicgqf.supabase.co';
  END IF;
  
  -- Remove trailing slash if present
  supabase_url := rtrim(supabase_url, '/');
  
  -- Get service role key from settings table
  SELECT value INTO service_key FROM system_settings WHERE key = 'service_role_key';
  
  -- If no service key configured, log and exit
  IF service_key IS NULL OR service_key LIKE '%placeholder%' THEN
    RAISE NOTICE 'Service role key not configured in system_settings. Scheduled audits will not run.';
    RETURN;
  END IF;
  
  -- Find all projects with scheduled audits that are due
  FOR project_record IN
    SELECT id, name, schedule_frequency, schedule_time, 
           schedule_day_of_week, schedule_day_of_month, 
           schedule_timezone, next_scheduled_audit_at
    FROM projects
    WHERE scheduled_audits_enabled = true
      AND next_scheduled_audit_at IS NOT NULL
      AND next_scheduled_audit_at <= now()
  LOOP
    BEGIN
      -- Check if project already has a running audit
      SELECT COUNT(*) INTO running_count
      FROM audits
      WHERE project_id = project_record.id
        AND status IN ('pending', 'running')
      LIMIT 1;
      
      IF running_count > 0 THEN
        RAISE NOTICE 'Project % already has a running audit, skipping', project_record.id;
        CONTINUE;
      END IF;
      
      RAISE NOTICE 'Triggering scheduled audit for project % using URL: %', project_record.id, supabase_url || '/functions/v1/run-audit';
      
      -- Call the run-audit edge function via pg_net with 60 second timeout
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/run-audit',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object(
          'projectId', project_record.id,
          'isScheduled', true
        ),
        timeout_milliseconds := 60000
      );
      
      -- Calculate next run time
      next_run := calculate_next_scheduled_run(
        project_record.schedule_frequency,
        project_record.schedule_time,
        project_record.schedule_day_of_week,
        project_record.schedule_day_of_month,
        project_record.schedule_timezone
      );
      
      -- Update project with last run and next run times
      UPDATE projects
      SET last_scheduled_audit_at = now(),
          next_scheduled_audit_at = next_run
      WHERE id = project_record.id;
      
      RAISE NOTICE 'Triggered scheduled audit for project %. Next run: %', project_record.id, next_run;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error processing scheduled audit for project %: %', project_record.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
