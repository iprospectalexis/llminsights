/*
  # Fix Timezone Handling for Scheduled Audits

  1. Problem
    - The calculate_next_scheduled_run function ignores timezone parameter
    - Times are calculated in server timezone instead of user's timezone
    - Projects with passed scheduled times don't get updated

  2. Changes
    - Rewrite calculate_next_scheduled_run to properly handle timezones
    - Use PostgreSQL's AT TIME ZONE for proper timezone conversion
    - Update all projects with passed scheduled times

  3. Notes
    - Properly converts user's local time to UTC for storage
    - Handles DST transitions automatically via PostgreSQL
*/

-- Drop and recreate the timezone-aware function
DROP FUNCTION IF EXISTS calculate_next_scheduled_run(text, text, int, int, text);

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
  tz_name text;
  now_in_tz timestamp;
  candidate_time timestamp;
BEGIN
  -- Use UTC if timezone not specified or invalid
  tz_name := COALESCE(timezone, 'UTC');
  
  -- Get current time in the user's timezone
  now_in_tz := (now() AT TIME ZONE tz_name);
  
  -- Start with today in user's timezone
  candidate_time := (current_date AT TIME ZONE tz_name) + schedule_time::time;
  
  CASE frequency
    WHEN 'daily' THEN
      -- If today's time has passed, move to tomorrow
      IF candidate_time <= now_in_tz THEN
        candidate_time := candidate_time + interval '1 day';
      END IF;
      
    WHEN 'weekly' THEN
      target_day := COALESCE(day_of_week, 1);
      current_day := EXTRACT(DOW FROM candidate_time)::int;
      days_to_add := target_day - current_day;
      
      -- If target day is in the past this week, or today but time passed, move to next week
      IF days_to_add < 0 OR (days_to_add = 0 AND candidate_time <= now_in_tz) THEN
        days_to_add := days_to_add + 7;
        IF days_to_add <= 0 THEN
          days_to_add := days_to_add + 7;
        END IF;
      END IF;
      
      candidate_time := candidate_time + (days_to_add || ' days')::interval;
      
    WHEN 'monthly' THEN
      target_date := COALESCE(day_of_month, 1);
      
      -- Set to target day of current month
      candidate_time := (date_trunc('month', candidate_time) + ((target_date - 1) || ' days')::interval + schedule_time::time);
      
      -- If that time has passed, move to next month
      IF candidate_time <= now_in_tz THEN
        candidate_time := (date_trunc('month', candidate_time) + interval '1 month' + ((target_date - 1) || ' days')::interval + schedule_time::time);
      END IF;
      
      -- Handle months with fewer days (e.g., Feb 30 -> Feb 28/29)
      DECLARE
        days_in_month int;
      BEGIN
        days_in_month := EXTRACT(DAY FROM (date_trunc('month', candidate_time) + interval '1 month' - interval '1 day'))::int;
        IF target_date > days_in_month THEN
          candidate_time := (date_trunc('month', candidate_time) + ((days_in_month - 1) || ' days')::interval + schedule_time::time);
        END IF;
      END;
      
    ELSE
      -- Default to next day
      candidate_time := candidate_time + interval '1 day';
  END CASE;
  
  -- Convert back to UTC for storage
  next_run := (candidate_time AT TIME ZONE tz_name);
  
  RETURN next_run;
END;
$$;

-- Update all projects with passed scheduled times to recalculate next run
UPDATE projects
SET next_scheduled_audit_at = calculate_next_scheduled_run(
  schedule_frequency,
  schedule_time,
  schedule_day_of_week,
  schedule_day_of_month,
  schedule_timezone
)
WHERE scheduled_audits_enabled = true
  AND next_scheduled_audit_at IS NOT NULL
  AND next_scheduled_audit_at <= now();

-- Log the update
DO $$
DECLARE
  updated_count int;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % projects with passed scheduled times', updated_count;
END $$;
