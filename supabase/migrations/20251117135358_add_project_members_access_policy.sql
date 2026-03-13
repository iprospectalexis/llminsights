/*
  # Add policy for project members to view projects

  1. Changes
    - Add SELECT policy on projects table to allow users to view projects they are members of
    
  2. Security
    - Users can only view projects where they exist in the project_members table
    - This complements existing policies for project owners and managers
*/

-- Allow users to view projects they are members of
CREATE POLICY "projects_select_members"
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
