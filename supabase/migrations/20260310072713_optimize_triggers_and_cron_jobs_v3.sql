/*
  # Optimize Database Performance - Trigger and Cron Improvements
  
  1. Changes
    - Convert ROW-level triggers to STATEMENT-level for metrics queue
      - Citations insert/update/delete triggers → STATEMENT level
      - Audits status update trigger → STATEMENT level
      - Reduces trigger overhead from 50,000 executions to 1 per batch
    
    - Add cron job for audit metrics materialized view refresh (every 5 minutes)
      - Reduces real-time refresh pressure
      - Acceptable 5-10 minute delay for analytics dashboard
    
    - Update scheduled audits cron from 1 minute to 5 minutes
      - Reduces cron job overhead by 80%
      - Acceptable delay for scheduled audit launches
  
  2. Performance Impact
    - Trigger executions: 50,000 → 1 per batch operation (99.998% reduction)
    - Cron frequency: Every 1 min → Every 5 min (80% reduction)
    - Expected disk I/O reduction: 60-80%
  
  3. Trade-offs
    - Metrics refresh: Real-time → 5-10 minute delay (acceptable for analytics)
    - Scheduled audits: Up to 5 minute launch delay (acceptable)
    - Audit trigger will fire on ANY update (not just status changes) - acceptable overhead
*/

-- ============================================================================
-- PART 1: Convert ROW triggers to STATEMENT triggers for metrics queue
-- ============================================================================

-- Drop existing ROW-level triggers
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_citation_update ON citations;
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_citation_delete ON citations;
DROP TRIGGER IF EXISTS queue_metrics_refresh_on_audit_complete ON audits;

-- Create new STATEMENT-level triggers for citations
-- These fire ONCE per INSERT/UPDATE/DELETE statement, not per row
CREATE TRIGGER queue_metrics_refresh_on_citation_insert
  AFTER INSERT ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

CREATE TRIGGER queue_metrics_refresh_on_citation_update
  AFTER UPDATE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

CREATE TRIGGER queue_metrics_refresh_on_citation_delete
  AFTER DELETE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

-- Create STATEMENT-level trigger for audits
-- Note: Fires on ANY update (not just status), but overhead is minimal
-- compared to the performance gain from STATEMENT-level execution
CREATE TRIGGER queue_metrics_refresh_on_audit_complete
  AFTER UPDATE ON audits
  FOR EACH STATEMENT
  EXECUTE FUNCTION queue_audit_metrics_refresh();

-- ============================================================================
-- PART 2: Add cron job for periodic audit metrics refresh (every 5 minutes)
-- ============================================================================

-- Create cron job to refresh audit metrics materialized view every 5 minutes
-- This replaces the immediate refresh with a periodic batch refresh
SELECT cron.schedule(
  'refresh-audit-metrics-periodic',
  '*/5 * * * *', -- Every 5 minutes
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/refresh-audit-metrics',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key')
      ),
      body := jsonb_build_object('source', 'cron')
    );
  $$
);

-- ============================================================================
-- PART 3: Update scheduled audits cron from 1 minute to 5 minutes
-- ============================================================================

-- First, unschedule the existing 1-minute cron job
SELECT cron.unschedule('process-scheduled-audits-job');

-- Create new 5-minute cron job for scheduled audits
-- Using the existing process_scheduled_audits_direct() function
SELECT cron.schedule(
  'process-scheduled-audits-job',
  '*/5 * * * *', -- Changed from '* * * * *' (every 1 min) to '*/5 * * * *' (every 5 min)
  $$SELECT process_scheduled_audits_direct();$$
);

-- ============================================================================
-- Performance Notes
-- ============================================================================

-- Before: 50,000 row inserts = 50,000 trigger executions
-- After: 50,000 row inserts = 1 trigger execution
-- 
-- The audit trigger now fires on ANY update (not just status changes),
-- but this is acceptable because:
-- 1. Audits are updated infrequently compared to citations
-- 2. The queue_audit_metrics_refresh() function is idempotent
-- 3. The massive reduction in citation trigger executions far outweighs this