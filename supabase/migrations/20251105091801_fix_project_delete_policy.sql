/*
  # Fix Project Delete Policy

  1. Changes
    - Drop the existing delete policy that causes infinite recursion
    - Add a simpler delete policy that only checks project ownership
  
  2. Security
    - Project creators can delete their own projects
    - No admin check to avoid RLS recursion issues
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Project owners can delete projects" ON projects;

-- Create a simpler policy that only checks ownership
CREATE POLICY "Project owners can delete projects" ON projects
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by);
