/*
  # Add Project Delete Policy

  1. Changes
    - Add DELETE policy for projects table to allow project owners to delete their projects
  
  2. Security
    - Only project creators and admins can delete projects
    - Cascade delete will handle all related data (brands, prompts, audits, responses, citations)
*/

-- Allow project owners and admins to delete projects
CREATE POLICY "Project owners can delete projects" ON projects
  FOR DELETE TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
