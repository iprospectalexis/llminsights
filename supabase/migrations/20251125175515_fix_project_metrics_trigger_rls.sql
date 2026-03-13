/*
  # Fix Project Metrics Trigger RLS Issue

  ## Problem
  When creating a new project, the trigger `after_project_insert` tries to insert into 
  `project_metrics` table, but there's no INSERT policy for authenticated users.
  
  The trigger function has SECURITY DEFINER, but the INSERT still fails due to RLS.

  ## Solution
  Option 1: Make the trigger function properly bypass RLS by executing as superuser
  Option 2: Add an INSERT policy for authenticated users
  
  We'll use Option 2 as it's cleaner - allow users to insert metrics only for projects they own.

  ## Changes
  1. Add INSERT policy allowing users to create metrics for their own projects
  2. Add UPDATE policy allowing users to update metrics for their own projects
*/

-- Allow users to insert metrics for projects they create
CREATE POLICY "Users can insert metrics for their projects"
  ON project_metrics
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_metrics.project_id
      AND p.created_by = auth.uid()
    )
  );

-- Allow users to update metrics for projects they own
CREATE POLICY "Users can update metrics for their projects"
  ON project_metrics
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_metrics.project_id
      AND (
        p.created_by = auth.uid()
        OR (auth.jwt()->>'role' IN ('admin', 'manager'))
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_metrics.project_id
      AND (
        p.created_by = auth.uid()
        OR (auth.jwt()->>'role' IN ('admin', 'manager'))
      )
    )
  );
