/*
  # Fix group_id to be text field in insight_reports

  1. Changes
    - Drop the foreign key constraint on group_id
    - Change group_id from uuid to text to store prompt_group names directly
    - This aligns with how prompts.prompt_group is a text field, not a reference

  2. Notes
    - The group_id field will now store the prompt_group name (text) instead of a UUID reference
*/

-- Drop the foreign key constraint and change column type
ALTER TABLE insight_reports 
DROP CONSTRAINT IF EXISTS insight_reports_group_id_fkey;

-- Change group_id to text type
ALTER TABLE insight_reports 
ALTER COLUMN group_id TYPE text USING group_id::text;

-- Drop the index on group_id since it's no longer a foreign key
DROP INDEX IF EXISTS idx_insight_reports_group_id;
