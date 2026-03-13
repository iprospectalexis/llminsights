/*
  # Allow clients to view all groups for project creation

  1. Changes
    - Add policy for authenticated users to view all groups
    - This allows clients to see available groups when creating projects
    
  2. Security
    - Read-only access to groups table
    - Users can see all groups but can only insert/update their own
*/

-- Add policy for clients to view all groups (needed for project creation dropdown)
DROP POLICY IF EXISTS "authenticated_users_view_all_groups" ON groups;
CREATE POLICY "authenticated_users_view_all_groups"
  ON groups
  FOR SELECT
  TO authenticated
  USING (true);

-- Note: The INSERT policy "clients_can_create_groups" ensures users can only create their own groups
-- The UPDATE policy "groups_update_creator" ensures users can only update groups they created
