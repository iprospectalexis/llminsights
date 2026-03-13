/*
  # Fix project deletion timeout issue

  1. Problem
    - When deleting a project with many citations, the materialized view refresh
      is triggered for EACH citation deletion (81 times in this case)
    - Each REFRESH MATERIALIZED VIEW CONCURRENTLY is slow
    - This causes statement timeout during cascade deletion
    
  2. Solution
    - Change the trigger timing from row-level to statement-level
    - This means the refresh happens once per DELETE statement instead of once per row
    - For project deletion with 81 citations: 81 refreshes → 1 refresh
    
  3. Implementation
    - Drop existing row-level trigger
    - Create new statement-level trigger (FOR EACH STATEMENT instead of FOR EACH ROW)
*/

-- Drop the existing row-level trigger
DROP TRIGGER IF EXISTS citations_domain_refresh ON citations;

-- Create a statement-level trigger instead
-- This will fire once per DELETE/INSERT/UPDATE statement, not once per row
CREATE TRIGGER citations_domain_refresh_statement
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_domain_citations();

-- Also optimize the queue_audit_metrics_refresh trigger the same way
DROP TRIGGER IF EXISTS citations_queue_metrics_refresh ON citations;

CREATE TRIGGER citations_queue_metrics_refresh_statement
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

-- Do the same for llm_responses
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh ON llm_responses;

CREATE TRIGGER llm_responses_queue_metrics_refresh_statement
  AFTER INSERT OR UPDATE OR DELETE ON llm_responses
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();
