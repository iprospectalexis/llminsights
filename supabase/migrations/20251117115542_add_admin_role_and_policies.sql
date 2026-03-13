/*
  # Add Admin Role and Enhanced Policies

  1. Changes
    - Update user aliaksei.rylko@iprospect.com to admin role
    - Add comprehensive RLS policies for admin users
    - Add policies for admins to update and delete users
    - Remove recursive admin policy that causes issues

  2. Security
    - Admins can read, update, and delete all users
    - Admins can update user passwords via admin API
    - Managers can still read all users but cannot modify them
    - Regular users can only see their own data
*/

-- Update aliaksei.rylko@iprospect.com to admin role
UPDATE users 
SET role = 'admin', updated_at = now()
WHERE email = 'aliaksei.rylko@iprospect.com';

-- Drop existing policies that will be replaced
DROP POLICY IF EXISTS "Admins can read all users" ON users;

-- Create admin-specific policies for full user management

-- Admins can update any user (including role changes)
CREATE POLICY "Admins can update all users" ON users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can delete any user
CREATE POLICY "Admins can delete users" ON users
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create a helper function to check if current user is admin (to avoid recursion)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the managers policy to also allow admins
DROP POLICY IF EXISTS "managers_select_all_users" ON users;

CREATE POLICY "managers_and_admins_select_all_users" ON users
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );
