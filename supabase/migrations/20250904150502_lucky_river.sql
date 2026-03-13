/*
  # Manager Full Access Policies

  This migration updates Row Level Security (RLS) policies to give users with 'manager' role 
  full access to all data in the application, while maintaining existing access controls for other roles.

  ## Changes Made

  1. **Projects Table**: Managers can access all projects, not just their own
  2. **Audits Table**: Managers can access all audits across all projects  
  3. **LLM Responses Table**: Managers can access all LLM responses
  4. **Citations Table**: Managers can access all citations
  5. **Prompts Table**: Managers can access all prompts
  6. **Brands Table**: Managers can access all brands
  7. **Groups Table**: Managers can access all groups
  8. **Project Members Table**: Managers can access all project memberships
  9. **Audit Steps Table**: Managers can access all audit steps
  10. **Events Table**: Managers can access all events

  ## Security Notes
  
  - Only users with role 'manager' get full access
  - All other users maintain their existing restricted access
  - Original policies are preserved for non-manager users
*/

-- Helper function to check if current user is a manager
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'manager'
  );
$$;

-- Projects: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_projects" ON projects;
CREATE POLICY "managers_access_all_projects"
  ON projects
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Audits: Add manager access policy  
DROP POLICY IF EXISTS "managers_access_all_audits" ON audits;
CREATE POLICY "managers_access_all_audits"
  ON audits
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- LLM Responses: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_llm_responses" ON llm_responses;
CREATE POLICY "managers_access_all_llm_responses"
  ON llm_responses
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Citations: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_citations" ON citations;
CREATE POLICY "managers_access_all_citations"
  ON citations
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Prompts: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_prompts" ON prompts;
CREATE POLICY "managers_access_all_prompts"
  ON prompts
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Brands: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_brands" ON brands;
CREATE POLICY "managers_access_all_brands"
  ON brands
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Groups: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_groups" ON groups;
CREATE POLICY "managers_access_all_groups"
  ON groups
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Project Members: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_project_members" ON project_members;
CREATE POLICY "managers_access_all_project_members"
  ON project_members
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Audit Steps: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_audit_steps" ON audit_steps;
CREATE POLICY "managers_access_all_audit_steps"
  ON audit_steps
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Events: Add manager access policy
DROP POLICY IF EXISTS "managers_access_all_events" ON events;
CREATE POLICY "managers_access_all_events"
  ON events
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Update your user role to manager (targeting the most recent user)
UPDATE users 
SET role = 'manager', updated_at = now()
WHERE id = (
  SELECT id FROM users 
  ORDER BY created_at DESC 
  LIMIT 1
);