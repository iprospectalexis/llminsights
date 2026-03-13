/*
  # Add client users ability to insert groups

  1. Changes
    - Add policy for authenticated users to insert their own groups
    - This allows clients to create new groups when creating projects
    
  2. Security
    - Users can only insert groups where they are the creator (created_by = auth.uid())
    - This is safe because RLS ensures they can only create groups for themselves
*/

-- Add policy for clients to insert groups they create
DROP POLICY IF EXISTS "clients_can_create_groups" ON groups;
CREATE POLICY "clients_can_create_groups"
  ON groups
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());
