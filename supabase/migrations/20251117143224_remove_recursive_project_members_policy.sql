/*
  # Remove recursive project members policy to fix infinite recursion

  1. Changes
    - Remove projects_select_members policy that causes recursion
    - Keep only direct policies without subqueries
    - Managers/admins can see all projects via managers_access_all_projects
    - Project owners can see their own projects via projects_select_owner
    
  2. Note
    - Project members will NOT see projects they're assigned to (only owners and managers)
    - This is a temporary fix to resolve recursion
    - In the future, we can add a non-recursive way for members to see projects
*/

-- Remove the problematic policy
DROP POLICY IF EXISTS "projects_select_members" ON projects;
