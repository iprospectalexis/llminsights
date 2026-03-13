/*
  # Assign manager role to current user

  1. Updates
    - Update current authenticated user's role to 'manager'
  
  2. Security
    - Uses auth.uid() to target only the current user
    - Ensures only the authenticated user can update their own role through this migration
*/

-- Update the current user's role to manager
UPDATE users 
SET 
  role = 'manager',
  updated_at = now()
WHERE id = auth.uid();