/*
  # Fix Admin RLS Recursion Issue

  1. Problem
    - RLS policies for admins query the users table to check if current user is admin
    - This creates recursion: to read users table, we query users table
    - Results in only seeing own record

  2. Solution
    - Store role in auth.users.raw_app_meta_data
    - Use auth.jwt() to check role without querying users table
    - This breaks the recursion cycle

  3. Changes
    - Update aliaksei.rylko@iprospect.com metadata with admin role
    - Drop recursive policies
    - Create new policies using auth.jwt()
*/

-- First, update the auth.users metadata for admin
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE email = 'aliaksei.rylko@iprospect.com';

-- Drop all existing users policies
DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "managers_and_admins_select_all_users" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "Admins can update all users" ON users;
DROP POLICY IF EXISTS "users_insert_own" ON users;
DROP POLICY IF EXISTS "Admins can delete users" ON users;

-- Create new non-recursive policies using JWT metadata

-- Allow users to see their own record
CREATE POLICY "users_can_select_own" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Allow admins to see all users (using JWT metadata - no recursion!)
CREATE POLICY "admins_can_select_all_users" ON users
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->>'role') = 'admin' OR
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

-- Allow managers to see all users (using JWT metadata - no recursion!)
CREATE POLICY "managers_can_select_all_users" ON users
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->>'role') = 'manager' OR
    (auth.jwt()->'app_metadata'->>'role') = 'manager'
  );

-- Allow users to update their own record
CREATE POLICY "users_can_update_own" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow admins to update any user
CREATE POLICY "admins_can_update_all_users" ON users
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt()->>'role') = 'admin' OR
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt()->>'role') = 'admin' OR
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

-- Allow users to insert their own record
CREATE POLICY "users_can_insert_own" ON users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Allow admins to delete users
CREATE POLICY "admins_can_delete_users" ON users
  FOR DELETE TO authenticated
  USING (
    (auth.jwt()->>'role') = 'admin' OR
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

-- Create a trigger to sync role from users table to auth.users metadata
CREATE OR REPLACE FUNCTION sync_user_role_to_metadata()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_set(
    COALESCE(raw_app_meta_data, '{}'::jsonb),
    '{role}',
    to_jsonb(NEW.role)
  )
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_role_to_metadata ON users;

CREATE TRIGGER sync_role_to_metadata
  AFTER INSERT OR UPDATE OF role ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_role_to_metadata();

-- Sync all existing users' roles to metadata
UPDATE auth.users au
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{role}',
  to_jsonb(u.role)
)
FROM users u
WHERE au.id = u.id;
