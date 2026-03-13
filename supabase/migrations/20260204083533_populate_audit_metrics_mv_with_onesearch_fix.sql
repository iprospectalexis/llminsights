/*
  # Populate audit_metrics_mv with fixed OneSearch calculation

  1. Changes
    - Remove WHERE false clause to allow data population
    - Keep the fixed responses_sent calculation that includes job_id

  2. Purpose
    - Actually populate the metrics view with data
    - Enable database icon for OneSearch audits

  3. Security
    - No security changes
*/

DROP MATERIALIZED VIEW IF EXISTS audit_metrics_mv CASCADE;

CREATE MATERIALIZED VIEW audit_metrics_mv AS
SELECT
  a.id as audit_id,
  COUNT(DISTINCT p.id) as total_prompts,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.snapshot_id IS NOT NULL OR lr.job_id IS NOT NULL) as responses_sent,
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
      AND c.cited IS DISTINCT FROM false
    ) THEN lr2.prompt_id END) as prompts_with_citations,
    CASE
      WHEN COUNT(DISTINCT p2.id) > 0
      THEN ROUND((COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM citations c
        WHERE c.audit_id = a.id
        AND c.prompt_id = lr2.prompt_id
        AND c.llm = lr2.llm
        AND c.cited IS DISTINCT FROM false
      ) THEN lr2.prompt_id END)::numeric / COUNT(DISTINCT p2.id)::numeric * 100))
      ELSE 0
    END as percentage
  FROM llm_responses lr2
  LEFT JOIN prompts p2 ON p2.project_id = a.project_id
  WHERE lr2.audit_id = a.id
  GROUP BY lr2.llm
) llm_stats ON true
GROUP BY a.id;

CREATE UNIQUE INDEX audit_metrics_mv_audit_id_idx ON audit_metrics_mv(audit_id);

GRANT SELECT ON audit_metrics_mv TO authenticated;
GRANT SELECT ON audit_metrics_mv TO service_role;
