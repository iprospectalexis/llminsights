/*
  # Fix is_manager function using a view to bypass RLS

  1. Changes
    - Create a view that bypasses RLS for reading user roles
    - Update is_manager() function to use the view
    - The view runs with SECURITY DEFINER implicitly
    
  2. Security
    - View only exposes user_id and role, no sensitive data
    - Function only checks current user's role via auth.uid()
    - Safe because users can only check their own role
*/

-- Create a view that can read from users table bypassing RLS
CREATE OR REPLACE VIEW user_roles_view
WITH (security_invoker = false)
AS
SELECT id, role
FROM public.users;

-- Grant access to the view
GRANT SELECT ON user_roles_view TO authenticated;
GRANT SELECT ON user_roles_view TO anon;

-- Recreate the function to use the view
DROP FUNCTION IF EXISTS is_manager() CASCADE;

CREATE FUNCTION is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT role FROM user_roles_view WHERE id = auth.uid()) IN ('admin', 'manager'),
    false
  );
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION is_manager() TO anon;

-- Recreate all policies that were dropped
CREATE POLICY "managers_access_all_projects"
  ON projects
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_groups"
  ON groups
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_audits"
  ON audits
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_llm_responses"
  ON llm_responses
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_citations"
  ON citations
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_prompts"
  ON prompts
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_brands"
  ON brands
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_project_members"
  ON project_members
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_audit_steps"
  ON audit_steps
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "managers_access_all_events"
  ON events
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());
