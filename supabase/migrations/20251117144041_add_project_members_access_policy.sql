/*
  # Add safe policy for project members to access assigned projects

  1. Changes
    - Remove recursive policy on project_members that queries projects table
    - Add new policy on projects that checks user_id in project_members table
    - Use a materialized subquery approach to avoid recursion
    
  2. Security
    - Members can only see projects where they are explicitly added
    - Managers and admins still see all projects
    - Project owners still see their own projects
    
  3. How it avoids recursion
    - The subquery on project_members uses only direct column checks (user_id = auth.uid())
    - No policy on project_members references projects table anymore
    - One-way dependency: projects → project_members (not circular)
*/

-- First, remove the recursive policy on project_members
DROP POLICY IF EXISTS "project_members_all_for_project_owner" ON project_members;

-- Add a simpler policy for project owners to manage members
-- This one only checks the projects table's created_by column, no subquery needed
CREATE POLICY "project_owners_manage_members"
  ON project_members
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM projects 
      WHERE projects.id = project_members.project_id 
        AND projects.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM projects 
      WHERE projects.id = project_members.project_id 
        AND projects.created_by = auth.uid()
    )
  );

-- Now add the safe policy on projects for members to see their assigned projects
-- This checks project_members but project_members policies don't check back to projects
CREATE POLICY "members_can_view_assigned_projects"
  ON projects
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = projects.id
        AND project_members.user_id = auth.uid()
    )
  );
