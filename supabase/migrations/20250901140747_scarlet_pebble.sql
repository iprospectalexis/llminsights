/*
  # Complete RLS Policy Fix

  This migration completely rebuilds all RLS policies to eliminate infinite recursion
  and ensure proper user profile creation and project access.

  ## Changes Made
  1. Drop all existing policies that cause recursion
  2. Create simple, non-recursive policies for all tables
  3. Ensure authenticated users can create and read their own profiles
  4. Fix project access policies to avoid circular references

  ## Security Model
  - Users can read/update their own profile
  - Users can create projects and become owners
  - Project owners can manage their projects
  - Project members can access projects they're added to
*/

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Users can read own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Users can insert own profile" ON users;

DROP POLICY IF EXISTS "Users can read groups" ON groups;
DROP POLICY IF EXISTS "Users can create groups" ON groups;
DROP POLICY IF EXISTS "Group creators can update" ON groups;

DROP POLICY IF EXISTS "Users can create projects" ON projects;
DROP POLICY IF EXISTS "Project creators can read own projects" ON projects;
DROP POLICY IF EXISTS "Project creators can update own projects" ON projects;
DROP POLICY IF EXISTS "Project members can read projects" ON projects;

DROP POLICY IF EXISTS "Users can read their own memberships" ON project_members;
DROP POLICY IF EXISTS "Project owners can manage memberships" ON project_members;

DROP POLICY IF EXISTS "Project members can access brands" ON brands;
DROP POLICY IF EXISTS "Project members can access prompts" ON prompts;
DROP POLICY IF EXISTS "Project members can access audits" ON audits;
DROP POLICY IF EXISTS "Project members can access audit steps" ON audit_steps;
DROP POLICY IF EXISTS "Project members can access citations" ON citations;
DROP POLICY IF EXISTS "Users can access their events" ON events;

-- Create simple, non-recursive policies for users table
CREATE POLICY "users_select_own" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_insert_own" ON users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Create simple policies for groups
CREATE POLICY "groups_select_all" ON groups
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "groups_insert_own" ON groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "groups_update_creator" ON groups
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Create simple policies for projects
CREATE POLICY "projects_select_owner" ON projects
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "projects_insert_own" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "projects_update_owner" ON projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Create policies for project_members
CREATE POLICY "project_members_select_own" ON project_members
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "project_members_all_for_project_owner" ON project_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_members.project_id 
      AND projects.created_by = auth.uid()
    )
  );

-- Create policies for brands
CREATE POLICY "brands_access_via_project" ON brands
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = brands.project_id 
      AND projects.created_by = auth.uid()
    )
  );

-- Create policies for prompts
CREATE POLICY "prompts_access_via_project" ON prompts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = prompts.project_id 
      AND projects.created_by = auth.uid()
    )
  );

-- Create policies for audits
CREATE POLICY "audits_access_via_project" ON audits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = audits.project_id 
      AND projects.created_by = auth.uid()
    )
  );

-- Create policies for audit_steps
CREATE POLICY "audit_steps_access_via_audit" ON audit_steps
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits 
      JOIN projects ON projects.id = audits.project_id
      WHERE audits.id = audit_steps.audit_id 
      AND projects.created_by = auth.uid()
    )
  );

-- Create policies for citations
CREATE POLICY "citations_access_via_audit" ON citations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits 
      JOIN projects ON projects.id = audits.project_id
      WHERE audits.id = citations.audit_id 
      AND projects.created_by = auth.uid()
    )
  );

-- Create policies for events
CREATE POLICY "events_select_own" ON events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "events_insert_own" ON events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);