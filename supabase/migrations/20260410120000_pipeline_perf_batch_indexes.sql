-- Pipeline performance: drop MV-refresh triggers + add partial indexes
--
-- Problem: During a 250-prompt audit, STATEMENT-level triggers on llm_responses
-- queue materialized view refreshes after every batch INSERT/UPDATE/DELETE.
-- The MV (audit_metrics_mv) does an expensive LATERAL JOIN + EXISTS across
-- all audits/responses/citations — refreshing it hundreds of times during
-- processing kills the 4GB/2-core DB.
--
-- Fix:
--   1. Drop the 3 triggers that queue MV refresh on llm_responses writes.
--      handle_finalize() already calls refresh_audit_metrics() explicitly,
--      and the 10-min cron job (refresh-audit-metrics-job) remains as safety net.
--   2. Add partial indexes for hot pipeline queries (competitor/sentiment pending).
--   3. Add composite index on project_members for RLS policy optimization.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Drop MV-refresh triggers on llm_responses
-- ═══════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_insert ON llm_responses;
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_update ON llm_responses;
DROP TRIGGER IF EXISTS llm_responses_queue_metrics_refresh_delete ON llm_responses;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Partial indexes for pipeline hot queries
-- ═══════════════════════════════════════════════════════════════════════

-- get_responses_for_competitors(): rows needing competitor extraction
CREATE INDEX IF NOT EXISTS idx_lr_pending_competitors
  ON llm_responses (audit_id)
  WHERE answer_text IS NOT NULL
    AND (answer_competitors IS NULL OR answer_competitors ? 'error');

-- get_responses_for_sentiment_v2(): rows needing sentiment analysis
-- (checks NOT EXISTS on response_brand_sentiment, but the scan starts here)
CREATE INDEX IF NOT EXISTS idx_lr_pending_sentiment
  ON llm_responses (audit_id)
  WHERE answer_text IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RLS optimization: composite index on project_members
-- ═══════════════════════════════════════════════════════════════════════

-- The RLS policy on response_brand_sentiment does:
--   EXISTS (SELECT 1 FROM audits a JOIN projects p ... LEFT JOIN project_members pm
--           ON p.id = pm.project_id AND pm.user_id = auth.uid() ...)
-- This index makes that lookup an index scan instead of seq scan.
CREATE INDEX IF NOT EXISTS idx_project_members_lookup
  ON project_members (project_id, user_id);
