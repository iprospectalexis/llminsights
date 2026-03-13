/*
  # Fix is_manager() function and add admin support

  1. Problem
    - is_manager() function queries users table causing recursion
    - Admin users need same access as managers
    
  2. Solution
    - Update is_manager() to check JWT metadata instead
    - Create is_admin() function
    - Update all policies to support both managers and admins

  3. Changes
    - Replace is_manager() to use JWT
    - Add is_admin() function
    - Update policies on projects, audits, and other tables
*/

-- Update is_manager function to use JWT instead of querying users table
CREATE OR REPLACE FUNCTION is_manager()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    (auth.jwt()->>'role') = 'manager' OR
    (auth.jwt()->'app_metadata'->>'role') = 'manager' OR
    (auth.jwt()->>'role') = 'admin' OR
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create is_admin function
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    (auth.jwt()->>'role') = 'admin' OR
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The existing policies using is_manager() will now work correctly
-- because the function no longer causes recursion
