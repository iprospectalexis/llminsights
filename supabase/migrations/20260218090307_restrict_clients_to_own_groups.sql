/*
  # Restrict clients to see only their own groups

  1. Changes
    - Remove the overly permissive policy that allowed all users to see all groups
    - Add policy for clients to see only groups they created
    - Keep existing policies for project-based group visibility
    
  2. Security
    - Clients can only see groups they created (created_by = auth.uid())
    - Clients can see groups for projects they own or are members of (existing policies)
    - Managers/admins can see all groups (existing policy)
*/

-- Remove the overly permissive policy
DROP POLICY IF EXISTS "authenticated_users_view_all_groups" ON groups;

-- Add policy for users to view groups they created
DROP POLICY IF EXISTS "users_view_own_created_groups" ON groups;
CREATE POLICY "users_view_own_created_groups"
  ON groups
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());
