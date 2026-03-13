/*
  # Add policies for project members to access prompts and audits

  1. Changes
    - Add ALL policy on prompts table to allow project members full access to prompts
    - Add ALL policy on audits table to allow project members full access to audits
    
  2. Security
    - Users can only access prompts/audits for projects they are members of
    - This complements existing policies for project owners and managers
*/

-- Allow project members to access prompts for their projects
CREATE POLICY "prompts_access_via_project_members"
  ON prompts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = prompts.project_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = prompts.project_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Allow project members to access audits for their projects
CREATE POLICY "audits_access_via_project_members"
  ON audits
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = audits.project_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = audits.project_id
      AND project_members.user_id = auth.uid()
    )
  );
