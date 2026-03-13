/*
  # Add can_run_audits permission to users

  1. Changes
    - Add `can_run_audits` boolean column to users table
    - Default to false for clients, true for managers and admins
    - Add trigger to set default value based on role when creating new users
    - Backfill existing users based on their role

  2. Security
    - Only admins and managers can update this field
    - Users can view their own can_run_audits status
*/

-- Add can_run_audits column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'can_run_audits'
  ) THEN
    ALTER TABLE users ADD COLUMN can_run_audits boolean DEFAULT false;
  END IF;
END $$;

-- Backfill existing users based on their role
UPDATE users
SET can_run_audits = CASE
  WHEN role IN ('admin', 'manager') THEN true
  ELSE false
END
WHERE can_run_audits IS NULL OR can_run_audits = false;

-- Create function to set default can_run_audits based on role
CREATE OR REPLACE FUNCTION set_default_can_run_audits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.can_run_audits IS NULL THEN
    NEW.can_run_audits := (NEW.role IN ('admin', 'manager'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to set default can_run_audits on insert
DROP TRIGGER IF EXISTS set_default_can_run_audits_trigger ON users;
CREATE TRIGGER set_default_can_run_audits_trigger
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_default_can_run_audits();

-- Add RLS policy for admins and managers to update can_run_audits
CREATE POLICY "Admins and managers can update can_run_audits"
  ON users
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'manager')
  )
  WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'manager')
  );