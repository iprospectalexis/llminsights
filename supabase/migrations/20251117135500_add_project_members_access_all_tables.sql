/*
  # Add comprehensive project member access policies

  1. Changes
    - Add policies for brands table - project members can access brands
    - Add policies for audit_steps table - project members can access audit steps
    - Add policies for citations table - project members can access citations
    - Add policies for llm_responses table - project members can access LLM responses
    
  2. Security
    - Users can only access data for projects they are members of
    - This complements existing policies for project owners and managers
*/

-- Allow project members to access brands for their projects
CREATE POLICY "brands_access_via_project_members"
  ON brands
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = brands.project_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM project_members
      WHERE project_members.project_id = brands.project_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Allow project members to access audit_steps via their projects
CREATE POLICY "audit_steps_access_via_project_members"
  ON audit_steps
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM audits
      JOIN project_members ON project_members.project_id = audits.project_id
      WHERE audits.id = audit_steps.audit_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM audits
      JOIN project_members ON project_members.project_id = audits.project_id
      WHERE audits.id = audit_steps.audit_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Allow project members to access citations via their projects
CREATE POLICY "citations_access_via_project_members"
  ON citations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM audits
      JOIN project_members ON project_members.project_id = audits.project_id
      WHERE audits.id = citations.audit_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM audits
      JOIN project_members ON project_members.project_id = audits.project_id
      WHERE audits.id = citations.audit_id
      AND project_members.user_id = auth.uid()
    )
  );

-- Allow project members to access llm_responses via their projects
CREATE POLICY "llm_responses_access_via_project_members"
  ON llm_responses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM audits
      JOIN project_members ON project_members.project_id = audits.project_id
      WHERE audits.id = llm_responses.audit_id
      AND project_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM audits
      JOIN project_members ON project_members.project_id = audits.project_id
      WHERE audits.id = llm_responses.audit_id
      AND project_members.user_id = auth.uid()
    )
  );
