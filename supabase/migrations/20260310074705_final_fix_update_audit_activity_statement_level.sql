/*
  # Final fix: Convert update_audit_activity to STATEMENT-level trigger
  
  1. Problem
    - Previous migration (20260310073342) created ROW-level trigger with NEW.audit_id
    - This causes "record 'new' has no field 'audit_id'" error
    - ROW-level triggers fire once per row (high CPU overhead)
  
  2. Solution
    - Drop existing ROW-level trigger completely
    - Create STATEMENT-level trigger using transition tables
    - Function uses new_table instead of NEW
    - Processes all rows in a single operation
  
  3. Performance Benefits
    - Reduces CPU usage significantly
    - Single UPDATE query instead of one per row
    - Eliminates "record has no field" errors
*/

-- Step 1: Drop the existing trigger
DROP TRIGGER IF EXISTS llm_responses_activity_update ON llm_responses CASCADE;

-- Step 2: Drop and recreate the function for STATEMENT-level
DROP FUNCTION IF EXISTS update_audit_activity() CASCADE;

CREATE FUNCTION update_audit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update last_activity_at for all affected audits
  -- Uses transition table 'new_table' for STATEMENT-level trigger
  UPDATE audits
  SET last_activity_at = now()
  WHERE id IN (
    SELECT DISTINCT audit_id 
    FROM new_table 
    WHERE audit_id IS NOT NULL
  );
  
  RETURN NULL; -- Return value is ignored for STATEMENT-level AFTER triggers
END;
$$;

-- Step 3: Create STATEMENT-level trigger
CREATE TRIGGER llm_responses_activity_update
  AFTER INSERT ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_audit_activity();

-- Step 4: Verify the trigger is STATEMENT-level
DO $$
DECLARE
  v_trigger_count integer;
  v_trigger_level text;
BEGIN
  -- Check that trigger exists and is STATEMENT-level
  SELECT 
    COUNT(*),
    CASE t.tgtype & 1 WHEN 1 THEN 'ROW' ELSE 'STATEMENT' END
  INTO v_trigger_count, v_trigger_level
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'llm_responses'
    AND t.tgname = 'llm_responses_activity_update'
    AND NOT t.tgisinternal
  GROUP BY t.tgtype;
  
  IF v_trigger_count = 0 THEN
    RAISE EXCEPTION 'Trigger llm_responses_activity_update was not created!';
  END IF;
  
  IF v_trigger_level != 'STATEMENT' THEN
    RAISE EXCEPTION 'Trigger is %, expected STATEMENT', v_trigger_level;
  END IF;
  
  RAISE NOTICE 'SUCCESS: Trigger llm_responses_activity_update is STATEMENT-level';
END $$;
