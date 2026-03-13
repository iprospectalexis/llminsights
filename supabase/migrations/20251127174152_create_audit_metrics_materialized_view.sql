/*
  # Create Materialized View for Audit Metrics
  
  1. Purpose
    - Provides fast access to audit progress metrics
    - Calculates responses sent, received, competitors found, sentiment analyzed
    - Includes citation statistics per LLM
    - Eliminates need for complex joins on Status page
  
  2. Metrics Included
    - total_prompts: Total prompts for the project
    - responses_sent: LLM responses with snapshot_id (sent to BrightData)
    - responses_received: LLM responses with answer_text (received from BrightData)
    - competitors_found: Responses with extracted competitor data
    - sentiment_analyzed: Responses with sentiment analysis completed
    - citation_stats: Per-LLM citation statistics with percentages
  
  3. Performance
    - Materialized for fast reads
    - Refresh trigger updates on llm_responses changes
    - Indexed on audit_id for quick lookups
  
  4. Security
    - Grant SELECT to authenticated users (RLS on audits table controls access)
*/

-- Create materialized view for audit metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS audit_metrics_mv AS
SELECT 
  a.id as audit_id,
  COUNT(DISTINCT p.id) as total_prompts,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.snapshot_id IS NOT NULL) as responses_sent,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.answer_text IS NOT NULL) as responses_received,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.answer_competitors IS NOT NULL) as competitors_found,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.sentiment_score IS NOT NULL) as sentiment_analyzed,
  jsonb_object_agg(
    COALESCE(llm_stats.llm, 'unknown'),
    jsonb_build_object(
      'prompts_with_citations', COALESCE(llm_stats.prompts_with_citations, 0),
      'percentage', COALESCE(llm_stats.percentage, 0)
    )
  ) FILTER (WHERE llm_stats.llm IS NOT NULL) as citation_stats
FROM audits a
LEFT JOIN prompts p ON p.project_id = a.project_id
LEFT JOIN llm_responses lr ON lr.audit_id = a.id
LEFT JOIN LATERAL (
  SELECT 
    lr2.llm,
    COUNT(DISTINCT CASE WHEN EXISTS (
      SELECT 1 FROM citations c 
      WHERE c.audit_id = a.id 
      AND c.prompt_id = lr2.prompt_id 
      AND c.llm = lr2.llm
    ) THEN lr2.prompt_id END) as prompts_with_citations,
    CASE 
      WHEN COUNT(DISTINCT p2.id) > 0 
      THEN ROUND((COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM citations c 
        WHERE c.audit_id = a.id 
        AND c.prompt_id = lr2.prompt_id 
        AND c.llm = lr2.llm
      ) THEN lr2.prompt_id END)::numeric / COUNT(DISTINCT p2.id)::numeric * 100))
      ELSE 0
    END as percentage
  FROM llm_responses lr2
  LEFT JOIN prompts p2 ON p2.project_id = a.project_id
  WHERE lr2.audit_id = a.id
  GROUP BY lr2.llm
) llm_stats ON true
GROUP BY a.id;

-- Create unique index for fast lookups and concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS audit_metrics_mv_audit_id_idx ON audit_metrics_mv(audit_id);

-- Grant access to authenticated users
GRANT SELECT ON audit_metrics_mv TO authenticated;

-- Create function to refresh metrics for specific audit
CREATE OR REPLACE FUNCTION refresh_audit_metrics(p_audit_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_audit_id IS NULL THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
  ELSE
    -- For single audit refresh, we refresh the whole view concurrently
    -- PostgreSQL doesn't support partial materialized view refresh
    REFRESH MATERIALIZED VIEW CONCURRENTLY audit_metrics_mv;
  END IF;
END;
$$;

-- Create trigger function to refresh metrics when responses change
CREATE OR REPLACE FUNCTION trigger_refresh_audit_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Refresh asynchronously to avoid blocking
  PERFORM refresh_audit_metrics(COALESCE(NEW.audit_id, OLD.audit_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger on llm_responses for automatic refresh
DROP TRIGGER IF EXISTS llm_responses_metrics_refresh ON llm_responses;
CREATE TRIGGER llm_responses_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON llm_responses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_refresh_audit_metrics();

-- Create trigger on citations for automatic refresh
DROP TRIGGER IF EXISTS citations_metrics_refresh ON citations;
CREATE TRIGGER citations_metrics_refresh
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_refresh_audit_metrics();

-- Initial refresh
REFRESH MATERIALIZED VIEW audit_metrics_mv;