/*
  # Simplify is_manager function to avoid RLS issues

  1. Changes
    - Create a simpler version of is_manager() that bypasses RLS completely
    - Use a direct query with explicit table qualification
    - Set function to run with postgres privileges (SECURITY DEFINER + owner postgres)
    
  2. Security
    - Safe because it only checks current user's own role
    - Cannot be exploited to see other users' data
*/

-- Drop and recreate with explicit RLS bypass
DROP FUNCTION IF EXISTS is_manager() CASCADE;

CREATE FUNCTION is_manager()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role text;
BEGIN
  -- Direct query with explicit schema and bypassing RLS via SECURITY DEFINER
  SELECT role INTO v_role
  FROM public.users
  WHERE id = auth.uid();
  
  RETURN COALESCE(v_role IN ('admin', 'manager'), false);
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- Recreate all policies that depend on is_manager()
DROP POLICY IF EXISTS "managers_access_all_projects" ON projects;
CREATE POLICY "managers_access_all_projects"
  ON projects
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_groups" ON groups;
CREATE POLICY "managers_access_all_groups"
  ON groups
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_audits" ON audits;
CREATE POLICY "managers_access_all_audits"
  ON audits
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_llm_responses" ON llm_responses;
CREATE POLICY "managers_access_all_llm_responses"
  ON llm_responses
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_citations" ON citations;
CREATE POLICY "managers_access_all_citations"
  ON citations
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_prompts" ON prompts;
CREATE POLICY "managers_access_all_prompts"
  ON prompts
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_brands" ON brands;
CREATE POLICY "managers_access_all_brands"
  ON brands
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_project_members" ON project_members;
CREATE POLICY "managers_access_all_project_members"
  ON project_members
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_audit_steps" ON audit_steps;
CREATE POLICY "managers_access_all_audit_steps"
  ON audit_steps
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

DROP POLICY IF EXISTS "managers_access_all_events" ON events;
CREATE POLICY "managers_access_all_events"
  ON events
  FOR ALL
  TO authenticated
  USING (is_manager())
  WITH CHECK (is_manager());

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION is_manager() TO anon;
