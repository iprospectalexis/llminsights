/*
  # Add competitors step to audit process

  1. Database Changes
    - Update audit_steps table to include 'competitors' step
    - Add check constraint to allow 'competitors' step

  2. Security
    - No changes to RLS policies needed as this uses existing table structure
*/

-- Update the check constraint to include 'competitors' step
ALTER TABLE audit_steps DROP CONSTRAINT IF EXISTS audit_steps_step_check;

ALTER TABLE audit_steps ADD CONSTRAINT audit_steps_step_check 
CHECK ((step = ANY (ARRAY['fetch'::text, 'parse'::text, 'competitors'::text, 'sentiment'::text, 'persist'::text])));