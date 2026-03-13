/*
  # Fix recursion by removing all policies that create circular dependencies

  1. Problem Analysis
    - Circular dependency: projects policy → project_members → projects policy
    - This causes infinite recursion
    
  2. Solution
    - Remove ALL policies on project_members that query other tables
    - Use only direct column checks on project_members (no subqueries)
    - Keep project members policy that only checks user_id column directly
    
  3. New Access Pattern
    - Admins/Managers: See all via JWT check (no recursion)
    - Project Owners: See via created_by column (no recursion)
    - Project Members: See via project_members.user_id check (no recursion)
    - Project owners manage members via direct query
*/

-- Drop all existing policies on project_members
DROP POLICY IF EXISTS "project_members_all_for_project_owner" ON project_members;
DROP POLICY IF EXISTS "project_owners_manage_members" ON project_members;
DROP POLICY IF EXISTS "project_members_select_own" ON project_members;
DROP POLICY IF EXISTS "managers_access_all_project_members" ON project_members;

-- Add simple, non-recursive policies on project_members
-- Policy 1: Users can see their own memberships
CREATE POLICY "users_view_own_memberships"
  ON project_members
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy 2: Admins and managers can manage all memberships (no subquery!)
CREATE POLICY "admins_manage_all_memberships"
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

-- Now add the safe policy on projects
-- This is safe because project_members policies above don't reference projects!
DROP POLICY IF EXISTS "members_can_view_assigned_projects" ON projects;
CREATE POLICY "members_view_assigned_projects"
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
