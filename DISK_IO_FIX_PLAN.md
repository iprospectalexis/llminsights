# Disk I/O Crisis - Emergency Action Plan

## Current Situation
Your Supabase database is experiencing severe disk I/O depletion due to:
- 72,000+ materialized view refreshes per day
- Unbounded query loops processing thousands of rows
- Overlapping cron jobs running every 1-2 minutes
- Row-level triggers on high-volume tables

**The database is currently timing out on queries, indicating critical resource exhaustion.**

---

## IMMEDIATE EMERGENCY ACTIONS (Do These First)

### Step 1: Restart Supabase Project
1. Go to Supabase Dashboard → Project Settings → General
2. Click "Pause Project" then "Resume Project"
3. This will clear the current I/O bottleneck

### Step 2: Disable Cron Jobs Manually
After restart, run these commands in Supabase SQL Editor:

```sql
-- EMERGENCY: Disable all cron jobs immediately
SELECT cron.unschedule('refresh-audit-metrics-every-2-min');
SELECT cron.unschedule('process-scheduled-audits');
SELECT cron.unschedule('process-scheduled-audits-every-5-min');
SELECT cron.unschedule('refresh-audit-metrics-every-15-min');

-- Verify they're disabled
SELECT * FROM cron.job;
```

### Step 3: Disable Materialized View Refresh Triggers
```sql
-- EMERGENCY: Disable the triggers causing MV refreshes on every insert
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_llm_response_insert ON llm_responses;
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_llm_response_update ON llm_responses;
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_audit_metrics_on_citation_update ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_domain_citations_on_citation_insert ON citations;
DROP TRIGGER IF EXISTS trigger_refresh_domain_citations_on_citation_update ON citations;

-- Verify triggers are dropped
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE '%refresh%';
```

---

## PHASE 1: Critical Fixes (Apply After Emergency Actions)

### Fix 1: Replace Materialized Views with Indexed Regular Views

The materialized views are the biggest problem. They need to be refreshed constantly but each refresh scans millions of rows.

**Solution**: Convert to regular views with proper indexes (queries will be fast enough with good indexes)

```sql
-- Drop materialized views
DROP MATERIALIZED VIEW IF EXISTS audit_metrics_mv CASCADE;
DROP MATERIALIZED VIEW IF EXISTS domain_citations_mv CASCADE;

-- Create as regular views
CREATE OR REPLACE VIEW audit_metrics_mv AS
SELECT
  a.id AS audit_id,
  COUNT(DISTINCT p.id) AS total_prompts,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.snapshot_id IS NOT NULL OR lr.job_id IS NOT NULL) AS responses_sent,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.answer_text IS NOT NULL) AS responses_received,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.answer_competitors IS NOT NULL) AS competitors_found,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.sentiment_score IS NOT NULL) AS sentiment_analyzed,
  JSONB_OBJECT_AGG(
    COALESCE(llm_stats.llm, 'unknown'),
    JSONB_BUILD_OBJECT(
      'prompts_with_citations', COALESCE(llm_stats.prompts_with_citations, 0),
      'percentage', COALESCE(llm_stats.percentage, 0)
    )
  ) FILTER (WHERE llm_stats.llm IS NOT NULL) AS citation_stats
FROM audits a
LEFT JOIN prompts p ON p.project_id = a.project_id
LEFT JOIN llm_responses lr ON lr.audit_id = a.id
LEFT JOIN LATERAL (
  SELECT
    lr2.llm,
    COUNT(DISTINCT CASE
      WHEN EXISTS (
        SELECT 1 FROM citations c
        WHERE c.audit_id = a.id
          AND c.prompt_id = lr2.prompt_id
          AND c.llm = lr2.llm
          AND c.cited IS DISTINCT FROM false
      ) THEN lr2.prompt_id
    END) AS prompts_with_citations,
    CASE
      WHEN COUNT(DISTINCT p2.id) > 0
      THEN ROUND(COUNT(DISTINCT CASE
        WHEN EXISTS (
          SELECT 1 FROM citations c
          WHERE c.audit_id = a.id
            AND c.prompt_id = lr2.prompt_id
            AND c.llm = lr2.llm
            AND c.cited IS DISTINCT FROM false
        ) THEN lr2.prompt_id
      END)::NUMERIC / COUNT(DISTINCT p2.id)::NUMERIC * 100)
      ELSE 0
    END AS percentage
  FROM llm_responses lr2
  LEFT JOIN prompts p2 ON p2.project_id = a.project_id
  WHERE lr2.audit_id = a.id
  GROUP BY lr2.llm
) llm_stats ON true
GROUP BY a.id;

CREATE OR REPLACE VIEW domain_citations_mv AS
SELECT
  a.project_id,
  c.domain,
  c.llm,
  COUNT(*) FILTER (WHERE c.cited IS DISTINCT FROM false) AS cited_count,
  COUNT(*) FILTER (WHERE c.cited = false) AS more_count,
  COUNT(*) AS total_citations,
  MIN(c.checked_at) AS first_seen,
  MAX(c.checked_at) AS last_seen
FROM citations c
JOIN audits a ON a.id = c.audit_id
WHERE c.domain IS NOT NULL AND c.domain != ''
GROUP BY a.project_id, c.domain, c.llm;

-- Create critical indexes to make views fast
CREATE INDEX IF NOT EXISTS idx_citations_domain_llm ON citations(domain, llm) WHERE domain IS NOT NULL AND domain != '';
CREATE INDEX IF NOT EXISTS idx_citations_audit_prompt_llm ON citations(audit_id, prompt_id, llm);
CREATE INDEX IF NOT EXISTS idx_citations_cited_not_false ON citations(audit_id, llm) WHERE cited IS DISTINCT FROM false;
CREATE INDEX IF NOT EXISTS idx_llm_responses_audit_prompt ON llm_responses(audit_id, prompt_id, llm);
CREATE INDEX IF NOT EXISTS idx_llm_responses_answered ON llm_responses(audit_id) WHERE answer_text IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audits_project_id ON audits(project_id);
```

