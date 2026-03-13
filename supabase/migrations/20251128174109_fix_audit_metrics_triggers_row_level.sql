/*
  # Fix Audit Metrics Triggers to Use Row Level

  1. Problem
    - STATEMENT-level triggers cannot access NEW/OLD records
    - This causes audit_id to always be NULL in queue function
    - Metrics are never refreshed for specific audits

  2. Solution
    - Change back to ROW-level triggers but with throttling
    - Use AFTER trigger with deferred constraint-like behavior
    - Queue entries prevent excessive refreshes via upsert

  3. Changes
    - Drop existing statement-level triggers
    - Create row-level triggers with proper audit_id access
*/

-- Drop existing statement-level triggers
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh ON llm_responses;
DROP TRIGGER IF EXISTS citations_queue_metrics_refresh ON citations;

-- Create ROW-level triggers instead (with throttling via queue table)
CREATE TRIGGER llm_responses_queue_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON llm_responses
  FOR EACH ROW
  EXECUTE FUNCTION queue_audit_metrics_refresh();

CREATE TRIGGER citations_queue_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH ROW
  EXECUTE FUNCTION queue_audit_metrics_refresh();
