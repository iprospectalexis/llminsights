/*
  # Fix Scheduled Audits Status Check

  1. Changes
    - Update process_scheduled_audits_direct() function to check for correct status values
    - Replace 'processing' with 'running' to match actual audit statuses
  
  2. Valid Audit Statuses
    - pending
    - running
    - completed
    - failed
  
  3. Notes
    - The function was checking for 'processing' which doesn't exist
    - This caused scheduled audits to potentially run duplicate audits
*/

-- Update the process_scheduled_audits_direct function with correct status check
CREATE OR REPLACE FUNCTION process_scheduled_audits_direct()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_record RECORD;
  group_ids uuid[];
  audit_id uuid;
  next_run timestamptz;
  supabase_url text;
  service_key text;
  running_count int;
BEGIN
  -- Get Supabase URL (use internal URL for better performance)
  supabase_url := COALESCE(
    current_setting('app.settings.api_url', true),
    'http://kong:8000'
  );
  
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
      -- Check if project already has a running audit (FIXED: changed 'processing' to 'running')
      SELECT COUNT(*) INTO running_count
      FROM audits
      WHERE project_id = project_record.id
        AND status IN ('pending', 'running')
      LIMIT 1;
      
      IF running_count > 0 THEN
        RAISE NOTICE 'Project % already has a running audit, skipping', project_record.id;
        CONTINUE;
      END IF;
      
      -- Get all group IDs for this project
      SELECT array_agg(id) INTO group_ids
      FROM groups
      WHERE project_id = project_record.id;
      
      IF group_ids IS NULL OR array_length(group_ids, 1) = 0 THEN
        RAISE NOTICE 'Project % has no groups, skipping', project_record.id;
        
        -- Still update next run time
        next_run := calculate_next_scheduled_run(
          project_record.schedule_frequency,
          project_record.schedule_time,
          project_record.schedule_day_of_week,
          project_record.schedule_day_of_month,
          project_record.schedule_timezone
        );
        
        UPDATE projects 
        SET next_scheduled_audit_at = next_run
        WHERE id = project_record.id;
        
        CONTINUE;
      END IF;
      
      -- Call the run-audit edge function via pg_net
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/run-audit',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object(
          'projectId', project_record.id,
          'groupIds', group_ids,
          'isScheduled', true
        ),
        timeout_milliseconds := 30000
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
      
      RAISE NOTICE 'Triggered scheduled audit for project %', project_record.id;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error processing scheduled audit for project %: %', project_record.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
