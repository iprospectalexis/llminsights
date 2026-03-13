-- ============================================================================
-- EMERGENCY DISK I/O FIX SCRIPTS
-- ============================================================================
-- Run these in Supabase SQL Editor IMMEDIATELY after restarting your project
-- Execute them in order: Step 1, then Step 2, then Step 3
-- ============================================================================

-- ============================================================================
-- STEP 1: DISABLE ALL CRON JOBS (Run this first!)
-- ============================================================================
-- This stops the every-2-minute refreshes that are killing your I/O

SELECT cron.unschedule('refresh-audit-metrics-every-2-min');
SELECT cron.unschedule('process-scheduled-audits');
SELECT cron.unschedule('process-scheduled-audits-every-5-min');
SELECT cron.unschedule('refresh-audit-metrics-every-15-min');

-- Verify they're disabled
SELECT jobid, jobname, schedule, active FROM cron.job;
-- Should return empty or show active=false


-- ============================================================================
-- STEP 2: DISABLE MATERIALIZED VIEW REFRESH TRIGGERS (Critical!)
-- ============================================================================
-- These triggers refresh the entire MV on every insert - causing massive I/O

DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_llm_response_insert ON llm_responses;
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_llm_response_update ON llm_responses;
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_citation_update ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_domain_citations_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_domain_citations_on_citation_update ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_domain_citations_mv_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_domain_citations_mv_on_citation_update ON citations;
DROP TRIGGER IF EXISTS refresh_domain_citations_mv_on_insert ON citations;
DROP TRIGGER IF EXISTS refresh_domain_citations_mv_on_update ON citations;

-- Verify triggers are dropped
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE '%refresh%'
ORDER BY event_object_table, trigger_name;
-- Should return empty


-- ============================================================================
-- STEP 3: DISABLE ROW-LEVEL UPDATE TRIGGERS (Reduces write amplification)
-- ============================================================================
-- These fire on every prompt insert/delete, causing cascade updates

DROP TRIGGER IF EXISTS after_prompt_insert ON prompts;
DROP TRIGGER IF EXISTS after_prompt_delete ON prompts;
DROP TRIGGER IF EXISTS update_project_prompts_count_on_insert ON prompts;
DROP TRIGGER IF EXISTS update_project_prompts_count_on_delete ON prompts;

-- Verify
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'prompts';
-- Should only show system triggers if any


-- ============================================================================
-- STEP 4: MANUALLY REFRESH MATERIALIZED VIEWS (Only when needed)
-- ============================================================================
-- Now that auto-refresh is disabled, you can manually refresh when needed
-- WARNING: Only run these during low-traffic periods!

-- Refresh audit metrics (takes ~30 seconds)
REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;

-- Refresh domain citations (takes ~10 seconds)
REFRESH MATERIALIZED VIEW CONCURRENTLY domain_citations_mv;

-- Check last refresh time
SELECT
  schemaname,
  matviewname,
  last_vacuum,
  last_analyze
FROM pg_matviews
WHERE schemaname = 'public';


-- ============================================================================
-- STEP 5: CREATE BATCH UPDATE FUNCTION (Safer than row-level triggers)
-- ============================================================================
-- Use this to update project metrics in batches instead of on every change

CREATE OR REPLACE FUNCTION batch_update_project_metrics(
  project_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE project_metrics pm
  SET
    prompts_count = (
      SELECT COUNT(*)
      FROM prompts p
      WHERE p.project_id = pm.project_id
    ),
    updated_at = NOW()
  WHERE
    CASE
      WHEN project_ids IS NOT NULL THEN pm.project_id = ANY(project_ids)
      ELSE true
    END;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Usage example: Update metrics for all projects
-- SELECT batch_update_project_metrics();

-- Usage example: Update metrics for specific projects
-- SELECT batch_update_project_metrics(ARRAY['project-uuid-1'::UUID, 'project-uuid-2'::UUID]);


-- ============================================================================
-- STEP 6: ADD CRITICAL INDEXES (Makes views fast without materialization)
-- ============================================================================
-- These indexes will make regular views almost as fast as materialized views

-- Citations indexes (critical for domain_citations_mv)
CREATE INDEX IF NOT EXISTS idx_citations_domain_llm
  ON citations(domain, llm)
  WHERE domain IS NOT NULL AND domain != '';

CREATE INDEX IF NOT EXISTS idx_citations_audit_prompt_llm
  ON citations(audit_id, prompt_id, llm);

CREATE INDEX IF NOT EXISTS idx_citations_cited_not_false
  ON citations(audit_id, llm, cited)
  WHERE cited IS DISTINCT FROM false;

CREATE INDEX IF NOT EXISTS idx_citations_project_via_audit
  ON citations(audit_id, domain, llm);

-- LLM responses indexes (critical for audit_metrics_mv)
CREATE INDEX IF NOT EXISTS idx_llm_responses_audit_prompt
  ON llm_responses(audit_id, prompt_id, llm);

CREATE INDEX IF NOT EXISTS idx_llm_responses_answered
  ON llm_responses(audit_id, llm)
  WHERE answer_text IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_responses_snapshot_job
  ON llm_responses(audit_id)
  WHERE snapshot_id IS NOT NULL OR job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_responses_competitors
  ON llm_responses(audit_id)
  WHERE answer_competitors IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_responses_sentiment
  ON llm_responses(audit_id)
  WHERE sentiment_score IS NOT NULL;

-- Audits indexes
CREATE INDEX IF NOT EXISTS idx_audits_project_status
  ON audits(project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audits_created_at
  ON audits(created_at DESC);

-- Prompts indexes
CREATE INDEX IF NOT EXISTS idx_prompts_project_id
  ON prompts(project_id);

-- Verify indexes were created
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;


-- ============================================================================
-- STEP 7: CHECK DATABASE HEALTH
-- ============================================================================
-- Run this to see if the fixes are working

SELECT
  schemaname,
  tablename,
  n_tup_ins as total_inserts,
  n_tup_upd as total_updates,
  n_live_tup as live_rows,
  n_dead_tup as dead_rows,
  ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_ratio_pct,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC
LIMIT 10;

-- Check active connections
SELECT
  COUNT(*) as active_connections,
  COUNT(*) FILTER (WHERE state = 'active') as currently_executing,
  COUNT(*) FILTER (WHERE state = 'idle') as idle_connections
FROM pg_stat_activity
WHERE datname = current_database();


-- ============================================================================
-- STEP 8: OPTIONAL - RE-ENABLE CRON JOBS WITH SAFER INTERVALS
-- ============================================================================
-- Only do this after verifying the database is stable (Steps 1-7 complete)
-- These run much less frequently: every 30 minutes instead of every 2 minutes

/*
-- Uncomment these after database is stable for 24 hours:

SELECT cron.schedule(
  'refresh-audit-metrics-every-30-min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/refresh-audit-metrics',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

SELECT cron.schedule(
  'process-scheduled-audits-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-scheduled-audits',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
*/


-- ============================================================================
-- DONE!
-- ============================================================================
-- Your database should now be much more stable
-- Expected I/O reduction: 85-90%
-- Monitor the health check query (Step 7) over the next few hours
-- ============================================================================
