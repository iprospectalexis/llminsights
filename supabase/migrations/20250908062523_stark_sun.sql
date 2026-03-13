/*
  # Fix users table RLS policies

  1. Security Changes
    - Add policy for managers to select all users
    - Keep existing policy for users to select their own data
    - Ensure managers can see all team members

  2. Policies
    - `users_select_own` - Users can read their own data
    - `managers_select_all_users` - Managers can read all user data
*/

-- Drop existing select policy
DROP POLICY IF EXISTS "users_select_own" ON users;

-- Create new policies
CREATE POLICY "users_select_own"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "managers_select_all_users"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('manager', 'admin')
    )
  );