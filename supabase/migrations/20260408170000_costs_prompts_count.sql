-- Add prompts_count to admin/costs RPCs.
--
-- The number of prompts is a property of the project, not of the cost
-- events themselves, so it has to be joined in via a scalar subquery
-- against `prompts.project_id`. For an audit, the prompt count equals
-- the count for its project at the moment the query runs (the schema
-- has no per-audit prompt snapshot — audits resolve prompts via project).
--
-- Both functions need DROP + CREATE because we're adding a column to
-- the RETURNS TABLE shape — Postgres rejects CREATE OR REPLACE when
-- the return type changes.

DROP FUNCTION IF EXISTS get_costs_by_project(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS get_costs_by_audit(timestamptz, timestamptz, uuid, uuid, int);

CREATE OR REPLACE FUNCTION get_costs_by_project(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  project_id             uuid,
  project_name           text,
  prompts_count          bigint,
  audits_count           bigint,
  total_cost_usd         numeric,
  openai_cost_usd        numeric,
  brightdata_cost_usd    numeric,
  onesearch_cost_usd     numeric,
  competitors_cost_usd   numeric,
  sentiment_cost_usd     numeric,
  scrape_cost_usd        numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_manager() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    e.project_id,
    p.name,
    COALESCE(
      (SELECT count(*)::bigint FROM prompts pr WHERE pr.project_id = e.project_id),
      0
    ),
    COUNT(DISTINCT e.audit_id)::bigint,
    COALESCE(SUM(e.cost_usd), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'openai'     THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'brightdata' THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'onesearch'  THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'competitors_extract' THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'sentiment_analyze'   THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'scrape'              THEN e.cost_usd ELSE 0 END), 0)
  FROM api_usage_events e
  LEFT JOIN projects p ON p.id = e.project_id
  WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
    AND e.project_id IS NOT NULL
  GROUP BY e.project_id, p.name
  ORDER BY 5 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION get_costs_by_audit(
  p_from timestamptz, p_to timestamptz,
  p_project_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  audit_id              uuid,
  project_id            uuid,
  project_name          text,
  user_id               uuid,
  user_email            text,
  started_at            timestamptz,
  status                text,
  prompts_count         bigint,
  total_cost_usd        numeric,
  openai_cost_usd       numeric,
  scrape_cost_usd       numeric,
  competitors_cost_usd  numeric,
  sentiment_cost_usd    numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_manager() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    e.audit_id,
    a.project_id,
    p.name,
    a.run_by,
    u.email,
    a.started_at,
    a.status,
    COALESCE(
      (SELECT count(*)::bigint FROM prompts pr WHERE pr.project_id = a.project_id),
      0
    ),
    COALESCE(SUM(e.cost_usd), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'openai' THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'scrape'              THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'competitors_extract' THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'sentiment_analyze'   THEN e.cost_usd ELSE 0 END), 0)
  FROM api_usage_events e
  JOIN audits a ON a.id = e.audit_id
  LEFT JOIN projects p ON p.id = a.project_id
  LEFT JOIN users u ON u.id = a.run_by
  WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
    AND (p_project_id IS NULL OR a.project_id = p_project_id)
    AND (p_user_id IS NULL OR a.run_by = p_user_id)
  GROUP BY e.audit_id, a.project_id, p.name, a.run_by, u.email, a.started_at, a.status
  ORDER BY a.started_at DESC NULLS LAST
  LIMIT p_limit;
END;
$$;
