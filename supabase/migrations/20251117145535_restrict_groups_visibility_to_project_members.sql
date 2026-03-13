/*
  # Restrict groups visibility to project members only

  1. Changes
    - Remove the open `groups_select_all` policy that allows everyone to see all groups
    - Add new policies for groups access:
      - Creators can see their own groups
      - Project members can see groups for projects they're assigned to
      - Admins/managers already have full access via existing policy
    
  2. Security
    - Client users will only see groups for projects they have access to
    - No circular dependencies or recursion issues
    
  3. How it works
    - Groups are linked to projects via projects.group_id
    - Check if user has access to any project in that group
    - Use project_members table to verify membership
*/

-- Drop the open policy that allows everyone to see all groups
DROP POLICY IF EXISTS "groups_select_all" ON groups;

-- Policy 1: Users can see groups for projects they created
CREATE POLICY "users_view_groups_for_owned_projects"
  ON groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects
      WHERE projects.group_id = groups.id
        AND projects.created_by = auth.uid()
    )
  );

-- Policy 2: Users can see groups for projects they're members of
CREATE POLICY "users_view_groups_for_member_projects"
  ON groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE p.group_id = groups.id
        AND pm.user_id = auth.uid()
    )
  );
