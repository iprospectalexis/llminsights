/*
  # Fix is_manager function to bypass RLS on users table

  1. Changes
    - Update is_manager() function to properly query users table
    - Use SECURITY DEFINER to bypass RLS when checking user role
    - Ensure function can be called from RLS policies without recursion
    
  2. Security
    - Function only reads user's own role, no security risk
    - SECURITY DEFINER allows bypassing RLS to prevent circular dependency
*/

-- Replace the function to properly bypass RLS
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  );
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated;
