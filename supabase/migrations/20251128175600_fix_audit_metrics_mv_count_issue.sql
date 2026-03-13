/*
  # Fix Audit Metrics Materialized View Count Issue

  1. Problem
    - Current view uses LEFT JOIN with prompts and LATERAL JOIN
    - This causes row duplication when counting responses
    - responses_received shows 26 instead of 30

  2. Solution
    - Separate the queries to avoid cross-join effects
    - Use subqueries for accurate counts
    - Keep citation stats in separate subquery

  3. Changes
    - Drop and recreate materialized view with corrected logic
    - Maintain same column structure for compatibility
*/

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS audit_metrics_mv CASCADE;

-- Create corrected materialized view
CREATE MATERIALIZED VIEW audit_metrics_mv AS
SELECT 
  a.id as audit_id,
  a.project_id,
  -- Get total prompts from project
  (SELECT COUNT(*) FROM prompts p WHERE p.project_id = a.project_id)::bigint as total_prompts,
  -- Count responses directly
  (SELECT COUNT(*) FROM llm_responses lr WHERE lr.audit_id = a.id AND lr.snapshot_id IS NOT NULL)::bigint as responses_sent,
  (SELECT COUNT(*) FROM llm_responses lr WHERE lr.audit_id = a.id AND lr.answer_text IS NOT NULL)::bigint as responses_received,
  (SELECT COUNT(*) FROM llm_responses lr WHERE lr.audit_id = a.id AND lr.answer_competitors IS NOT NULL)::bigint as competitors_found,
  (SELECT COUNT(*) FROM llm_responses lr WHERE lr.audit_id = a.id AND lr.sentiment_score IS NOT NULL)::bigint as sentiment_analyzed,
  -- Calculate citation stats per LLM
  (
    SELECT jsonb_object_agg(
      llm,
      jsonb_build_object(
        'prompts_with_citations', prompts_with_citations,
        'percentage', percentage
      )
    )
    FROM (
      SELECT 
        lr.llm,
        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM citations c 
          WHERE c.audit_id = a.id 
          AND c.prompt_id = lr.prompt_id 
          AND c.llm = lr.llm
        ) THEN lr.prompt_id END) as prompts_with_citations,
        CASE 
          WHEN COUNT(DISTINCT lr.prompt_id) > 0 
          THEN ROUND((COUNT(DISTINCT CASE WHEN EXISTS (
            SELECT 1 FROM citations c 
            WHERE c.audit_id = a.id 
            AND c.prompt_id = lr.prompt_id 
            AND c.llm = lr.llm
          ) THEN lr.prompt_id END)::numeric / COUNT(DISTINCT lr.prompt_id)::numeric * 100))
          ELSE 0
        END::integer as percentage
      FROM llm_responses lr
      WHERE lr.audit_id = a.id
      GROUP BY lr.llm
    ) llm_stats
  ) as citation_stats
FROM audits a;

-- Create unique index for fast lookups and concurrent refresh
CREATE UNIQUE INDEX audit_metrics_mv_audit_id_idx ON audit_metrics_mv(audit_id);

-- Grant access to authenticated users
GRANT SELECT ON audit_metrics_mv TO authenticated;
GRANT SELECT ON audit_metrics_mv TO service_role;

-- Refresh the view with new data
REFRESH MATERIALIZED VIEW audit_metrics_mv;
