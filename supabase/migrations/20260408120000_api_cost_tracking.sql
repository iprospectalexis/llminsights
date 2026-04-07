/*
  # API Cost Tracking

  Adds polymorphic capture of every external API call (OpenAI chat completions
  for competitor extraction & sentiment analysis, plus Brightdata/OneSearch
  scrape jobs) so admins/managers can monitor spend by project, user, audit,
  provider and operation.

  ## Tables
  1. api_pricing_rates - versioned price list, seedable & editable in SQL
  2. api_usage_events  - one row per API call, cost computed at write time

  ## View
  1. audit_cost_summary - rollup per audit, used by the admin dashboard

  ## Security
  - Both tables RLS-enabled with select policies via existing is_manager()
  - No client INSERT/UPDATE/DELETE policies: backend writes via service_role
*/

-- Helper: true for users with role 'admin' OR 'manager'. Mirrors the existing
-- is_admin() helper but covers managers as well, since the cost dashboard is
-- visible to both. SECURITY DEFINER so it can read users.role without being
-- blocked by RLS on that table.
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_manager() TO authenticated;

CREATE TABLE IF NOT EXISTS api_pricing_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  model           text,
  operation       text NOT NULL,
  unit            text NOT NULL,
  unit_cost_usd   numeric(14,8) NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  notes           text,
  CHECK (unit_cost_usd >= 0)
);

CREATE INDEX IF NOT EXISTS api_pricing_lookup
  ON api_pricing_rates(provider, model, operation, unit, effective_from DESC);

-- Seed rates. Adjust unit_cost_usd in SQL whenever pricing changes; the
-- backend cache (5 min TTL) will pick the new values up automatically.
INSERT INTO api_pricing_rates(provider, model, operation, unit, unit_cost_usd, notes) VALUES
  ('openai',     'gpt-5-mini', 'chat',   'token_input',  0.00000025, '$0.25 / 1M input tokens'),
  ('openai',     'gpt-5-mini', 'chat',   'token_output', 0.00000200, '$2.00 / 1M output tokens'),
  ('brightdata', NULL,         'scrape', 'prompt',       0.00150000, '~$0.0015 per scraped prompt (confirm with real billing)'),
  ('onesearch',  NULL,         'scrape', 'prompt',       0.00100000, '~$0.001 per scraped prompt');

CREATE TABLE IF NOT EXISTS api_usage_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  audit_id          uuid REFERENCES audits(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  provider          text NOT NULL,
  model             text,
  operation         text NOT NULL,
  prompt_tokens     integer,
  completion_tokens integer,
  cached_tokens     integer,
  reasoning_tokens  integer,
  units             integer,
  cost_usd          numeric(14,8) NOT NULL DEFAULT 0,
  metadata          jsonb,
  CHECK (cost_usd >= 0)
);

