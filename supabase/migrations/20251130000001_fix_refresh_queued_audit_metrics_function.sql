/*
  # Fix refresh_queued_audit_metrics Function

  1. Problem
    - Column reference "audit_id" is ambiguous in UPDATE statement
    - PostgreSQL can't tell if it's the table column or the output parameter
  
  2. Solution
    - Qualify the column reference with table name
    - Use q.audit_id instead of just audit_id
*/

CREATE OR REPLACE FUNCTION refresh_queued_audit_metrics()
RETURNS TABLE(audit_id uuid, refreshed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audits_to_refresh uuid[];
  v_count integer;
BEGIN
  -- Get audits that need refresh (queued but not refreshed in last 30 seconds)
  SELECT array_agg(q.audit_id) INTO v_audits_to_refresh
  FROM audit_metrics_refresh_queue q
  WHERE q.last_refresh_at IS NULL 
     OR q.last_refresh_at < now() - interval '30 seconds';
  
  v_count := array_length(v_audits_to_refresh, 1);
  
  IF v_count > 0 THEN
    -- Refresh the view once for all pending audits
    REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
    
    -- Mark all as refreshed (use table alias to avoid ambiguity)
    UPDATE audit_metrics_refresh_queue q
    SET last_refresh_at = now()
    WHERE q.audit_id = ANY(v_audits_to_refresh);
    
    -- Return refreshed audits
    RETURN QUERY
    SELECT unnest(v_audits_to_refresh), true;
  END IF;
END;
$$;
