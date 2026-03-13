/*
  # Fix llm_responses triggers to use FOR EACH ROW
  
  1. Changes
    - Drop the existing STATEMENT-level trigger on llm_responses
    - Recreate it as a ROW-level trigger
    - This fixes the "record 'new' has no field 'audit_id'" error
  
  2. Details
    - STATEMENT-level triggers don't have access to NEW/OLD records
    - The queue_audit_metrics_refresh function needs NEW/OLD to get audit_id
    - Must use FOR EACH ROW instead of FOR EACH STATEMENT
*/

-- Drop the existing statement-level trigger
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_statement ON llm_responses;

-- Recreate as a row-level trigger
CREATE TRIGGER llm_responses_queue_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON llm_responses
  FOR EACH ROW
  EXECUTE FUNCTION queue_audit_metrics_refresh();
