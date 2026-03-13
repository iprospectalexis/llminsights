/*
  # Create Direct Scheduled Audit Processor

  1. Purpose
    - Process scheduled audits directly in PostgreSQL without HTTP calls
    - Simpler and more reliable than making HTTP requests from cron
    - Calls the run-audit edge function using pg_net

  2. Changes
    - Create process_scheduled_audits_direct() function
    - Update cron job to call this function instead
    - Function identifies due audits and triggers them

  3. Notes
    - Runs with SECURITY DEFINER to bypass RLS
    - Uses pg_net to call the run-audit edge function
    - More reliable than HTTP-based approach
*/

-- Drop old cron job
SELECT cron.unschedule(jobid) 
FROM cron.job 
WHERE jobname = 'process-scheduled-audits-job';

-- Helper function to calculate next scheduled run
CREATE OR REPLACE FUNCTION calculate_next_scheduled_run(
  frequency text,
  schedule_time text,
  day_of_week int,
  day_of_month int,
  timezone text
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  next_run timestamptz;
  target_day int;
  current_day int;
  days_to_add int;
  target_date int;
  last_day_of_month int;
BEGIN
  -- Parse time
  next_run := (current_date || ' ' || schedule_time)::timestamp;
  
  CASE frequency
    WHEN 'daily' THEN
      IF next_run <= now() THEN
        next_run := next_run + interval '1 day';
      END IF;
      
    WHEN 'weekly' THEN
      target_day := COALESCE(day_of_week, 1);
      current_day := EXTRACT(DOW FROM next_run)::int;
      days_to_add := target_day - current_day;
      
      IF days_to_add < 0 OR (days_to_add = 0 AND next_run <= now()) THEN
        days_to_add := days_to_add + 7;
      END IF;
      
      next_run := next_run + (days_to_add || ' days')::interval;
      
    WHEN 'monthly' THEN
      target_date := COALESCE(day_of_month, 1);
      next_run := date_trunc('month', next_run) + (target_date - 1 || ' days')::interval + (schedule_time)::time;
      
      IF next_run <= now() THEN
        next_run := date_trunc('month', next_run + interval '1 month') + (target_date - 1 || ' days')::interval + (schedule_time)::time;
      END IF;
      
      -- Handle months with fewer days
      last_day_of_month := EXTRACT(DAY FROM (date_trunc('month', next_run) + interval '1 month' - interval '1 day'))::int;
      IF target_date > last_day_of_month THEN
        next_run := date_trunc('month', next_run) + (last_day_of_month - 1 || ' days')::interval + (schedule_time)::time;
      END IF;
      
    ELSE
      next_run := next_run + interval '1 day';
  END CASE;
  
  RETURN next_run;
END;
$$;

-- Create function to process scheduled audits directly
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
      -- Check if project already has a running audit
      SELECT COUNT(*) INTO running_count
      FROM audits
      WHERE project_id = project_record.id
        AND status IN ('pending', 'processing')
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

-- Create new cron job that calls the direct function
SELECT cron.schedule(
  'process-scheduled-audits-job',
  '* * * * *',
  'SELECT process_scheduled_audits_direct();'
);
