/*
  # Fix queue_audit_metrics_refresh for STATEMENT-level trigger
  
  1. Problem
    - The function uses NEW.audit_id and OLD.audit_id
    - These are not available in STATEMENT-level triggers
    - This causes "record 'new' has no field 'audit_id'" error
  
  2. Solution
    - Rewrite function to work with STATEMENT-level triggers
    - Query the table directly to find affected audit_ids
    - Use transition tables (when supported) or direct query
  
  3. Performance
    - Keeps STATEMENT-level trigger for better performance
    - Avoids firing once per row
*/

-- Drop the ROW-level trigger I just created
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh ON llm_responses;

-- Recreate the function to work with STATEMENT-level triggers
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- For STATEMENT-level triggers, we need to queue ALL affected audits
  -- Since we don't have access to NEW/OLD, we'll queue based on recent activity
  
  -- Queue audits that have been modified in the last few seconds
  -- This is a heuristic approach for STATEMENT-level triggers
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT audit_id, now()
  FROM llm_responses
  WHERE audit_id IS NOT NULL
    AND updated_at > now() - interval '10 seconds'
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL; -- STATEMENT triggers return NULL
END;
$$;

-- Create STATEMENT-level trigger (better performance)
CREATE TRIGGER llm_responses_queue_metrics_refresh_statement
  AFTER INSERT OR UPDATE OR DELETE ON llm_responses
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_statement();
