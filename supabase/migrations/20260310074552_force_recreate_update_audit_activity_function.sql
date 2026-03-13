/*
  # Force recreate update_audit_activity function
  
  1. Problem
    - Possible cached version of old ROW-level function
    - Error still references NEW.audit_id
  
  2. Solution
    - Drop and recreate function completely
    - Drop and recreate trigger
    - Ensure clean slate
*/

-- Drop trigger first
DROP TRIGGER IF EXISTS llm_responses_activity_update ON llm_responses CASCADE;

-- Drop function
DROP FUNCTION IF EXISTS update_audit_activity() CASCADE;

-- Recreate function for STATEMENT-level trigger
CREATE FUNCTION update_audit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update last_activity_at for all affected audits
  -- Using transition table new_table (STATEMENT-level)
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

-- Verify trigger was created
DO $$
DECLARE
  v_trigger_level text;
BEGIN
  SELECT 
    CASE t.tgtype & 1 WHEN 1 THEN 'ROW' ELSE 'STATEMENT' END
  INTO v_trigger_level
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'llm_responses'
    AND t.tgname = 'llm_responses_activity_update';
  
  IF v_trigger_level != 'STATEMENT' THEN
    RAISE EXCEPTION 'Trigger llm_responses_activity_update is not STATEMENT-level!';
  END IF;
  
  RAISE NOTICE 'Trigger llm_responses_activity_update successfully created as STATEMENT-level';
END $$;