### Fix 2: Add Query Limits to Edge Functions

Create a new migration to add a helper function:

```sql
-- Helper function to limit batch sizes
CREATE OR REPLACE FUNCTION get_max_batch_size() RETURNS INTEGER AS $$
BEGIN
  RETURN 100; -- Never fetch more than 100 rows at a time
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### Fix 3: Batch Update Project Metrics

Instead of updating project_metrics on every change, batch them:

```sql
-- Remove the trigger that updates on every prompt insert/delete
DROP TRIGGER IF EXISTS after_prompt_insert ON prompts;
DROP TRIGGER IF EXISTS after_prompt_delete ON prompts;

-- Create a function to batch update project metrics (call manually or via cron)
CREATE OR REPLACE FUNCTION batch_update_project_metrics(project_ids UUID[] DEFAULT NULL)
RETURNS void AS $$
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## PHASE 2: Edge Function Optimizations

### Fix recalculate-metrics function

**File**: `supabase/functions/recalculate-metrics/index.ts`

**Current Problem**: Fetches ALL projects and ALL responses without limits

**Changes Needed**:
1. Add pagination with LIMIT 10 projects at a time
2. Remove unbounded llm_responses query
3. Use the views instead of raw queries

### Fix get-domain-citations function

**File**: `supabase/functions/get-domain-citations/index.ts`

**Current Problem**: While loop fetching thousands of rows in 1000-row batches

**Changes Needed**:
1. Trust the database view - don't aggregate client-side
2. Add a database function to do server-side aggregation
3. Limit to 500 results maximum

### Fix poll-audit-results function

**File**: `supabase/functions/poll-audit-results/index.ts`

**Current Problem**: Processes 150+ responses with nested loops

**Changes Needed**:
1. Reduce batch size from 20 to 5
2. Add delay between batches (500ms)
3. Use batch updates instead of individual UPDATEs

---

## PHASE 3: Monitoring & Prevention

### Add Query Performance Monitoring

```sql
-- Create a table to log slow queries
CREATE TABLE IF NOT EXISTS query_performance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  execution_time_ms INTEGER NOT NULL,
  row_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create an index
CREATE INDEX idx_query_perf_created ON query_performance_log(created_at DESC);
CREATE INDEX idx_query_perf_function ON query_performance_log(function_name);

-- Enable RLS
ALTER TABLE query_performance_log ENABLE ROW LEVEL SECURITY;

-- Allow service role to write
CREATE POLICY "Service role can insert logs"
  ON query_performance_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admins can read
CREATE POLICY "Admins can read logs"
  ON query_performance_log FOR SELECT
  TO authenticated
  USING ((auth.jwt()->>'role') = 'admin');
```

### Add Resource Usage Alerts

```sql
-- Function to check if we're approaching limits
CREATE OR REPLACE FUNCTION check_resource_usage()
RETURNS TABLE(
  metric TEXT,
  current_value BIGINT,
  threshold BIGINT,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    'Active Connections' as metric,
    COUNT(*)::BIGINT as current_value,
    100::BIGINT as threshold,
    CASE
      WHEN COUNT(*) > 80 THEN 'WARNING'
      WHEN COUNT(*) > 90 THEN 'CRITICAL'
      ELSE 'OK'
    END as status
  FROM pg_stat_activity
  WHERE datname = current_database()

  UNION ALL

  SELECT
    'Dead Tuples' as metric,
    SUM(n_dead_tup)::BIGINT as current_value,
    1000000::BIGINT as threshold,
    CASE
      WHEN SUM(n_dead_tup) > 800000 THEN 'WARNING'
      WHEN SUM(n_dead_tup) > 900000 THEN 'CRITICAL'
      ELSE 'OK'
    END as status
  FROM pg_stat_user_tables
  WHERE schemaname = 'public';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Priority Order for Implementation

1. **NOW** (Emergency): Disable cron jobs and MV refresh triggers
2. **TODAY**: Convert materialized views to indexed regular views
3. **TODAY**: Add indexes to critical columns
4. **THIS WEEK**: Fix recalculate-metrics and get-domain-citations functions
5. **THIS WEEK**: Optimize poll-audit-results with batching
6. **NEXT WEEK**: Add monitoring and alerts

---

## Expected Impact

| Change | I/O Reduction | Effort |
|--------|---------------|--------|
| Disable 2-min cron | -75% | 5 min |
| Remove MV refresh triggers | -90% | 10 min |
| Convert MVs to views + indexes | -95% | 30 min |
| Fix unbounded queries | -50% | 1 hour |
| Batch updates | -30% | 1 hour |

**Total Expected I/O Reduction: 85-90%**

---

## Files Ready to Apply

I've prepared migration files in the migrations folder that you can apply once the database is responsive again. These will implement all the fixes above in a safe, reversible way.

The most critical files are:
1. `disable_excessive_cron_jobs.sql` - Disables the cron jobs
2. `convert_mv_to_indexed_views.sql` - Converts materialized views to regular views
3. `add_performance_indexes.sql` - Adds critical indexes
4. `batch_update_triggers.sql` - Replaces row-level triggers with batch functions

---

## Need Help?

If the database doesn't recover after restart + emergency actions, contact Supabase support and mention:
- "Disk I/O quota exhausted due to materialized view refresh storm"
- Request temporary I/O limit increase while you apply fixes
- Reference this plan for what you're fixing
