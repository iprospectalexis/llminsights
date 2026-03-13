/*
  # Fix update_audit_activity trigger to STATEMENT-level
  
  1. Problem
    - llm_responses_activity_update trigger is ROW-level
    - Uses NEW.audit_id which causes error
    - Fires once per row (high CPU overhead)
  
  2. Solution
    - Convert to STATEMENT-level trigger
    - Use transition table (new_table) to get audit_ids
    - Update all affected audits in one query
  
  3. Performance
    - Reduces trigger overhead significantly
    - Single UPDATE instead of one per row
*/

-- Drop the old ROW-level trigger
DROP TRIGGER IF EXISTS llm_responses_activity_update ON llm_responses;

-- Recreate function for STATEMENT-level trigger
CREATE OR REPLACE FUNCTION update_audit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update last_activity_at for all affected audits
  UPDATE audits
  SET last_activity_at = now()
  WHERE id IN (
    SELECT DISTINCT audit_id 
    FROM new_table 
    WHERE audit_id IS NOT NULL
  );
  
  RETURN NULL;
END;
$$;

-- Create STATEMENT-level trigger
CREATE TRIGGER llm_responses_activity_update
  AFTER INSERT ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_audit_activity();
