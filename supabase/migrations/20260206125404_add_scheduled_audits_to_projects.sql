/*
  # Add Scheduled Audits Configuration to Projects

  1. Changes
    - Add `scheduled_audits_enabled` (boolean) - Toggle to enable/disable scheduled audits
    - Add `schedule_frequency` (text) - Frequency: 'daily', 'weekly', 'monthly'
    - Add `schedule_time` (text) - Time of day to run (HH:MM format)
    - Add `schedule_day_of_week` (integer) - For weekly schedules (0=Sunday, 6=Saturday)
    - Add `schedule_day_of_month` (integer) - For monthly schedules (1-31)
    - Add `schedule_timezone` (text) - User's timezone for scheduling
    - Add `last_scheduled_audit_at` (timestamptz) - Track last automated run
    - Add `next_scheduled_audit_at` (timestamptz) - Pre-calculated next run time

  2. Notes
    - All fields are nullable to maintain backward compatibility
    - Default scheduled_audits_enabled to false
    - Timezone defaults to 'UTC' if not specified
*/

-- Add scheduled audit configuration columns to projects table
DO $$
BEGIN
  -- Enable/disable scheduled audits
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'scheduled_audits_enabled'
  ) THEN
    ALTER TABLE projects ADD COLUMN scheduled_audits_enabled boolean DEFAULT false;
  END IF;

  -- Schedule frequency: daily, weekly, monthly
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'schedule_frequency'
  ) THEN
    ALTER TABLE projects ADD COLUMN schedule_frequency text;
  END IF;

  -- Time of day to run (HH:MM format)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'schedule_time'
  ) THEN
    ALTER TABLE projects ADD COLUMN schedule_time text;
  END IF;

  -- Day of week for weekly schedules (0=Sunday, 6=Saturday)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'schedule_day_of_week'
  ) THEN
    ALTER TABLE projects ADD COLUMN schedule_day_of_week integer;
  END IF;

  -- Day of month for monthly schedules (1-31)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'schedule_day_of_month'
  ) THEN
    ALTER TABLE projects ADD COLUMN schedule_day_of_month integer;
  END IF;

  -- Timezone for scheduling
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'schedule_timezone'
  ) THEN
    ALTER TABLE projects ADD COLUMN schedule_timezone text DEFAULT 'UTC';
  END IF;

  -- Track last scheduled audit
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'last_scheduled_audit_at'
  ) THEN
    ALTER TABLE projects ADD COLUMN last_scheduled_audit_at timestamptz;
  END IF;

  -- Pre-calculated next scheduled audit time
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'next_scheduled_audit_at'
  ) THEN
    ALTER TABLE projects ADD COLUMN next_scheduled_audit_at timestamptz;
  END IF;
END $$;

-- Add check constraints for valid values
DO $$
BEGIN
  -- Check that schedule_frequency is valid
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'projects_schedule_frequency_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_schedule_frequency_check 
      CHECK (schedule_frequency IS NULL OR schedule_frequency IN ('daily', 'weekly', 'monthly'));
  END IF;

  -- Check that day_of_week is valid (0-6)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'projects_schedule_day_of_week_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_schedule_day_of_week_check 
      CHECK (schedule_day_of_week IS NULL OR (schedule_day_of_week >= 0 AND schedule_day_of_week <= 6));
  END IF;

  -- Check that day_of_month is valid (1-31)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'projects_schedule_day_of_month_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_schedule_day_of_month_check 
      CHECK (schedule_day_of_month IS NULL OR (schedule_day_of_month >= 1 AND schedule_day_of_month <= 31));
  END IF;
END $$;

-- Create index for efficient querying of scheduled audits
CREATE INDEX IF NOT EXISTS idx_projects_scheduled_audits 
  ON projects(next_scheduled_audit_at) 
  WHERE scheduled_audits_enabled = true;