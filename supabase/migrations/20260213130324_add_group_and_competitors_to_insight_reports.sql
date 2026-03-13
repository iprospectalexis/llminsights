/*
  # Add Group and Competitors to Insight Reports

  1. Changes
    - Add `group_id` column to `insight_reports` table to filter prompts by group
    - Add `custom_competitors` column to allow users to input specific competitor brand names
    - Update RLS policies to allow reading groups for project members

  2. New Columns
    - `group_id` (uuid, nullable): Reference to the groups table for filtering prompts
    - `custom_competitors` (text array, nullable): Custom competitor brand names input by user

  3. Security
    - No changes to existing RLS policies needed
    - Group filtering will be handled at the application level
*/

-- Add group_id and custom_competitors columns to insight_reports
ALTER TABLE insight_reports 
ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS custom_competitors text[] DEFAULT NULL;

-- Add index for better performance when filtering by group
CREATE INDEX IF NOT EXISTS idx_insight_reports_group_id ON insight_reports(group_id);
