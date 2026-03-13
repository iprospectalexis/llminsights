/*
  # Fix Timezone Conversion Direction

  1. Problem
    - Previous function converted timestamps incorrectly
    - User sets 00:02 Paris time, but system schedules for 01:02 Paris time
    - The AT TIME ZONE conversion was applied in wrong direction

  2. Solution
    - Properly convert from user's local time to UTC
    - Use timestamp without timezone, then specify it's in user's timezone

  3. Example
    - User wants: 00:02 Europe/Paris (CET = UTC+1)
    - Should store: 23:02 UTC
    - Was storing: 00:02 UTC (which is 01:02 Paris time)
*/

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
STABLE
AS $$
DECLARE
  next_run timestamptz;
  tz_name text;
  now_in_tz timestamp;
  candidate_local timestamp;
  target_day int;
  current_day int;
  days_to_add int;
  target_date int;
  days_in_month int;
BEGIN
  -- Use UTC if timezone not specified
  tz_name := COALESCE(timezone, 'UTC');
  
  -- Get current time in the user's timezone (as timestamp without tz)
  now_in_tz := (now() AT TIME ZONE tz_name)::timestamp;
  
  -- Start with today in user's local time + the scheduled time
  candidate_local := date(now_in_tz) + schedule_time::time;
  
  CASE frequency
    WHEN 'daily' THEN
      -- If today's time has passed, move to tomorrow
      IF candidate_local <= now_in_tz THEN
        candidate_local := candidate_local + interval '1 day';
      END IF;
      
    WHEN 'weekly' THEN
      target_day := COALESCE(day_of_week, 1);
      current_day := EXTRACT(DOW FROM candidate_local)::int;
      days_to_add := target_day - current_day;
      
      -- If target day is in the past, or today but time passed
      IF days_to_add < 0 OR (days_to_add = 0 AND candidate_local <= now_in_tz) THEN
        days_to_add := days_to_add + 7;
        IF days_to_add <= 0 THEN
          days_to_add := 7;
        END IF;
      END IF;
      
      candidate_local := candidate_local + make_interval(days => days_to_add);
      
    WHEN 'monthly' THEN
      target_date := COALESCE(day_of_month, 1);
      
      -- Set to target day of current month
      candidate_local := date_trunc('month', candidate_local)::date + make_interval(days => target_date - 1) + schedule_time::time;
      
      -- If that time has passed, move to next month
      IF candidate_local <= now_in_tz THEN
        candidate_local := (date_trunc('month', candidate_local) + interval '1 month')::date + make_interval(days => target_date - 1) + schedule_time::time;
      END IF;
      
      -- Handle months with fewer days
      days_in_month := EXTRACT(DAY FROM (date_trunc('month', candidate_local) + interval '1 month' - interval '1 day'))::int;
      IF target_date > days_in_month THEN
        candidate_local := (date_trunc('month', candidate_local))::date + make_interval(days => days_in_month - 1) + schedule_time::time;
      END IF;
      
    ELSE
      candidate_local := candidate_local + interval '1 day';
  END CASE;
  
  -- Convert from user's local time to UTC
  -- This tells PostgreSQL: "this timestamp is in the user's timezone, convert it to UTC"
  next_run := (candidate_local AT TIME ZONE tz_name);
  
  RETURN next_run;
END;
$$;

-- Recalculate next run times for all scheduled projects
UPDATE projects
SET next_scheduled_audit_at = calculate_next_scheduled_run(
  schedule_frequency,
  schedule_time,
  schedule_day_of_week,
  schedule_day_of_month,
  schedule_timezone
)
WHERE scheduled_audits_enabled = true;
