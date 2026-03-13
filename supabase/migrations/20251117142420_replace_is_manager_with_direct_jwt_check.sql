/*
  # Replace is_manager() function with direct JWT checks in policies

  1. Changes
    - Remove is_manager() function and all policies that use it
    - Create new policies that check JWT directly (no function calls)
    - Use the same pattern as users table policies
    - This avoids recursion and is more efficient
    
  2. Security
    - Policies check auth.jwt() for role in ('admin', 'manager')
    - Same security level as before but without recursion
    - More efficient as no function call overhead
*/

-- Drop the problematic view and function
DROP VIEW IF EXISTS user_roles_view CASCADE;
DROP FUNCTION IF EXISTS is_manager() CASCADE;

-- Projects policies
DROP POLICY IF EXISTS "managers_access_all_projects" ON projects;
CREATE POLICY "managers_access_all_projects"
  ON projects
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Groups policies
DROP POLICY IF EXISTS "managers_access_all_groups" ON groups;
CREATE POLICY "managers_access_all_groups"
  ON groups
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Audits policies
DROP POLICY IF EXISTS "managers_access_all_audits" ON audits;
CREATE POLICY "managers_access_all_audits"
  ON audits
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- LLM Responses policies
DROP POLICY IF EXISTS "managers_access_all_llm_responses" ON llm_responses;
CREATE POLICY "managers_access_all_llm_responses"
  ON llm_responses
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Citations policies
DROP POLICY IF EXISTS "managers_access_all_citations" ON citations;
CREATE POLICY "managers_access_all_citations"
  ON citations
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Prompts policies
DROP POLICY IF EXISTS "managers_access_all_prompts" ON prompts;
CREATE POLICY "managers_access_all_prompts"
  ON prompts
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Brands policies
DROP POLICY IF EXISTS "managers_access_all_brands" ON brands;
CREATE POLICY "managers_access_all_brands"
  ON brands
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Project Members policies
DROP POLICY IF EXISTS "managers_access_all_project_members" ON project_members;
CREATE POLICY "managers_access_all_project_members"
  ON project_members
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Audit Steps policies
DROP POLICY IF EXISTS "managers_access_all_audit_steps" ON audit_steps;
CREATE POLICY "managers_access_all_audit_steps"
  ON audit_steps
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );

-- Events policies
DROP POLICY IF EXISTS "managers_access_all_events" ON events;
CREATE POLICY "managers_access_all_events"
  ON events
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' IN ('admin', 'manager')) 
    OR 
    ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'manager'))
  );
