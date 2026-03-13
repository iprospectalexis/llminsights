/*
  # Grant admin rights to current user

  1. Updates
    - Update the first user in the system to have admin role
    - This assumes you are the first registered user

  2. Security
    - Only affects the first user account
    - Maintains existing RLS policies
*/

-- Update the first user (oldest by creation date) to have admin role
UPDATE users 
SET role = 'admin', updated_at = now()
WHERE id = (
  SELECT id 
  FROM users 
  ORDER BY created_at ASC 
  LIMIT 1
);