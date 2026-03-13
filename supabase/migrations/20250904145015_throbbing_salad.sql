/*
  # Update user role to manager

  This migration updates the current user's role to 'manager' by finding the most recently created user
  and updating their role. This is a direct approach that doesn't rely on auth context.

  1. Changes
     - Updates the most recent user's role from 'client' to 'manager'
     - Updates the updated_at timestamp
*/

-- Update the most recently created user to have manager role
-- This assumes you are the most recent user in the system
UPDATE users 
SET 
  role = 'manager',
  updated_at = now()
WHERE id = (
  SELECT id 
  FROM users 
  ORDER BY created_at DESC 
  LIMIT 1
);