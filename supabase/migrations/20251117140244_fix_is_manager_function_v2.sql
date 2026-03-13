/*
  # Fix is_manager function to query users table

  1. Changes
    - Update is_manager() function to query the users table instead of JWT metadata
    - Check if current user has 'admin' or 'manager' role in the users table
    
  2. Security
    - Function uses SECURITY DEFINER to query users table
    - Returns boolean indicating if user is admin or manager
*/

-- Replace the function (no need to drop)
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  user_role text;
BEGIN
  -- Get the user's role from the users table
  SELECT role INTO user_role
  FROM users
  WHERE id = auth.uid();
  
  -- Return true if user is admin or manager
  RETURN user_role IN ('admin', 'manager');
END;
$$;
