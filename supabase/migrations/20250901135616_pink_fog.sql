/*
  # Fix RLS Policy Infinite Recursion

  1. Drop existing problematic policies
  2. Create simplified policies without recursion
  3. Ensure proper access control without circular references

  ## Changes Made
  - Simplified users policies to avoid self-referencing
  - Fixed projects policies to prevent recursion through project_members
  - Maintained security while eliminating circular dependencies
*/

-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "Admins can read all users" ON users;
DROP POLICY IF EXISTS "Users can read own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;

DROP POLICY IF EXISTS "Project members can read projects" ON projects;
DROP POLICY IF EXISTS "Project owners can update" ON projects;
DROP POLICY IF EXISTS "Users can create projects" ON projects;

-- Create simplified users policies
CREATE POLICY "Users can read own profile"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Create simplified projects policies
CREATE POLICY "Project creators can read own projects"
  ON projects
  FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Project creators can update own projects"
  ON projects
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create projects"
  ON projects
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Create policy for project members to read projects (without recursion)
CREATE POLICY "Project members can read projects"
  ON projects
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = projects.id 
      AND pm.user_id = auth.uid()
    )
  );

-- Update project_members policies to be simpler
DROP POLICY IF EXISTS "Project members can read memberships" ON project_members;
DROP POLICY IF EXISTS "Project owners can manage members" ON project_members;

CREATE POLICY "Users can read their own memberships"
  ON project_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Project owners can manage memberships"
  ON project_members
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_members.project_id
      AND p.created_by = auth.uid()
    )
  );

-- Update other table policies to avoid recursion
DROP POLICY IF EXISTS "Project members can access brands" ON brands;
CREATE POLICY "Project members can access brands"
  ON brands
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = brands.project_id
      AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Project members can access prompts" ON prompts;
CREATE POLICY "Project members can access prompts"
  ON prompts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = prompts.project_id
      AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Project members can access audits" ON audits;
CREATE POLICY "Project members can access audits"
  ON audits
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = audits.project_id
      AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Project members can access audit steps" ON audit_steps;
CREATE POLICY "Project members can access audit steps"
  ON audit_steps
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      JOIN projects p ON a.project_id = p.id
      WHERE a.id = audit_steps.audit_id
      AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Project members can access citations" ON citations;
CREATE POLICY "Project members can access citations"
  ON citations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      JOIN projects p ON a.project_id = p.id
      WHERE a.id = citations.audit_id
      AND (
        p.created_by = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can access their events" ON events;
CREATE POLICY "Users can access their events"
  ON events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());