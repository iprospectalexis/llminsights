/*
  # Fix Insight Reports RLS for Managers

  ## Problem
  Users with role='manager' cannot create or view insight reports because:
  1. INSERT policy only checks for 'admin', not 'manager'
  2. SELECT policies only check for 'admin', not 'manager'
  3. Managers should have the same broad access as admins

  ## Solution
  - Update INSERT policy to allow managers
  - Update SELECT policies to allow managers
  - Managers can access all projects and create reports for any project

  ## Changes
  1. Drop and recreate INSERT policy to include manager role
  2. Add new SELECT policy for managers to view all reports
*/

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Users can create reports for accessible projects" ON insight_reports;

-- Create new INSERT policy that includes managers
CREATE POLICY "Users can create reports for accessible projects"
  ON insight_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if user created the project
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = insight_reports.project_id
      AND projects.created_by = auth.uid()
    )
    OR
    -- Allow if user is a project member
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = insight_reports.project_id
      AND project_members.user_id = auth.uid()
    )
    OR
    -- Allow if user is admin or manager
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'manager')
  );

-- Add SELECT policy for managers (similar to admins)
CREATE POLICY "Managers can view all reports"
  ON insight_reports FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'manager'
  );
