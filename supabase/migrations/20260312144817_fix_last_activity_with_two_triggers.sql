/*
  # Fix last_activity_at with Separate Triggers for INSERT and UPDATE
  
  ## Problem
  PostgreSQL doesn't support transition tables with multiple events (INSERT OR UPDATE).
  The existing trigger only fires on INSERT, not UPDATE.
  When webhook updates llm_responses, last_activity_at doesn't update.
  
  ## Solution
  Create two STATEMENT-level triggers:
  1. One for INSERT events
  2. One for UPDATE events
  Both update last_activity_at for affected audits
*/

-- Drop existing trigger
DROP TRIGGER IF EXISTS llm_responses_activity_update ON llm_responses CASCADE;
DROP TRIGGER IF EXISTS llm_responses_activity_insert ON llm_responses CASCADE;

-- Drop and recreate functions
DROP FUNCTION IF EXISTS update_audit_activity() CASCADE;
DROP FUNCTION IF EXISTS update_audit_activity_on_insert() CASCADE;
DROP FUNCTION IF EXISTS update_audit_activity_on_update() CASCADE;

-- Function for INSERT events
CREATE FUNCTION update_audit_activity_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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

-- Function for UPDATE events
CREATE FUNCTION update_audit_activity_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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

-- Create STATEMENT-level trigger for INSERT
CREATE TRIGGER llm_responses_activity_insert
  AFTER INSERT ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_audit_activity_on_insert();

-- Create STATEMENT-level trigger for UPDATE
CREATE TRIGGER llm_responses_activity_update
  AFTER UPDATE ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_audit_activity_on_update();

-- Update last_activity_at for currently running audits that have recent activity
UPDATE audits a
SET last_activity_at = NOW()
WHERE a.status = 'running'
  AND EXISTS (
    SELECT 1
    FROM llm_responses lr
    WHERE lr.audit_id = a.id
      AND lr.created_at > NOW() - INTERVAL '2 hours'
  );
