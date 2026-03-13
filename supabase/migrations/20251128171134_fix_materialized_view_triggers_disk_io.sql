/*
  # Fix Materialized View Triggers to Reduce Disk IO

  1. Problem
    - FOR EACH ROW triggers cause materialized view refresh on EVERY row insert/update
    - With 150+ responses per audit, this causes 150+ full view refreshes
    - This is the PRIMARY cause of high Disk IO consumption

  2. Solution
    - Replace FOR EACH ROW triggers with deferred/batch approach
    - Use pg_notify to signal changes without blocking
    - Refresh view periodically or on-demand via edge function
    - Maintain last_refresh timestamp to track staleness

  3. Changes
    - Drop existing row-level triggers
    - Add table to track pending refreshes
    - Create statement-level trigger to mark refresh needed
    - Add function to refresh only when needed
*/

-- Drop existing row-level triggers that cause excessive refreshes
DROP TRIGGER IF EXISTS llm_responses_metrics_refresh ON llm_responses;
DROP TRIGGER IF EXISTS citations_metrics_refresh ON citations;

-- Create table to track which audits need metrics refresh
CREATE TABLE IF NOT EXISTS audit_metrics_refresh_queue (
  audit_id uuid PRIMARY KEY,
  queued_at timestamptz DEFAULT now(),
  last_refresh_at timestamptz
);

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_metrics_refresh_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_metrics_refresh_queue TO service_role;

-- Create lightweight trigger function that just marks audit for refresh
CREATE OR REPLACE FUNCTION queue_audit_metrics_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_id uuid;
BEGIN
  -- Get audit_id from the changed row
  v_audit_id := COALESCE(NEW.audit_id, OLD.audit_id);
  
  IF v_audit_id IS NOT NULL THEN
    -- Insert or update queue entry (upsert)
    INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
    VALUES (v_audit_id, now())
    ON CONFLICT (audit_id) 
    DO UPDATE SET queued_at = now();
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create STATEMENT-level triggers (fire once per statement, not per row)
CREATE TRIGGER llm_responses_queue_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON llm_responses
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

CREATE TRIGGER citations_queue_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

-- Update refresh function to be smarter about when to refresh
CREATE OR REPLACE FUNCTION refresh_audit_metrics(p_audit_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_refresh timestamptz;
  v_should_refresh boolean := false;
BEGIN
  IF p_audit_id IS NULL THEN
    -- Full refresh requested
    REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
    
    -- Update all queued audits
    UPDATE audit_metrics_refresh_queue
    SET last_refresh_at = now();
  ELSE
    -- Check if this audit needs refresh
    SELECT last_refresh_at INTO v_last_refresh
    FROM audit_metrics_refresh_queue
    WHERE audit_id = p_audit_id;
    
    -- Refresh if:
    -- 1. Never refreshed before, OR
    -- 2. Last refresh was more than 30 seconds ago
    v_should_refresh := (
      v_last_refresh IS NULL OR 
      v_last_refresh < now() - interval '30 seconds'
    );
    
    IF v_should_refresh THEN
      -- Refresh the entire view (PostgreSQL limitation)
      REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
      
      -- Update refresh timestamp for this audit
      UPDATE audit_metrics_refresh_queue
      SET last_refresh_at = now()
      WHERE audit_id = p_audit_id;
    END IF;
  END IF;
END;
$$;

-- Create function to refresh all queued audits (called by edge function or cron)
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
    
    -- Mark all as refreshed
    UPDATE audit_metrics_refresh_queue
    SET last_refresh_at = now()
    WHERE audit_id = ANY(v_audits_to_refresh);
    
    -- Return refreshed audits
    RETURN QUERY
    SELECT unnest(v_audits_to_refresh), true;
  END IF;
END;
$$;

-- Clean up old queue entries (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_audit_metrics_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM audit_metrics_refresh_queue
  WHERE last_refresh_at < now() - interval '24 hours';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Initial refresh to populate the view
REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