CREATE INDEX IF NOT EXISTS api_usage_audit      ON api_usage_events(audit_id);
CREATE INDEX IF NOT EXISTS api_usage_project_at ON api_usage_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_user_at    ON api_usage_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_occurred   ON api_usage_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_provider   ON api_usage_events(provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_operation  ON api_usage_events(operation, occurred_at DESC);

ALTER TABLE api_pricing_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_and_admins_select_pricing" ON api_pricing_rates;
CREATE POLICY "managers_and_admins_select_pricing"
  ON api_pricing_rates FOR SELECT TO authenticated
  USING (is_manager());

DROP POLICY IF EXISTS "managers_and_admins_select_usage" ON api_usage_events;
CREATE POLICY "managers_and_admins_select_usage"
  ON api_usage_events FOR SELECT TO authenticated
  USING (is_manager());

-- Audit-level rollup
CREATE OR REPLACE VIEW audit_cost_summary AS
SELECT
  e.audit_id,
  a.project_id,
  a.run_by AS user_id,
  MIN(e.occurred_at) AS first_event_at,
  MAX(e.occurred_at) AS last_event_at,
  SUM(e.cost_usd) AS total_cost_usd,
  SUM(CASE WHEN e.provider = 'openai'     THEN e.cost_usd ELSE 0 END) AS openai_cost_usd,
  SUM(CASE WHEN e.provider = 'brightdata' THEN e.cost_usd ELSE 0 END) AS brightdata_cost_usd,
  SUM(CASE WHEN e.provider = 'onesearch'  THEN e.cost_usd ELSE 0 END) AS onesearch_cost_usd,
  SUM(CASE WHEN e.operation = 'scrape'              THEN e.cost_usd ELSE 0 END) AS scrape_cost_usd,
  SUM(CASE WHEN e.operation = 'competitors_extract' THEN e.cost_usd ELSE 0 END) AS competitors_cost_usd,
  SUM(CASE WHEN e.operation = 'sentiment_analyze'   THEN e.cost_usd ELSE 0 END) AS sentiment_cost_usd,
  SUM(COALESCE(e.prompt_tokens, 0))     AS total_prompt_tokens,
  SUM(COALESCE(e.completion_tokens, 0)) AS total_completion_tokens,
  COUNT(*) FILTER (WHERE e.provider = 'openai')  AS openai_calls,
  COUNT(*) FILTER (WHERE e.provider <> 'openai') AS scrape_calls
FROM api_usage_events e
JOIN audits a ON a.id = e.audit_id
GROUP BY e.audit_id, a.project_id, a.run_by;

GRANT SELECT ON audit_cost_summary TO authenticated;

-- ─── RPCs for the admin Costs page ───────────────────────────────────────
-- All RPCs are SECURITY DEFINER (so they can read across tables) but enforce
-- access via the existing is_manager() helper. Regular users get an empty
-- result instead of an error so the UI can simply hide nothing.

CREATE OR REPLACE FUNCTION get_costs_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  total_cost_usd          numeric,
  openai_cost_usd         numeric,
  brightdata_cost_usd     numeric,
  onesearch_cost_usd      numeric,
  competitors_cost_usd    numeric,
  sentiment_cost_usd      numeric,
  scrape_cost_usd         numeric,
  total_calls             bigint,
  audits_count            bigint,
  prev_total_cost_usd     numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period interval := p_to - p_from;
BEGIN
  IF NOT is_manager() THEN RETURN; END IF;
  RETURN QUERY
  WITH cur AS (
    SELECT * FROM api_usage_events WHERE occurred_at >= p_from AND occurred_at < p_to
  ),
  prev AS (
    SELECT COALESCE(SUM(cost_usd), 0) AS s FROM api_usage_events
    WHERE occurred_at >= p_from - v_period AND occurred_at < p_from
  )
  SELECT
    COALESCE(SUM(cur.cost_usd), 0),
    COALESCE(SUM(CASE WHEN cur.provider = 'openai'     THEN cur.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cur.provider = 'brightdata' THEN cur.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cur.provider = 'onesearch'  THEN cur.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cur.operation = 'competitors_extract' THEN cur.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cur.operation = 'sentiment_analyze'   THEN cur.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cur.operation = 'scrape'              THEN cur.cost_usd ELSE 0 END), 0),
    COUNT(*)::bigint,
    COUNT(DISTINCT cur.audit_id)::bigint,
    (SELECT s FROM prev)
  FROM cur;
END;
$$;

CREATE OR REPLACE FUNCTION get_costs_daily(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  day                     date,
  openai_cost_usd         numeric,
  brightdata_cost_usd     numeric,
  onesearch_cost_usd      numeric,
  competitors_cost_usd    numeric,
  sentiment_cost_usd      numeric,
  scrape_cost_usd         numeric,
  total_cost_usd          numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_manager() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    date_trunc('day', occurred_at)::date AS day,
    COALESCE(SUM(CASE WHEN provider = 'openai'     THEN cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN provider = 'brightdata' THEN cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN provider = 'onesearch'  THEN cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation = 'competitors_extract' THEN cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation = 'sentiment_analyze'   THEN cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation = 'scrape'              THEN cost_usd ELSE 0 END), 0),
    COALESCE(SUM(cost_usd), 0)
  FROM api_usage_events
  WHERE occurred_at >= p_from AND occurred_at < p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

CREATE OR REPLACE FUNCTION get_costs_by_project(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  project_id             uuid,
  project_name           text,
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
  ORDER BY 4 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION get_costs_by_user(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  user_id                uuid,
  user_email             text,
  user_full_name         text,
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
    e.user_id,
    u.email,
    u.full_name,
    COUNT(DISTINCT e.audit_id)::bigint,
    COALESCE(SUM(e.cost_usd), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'openai'     THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'brightdata' THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.provider = 'onesearch'  THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'competitors_extract' THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'sentiment_analyze'   THEN e.cost_usd ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN e.operation = 'scrape'              THEN e.cost_usd ELSE 0 END), 0)
  FROM api_usage_events e
  LEFT JOIN users u ON u.id = e.user_id
  WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
    AND e.user_id IS NOT NULL
  GROUP BY e.user_id, u.email, u.full_name
  ORDER BY 5 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION get_costs_by_operation(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  operation              text,
  calls                  bigint,
  total_units            bigint,
  total_prompt_tokens    bigint,
  total_completion_tokens bigint,
  total_cost_usd         numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_manager() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    e.operation,
    COUNT(*)::bigint,
    COALESCE(SUM(e.units), 0)::bigint,
    COALESCE(SUM(e.prompt_tokens), 0)::bigint,
    COALESCE(SUM(e.completion_tokens), 0)::bigint,
    COALESCE(SUM(e.cost_usd), 0)
  FROM api_usage_events e
  WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
  GROUP BY e.operation
  ORDER BY 6 DESC;
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

CREATE OR REPLACE FUNCTION get_audit_cost_events(p_audit_id uuid)
RETURNS TABLE (
  id                uuid,
  occurred_at       timestamptz,
  provider          text,
  model             text,
  operation         text,
  prompt_tokens     integer,
  completion_tokens integer,
  units             integer,
  cost_usd          numeric,
  metadata          jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_manager() THEN RETURN; END IF;
  RETURN QUERY
  SELECT e.id, e.occurred_at, e.provider, e.model, e.operation,
         e.prompt_tokens, e.completion_tokens, e.units, e.cost_usd, e.metadata
  FROM api_usage_events e
  WHERE e.audit_id = p_audit_id
  ORDER BY e.occurred_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_costs_summary(timestamptz, timestamptz)            TO authenticated;
GRANT EXECUTE ON FUNCTION get_costs_daily(timestamptz, timestamptz)              TO authenticated;
GRANT EXECUTE ON FUNCTION get_costs_by_project(timestamptz, timestamptz)         TO authenticated;
GRANT EXECUTE ON FUNCTION get_costs_by_user(timestamptz, timestamptz)            TO authenticated;
GRANT EXECUTE ON FUNCTION get_costs_by_operation(timestamptz, timestamptz)       TO authenticated;
GRANT EXECUTE ON FUNCTION get_costs_by_audit(timestamptz, timestamptz, uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_cost_events(uuid)                            TO authenticated;
