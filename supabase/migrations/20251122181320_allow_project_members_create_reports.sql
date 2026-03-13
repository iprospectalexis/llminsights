/*
  # Allow Project Members to Create Reports

  1. Changes
    - Update INSERT policy to allow project members (not just project creators) to create reports
    - This aligns with the existing SELECT policies that allow project members to view reports

  2. Security
    - Users can create reports for projects they created OR projects they are members of
    - Maintains proper access control
*/

-- Drop the existing restrictive INSERT policy
DROP POLICY IF EXISTS "Users can create reports for own projects" ON insight_reports;

-- Create a new policy that allows project creators AND project members to create reports
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
    -- Allow if user is admin
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
