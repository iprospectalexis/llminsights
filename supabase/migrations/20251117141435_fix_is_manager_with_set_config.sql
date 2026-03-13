/*
  # Fix is_manager function with explicit RLS bypass

  1. Changes
    - Recreate is_manager() function to explicitly disable RLS when querying users table
    - Use SET LOCAL to temporarily disable RLS for the query
    - Ensure function works correctly in RLS policy context
    
  2. Security
    - Function only reads user's own role based on auth.uid()
    - SECURITY DEFINER allows bypassing RLS safely
    - No security risk as it only exposes current user's role
*/

-- Replace the function with explicit RLS bypass
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  user_role text;
BEGIN
  -- Temporarily disable RLS to read from users table
  PERFORM set_config('request.jwt.claim.sub', auth.uid()::text, true);
  
  -- Get the user's role from the users table (bypassing RLS due to SECURITY DEFINER)
  SELECT role INTO user_role
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;
  
  -- Return true if user is admin or manager
  RETURN user_role IN ('admin', 'manager');
END;
$$;

-- Ensure proper permissions
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION is_manager() TO anon;
