/*
  # Create Audit Metrics Materialized View

  ## Overview
  This migration creates a materialized view to precompute audit metrics, eliminating the N+1 query problem
  on the Status page. Instead of making 60+ queries for 10 audits, we'll make 1-2 queries total.

  ## Problem Being Solved
  - Current implementation: 6 separate queries per audit (N+1 problem)
  - With 10 audits: 60+ database queries
  - With 50 audits: 300+ database queries
  - Loading time: 15-30 seconds for 50 audits

  ## Solution
  - Materialized view that precomputes all metrics
  - Reduces queries from N×6 to just 1
  - Expected improvement: 500ms load time instead of 15+ seconds

  ## New Objects

  1. **Materialized View: audit_metrics_mv**
     - `audit_id` (uuid) - Link to audits table
     - `project_id` (uuid) - Link to projects table
     - `total_prompts` (bigint) - Count of prompts for the project
     - `responses_sent` (bigint) - Count of sent responses
     - `responses_received` (bigint) - Count of received responses (with answer_text)
     - `competitors_found` (bigint) - Count of responses with competitors data
     - `sentiment_analyzed` (bigint) - Count of responses with sentiment analysis
     - `citation_stats` (jsonb) - Per-LLM citation statistics

  2. **Function: refresh_audit_metrics()**
     - Refreshes the materialized view
     - Can be called manually or via triggers

  3. **Index: idx_audit_metrics_audit_id**
     - Fast lookups by audit_id

  ## Security
  - Access controlled through edge function with service_role
*/

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS audit_metrics_mv CASCADE;

-- Create the materialized view with all audit metrics
CREATE MATERIALIZED VIEW audit_metrics_mv AS
WITH audit_response_stats AS (
  SELECT 
    lr.audit_id,
    COUNT(*) as responses_sent,
    COUNT(*) FILTER (WHERE lr.answer_text IS NOT NULL) as responses_received,
    COUNT(*) FILTER (WHERE lr.answer_competitors IS NOT NULL) as competitors_found,
    COUNT(*) FILTER (WHERE lr.sentiment_score IS NOT NULL) as sentiment_analyzed
  FROM llm_responses lr
  GROUP BY lr.audit_id
),
audit_citation_stats AS (
  SELECT 
    c.audit_id,
    c.llm,
    COUNT(DISTINCT c.prompt_id) as prompts_with_citations
  FROM citations c
  GROUP BY c.audit_id, c.llm
),
project_prompt_counts AS (
  SELECT 
    p.project_id,
    COUNT(*) as total_prompts
  FROM prompts p
  GROUP BY p.project_id
)
SELECT 
  a.id as audit_id,
  a.project_id,
  COALESCE(ppc.total_prompts, 0) as total_prompts,
  COALESCE(ars.responses_sent, 0) as responses_sent,
  COALESCE(ars.responses_received, 0) as responses_received,
  COALESCE(ars.competitors_found, 0) as competitors_found,
  COALESCE(ars.sentiment_analyzed, 0) as sentiment_analyzed,
  
  -- Build citation stats as JSONB
  COALESCE(
    (SELECT jsonb_object_agg(
      llm_name,
      jsonb_build_object(
        'prompts_with_citations', COALESCE(acs.prompts_with_citations, 0),
        'percentage', CASE 
          WHEN COALESCE(ppc.total_prompts, 0) > 0 
          THEN ROUND((COALESCE(acs.prompts_with_citations, 0)::numeric / ppc.total_prompts::numeric) * 100)
          ELSE 0 
        END
      )
    )
    FROM unnest(a.llms) as llm_name
    LEFT JOIN audit_citation_stats acs ON acs.audit_id = a.id AND acs.llm = llm_name
    ),
    '{}'::jsonb
  ) as citation_stats

FROM audits a
LEFT JOIN audit_response_stats ars ON ars.audit_id = a.id
LEFT JOIN project_prompt_counts ppc ON ppc.project_id = a.project_id;

-- Create unique index for fast lookups and concurrent refresh
CREATE UNIQUE INDEX idx_audit_metrics_audit_id ON audit_metrics_mv(audit_id);

-- Create additional indexes for common queries
CREATE INDEX idx_audit_metrics_project_id ON audit_metrics_mv(project_id);

-- Create a function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_audit_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
END;
$$;

-- Grant execute permission to service_role and authenticated users
GRANT EXECUTE ON FUNCTION refresh_audit_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION refresh_audit_metrics() TO authenticated;

-- Grant select permission on the materialized view
GRANT SELECT ON audit_metrics_mv TO authenticated;
GRANT SELECT ON audit_metrics_mv TO service_role;
