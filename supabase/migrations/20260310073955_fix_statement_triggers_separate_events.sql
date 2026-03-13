/*
  # Separate STATEMENT triggers for each event type
  
  1. Problem
    - PostgreSQL doesn't support transition tables for multi-event triggers
    - Need separate triggers for INSERT, UPDATE, DELETE
  
  2. Solution
    - Create three separate STATEMENT-level triggers
    - Each uses appropriate transition tables (NEW/OLD)
    - Maintains low CPU overhead
  
  3. Performance
    - STATEMENT-level triggers (low overhead)
    - Accurate tracking of affected audit_ids
*/

-- Drop the previous trigger
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_statement ON llm_responses;

-- Function for INSERT events (uses NEW TABLE only)
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT audit_id, now()
  FROM new_table
  WHERE audit_id IS NOT NULL
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL;
END;
$$;

-- Function for UPDATE events (uses NEW TABLE)
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT audit_id, now()
  FROM new_table
  WHERE audit_id IS NOT NULL
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL;
END;
$$;

-- Function for DELETE events (uses OLD TABLE only)
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
  SELECT DISTINCT audit_id, now()
  FROM old_table
  WHERE audit_id IS NOT NULL
  ON CONFLICT (audit_id) 
  DO UPDATE SET queued_at = now();
  
  RETURN NULL;
END;
$$;

-- Create three separate STATEMENT-level triggers
CREATE TRIGGER llm_responses_queue_metrics_refresh_insert
  AFTER INSERT ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_insert();

CREATE TRIGGER llm_responses_queue_metrics_refresh_update
  AFTER UPDATE ON llm_responses
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_update();

CREATE TRIGGER llm_responses_queue_metrics_refresh_delete
  AFTER DELETE ON llm_responses
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh_delete();
