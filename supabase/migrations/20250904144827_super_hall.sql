/*
  # Update current user role to manager

  1. Changes
    - Updates the current authenticated user's role from 'client' to 'manager'
    - Updates the updated_at timestamp
    - Uses auth.uid() to safely target only the current user

  2. Security
    - Only affects the currently authenticated user
    - No impact on other users in the system
*/

-- Update the current user's role to manager
UPDATE users 
SET 
  role = 'manager',
  updated_at = now()
WHERE id = auth.uid();