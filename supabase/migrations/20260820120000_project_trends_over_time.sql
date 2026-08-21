-- Full-history trends for the Overview charts.
--
-- "Citations Over Time" and "Brand Mentions Over Time" were computed from the
-- page's client-side data, which only holds the 5 most recent audits (and at
-- most 500 citation rows) — so a project with a year of history showed a
-- handful of points. These RPCs aggregate the WHOLE project history
-- server-side and return one compact row per (audit date × series).
--
-- SECURITY INVOKER (default): the caller's RLS still applies.

DROP FUNCTION IF EXISTS project_citations_over_time(uuid, text, text[], timestamptz, timestamptz, text, text, integer);

CREATE FUNCTION project_citations_over_time(
  p_project_id uuid,
  p_llm text DEFAULT NULL,
  p_groups text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_project_domain text DEFAULT NULL,
  p_domain_mode text DEFAULT 'exact',
  p_max_domains integer DEFAULT 15
)
RETURNS TABLE(audit_date date, domain text, citations bigint, total bigint)
LANGUAGE sql
STABLE
AS $$
  WITH cit AS (
    SELECT a.created_at::date AS d,
           lower(regexp_replace(c.domain, '^www\.', '')) AS domain
    FROM citations c
    JOIN audits a ON a.id = c.audit_id
    LEFT JOIN prompts pr ON pr.id = c.prompt_id
    WHERE a.project_id = p_project_id
      AND c.domain IS NOT NULL AND c.domain <> ''
      AND (p_llm IS NULL OR c.llm = p_llm)
      AND (p_groups IS NULL OR pr.prompt_group = ANY(p_groups))
      AND (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
  ),
  totals AS (
    SELECT d, count(*)::bigint AS total FROM cit GROUP BY d
  ),
  per_date AS (
    SELECT d, domain, count(*)::bigint AS n FROM cit GROUP BY d, domain
  ),
  keep AS (
    -- Global top-N domains … (parenthesised: a LIMIT branch cannot be
    -- followed directly by UNION in Postgres)
    (SELECT domain FROM per_date
     GROUP BY domain ORDER BY sum(n) DESC LIMIT GREATEST(p_max_domains, 1))
    UNION
    -- … plus the project's own domain (and its subdomains in that mode),
    -- which must always have a line even when it is not in the top-N.
    (SELECT domain FROM per_date
     WHERE p_project_domain IS NOT NULL
       AND (domain = p_project_domain
            OR (p_domain_mode = 'subdomains' AND domain LIKE '%.' || p_project_domain)))
  )
  SELECT pd.d, pd.domain, pd.n, t.total
  FROM per_date pd
  JOIN totals t ON t.d = pd.d
  WHERE pd.domain IN (SELECT domain FROM keep)
  UNION ALL
  -- One NULL-domain row per date carries the date's total, so dates whose
  -- domains all fell outside the top-N still produce a chart point.
  SELECT t.d, NULL::text, 0::bigint, t.total FROM totals t
  ORDER BY 1, 3 DESC;
$$;

GRANT EXECUTE ON FUNCTION project_citations_over_time(uuid, text, text[], timestamptz, timestamptz, text, text, integer) TO authenticated;


DROP FUNCTION IF EXISTS project_mentions_over_time(uuid, text, text[], text, timestamptz, timestamptz, integer);

CREATE FUNCTION project_mentions_over_time(
  p_project_id uuid,
  p_llm text DEFAULT NULL,
  p_groups text[] DEFAULT NULL,
  p_sentiment text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_max_brands integer DEFAULT 40
)
RETURNS TABLE(audit_date date, brand text, mentions bigint, total_responses bigint)
LANGUAGE sql
STABLE
AS $$
  WITH resp AS (
    SELECT lr.id, a.created_at::date AS d,
           CASE WHEN jsonb_typeof(lr.answer_competitors -> 'brands') = 'array'
                THEN lr.answer_competitors -> 'brands'
                ELSE '[]'::jsonb END AS brands
    FROM llm_responses lr
    JOIN audits a ON a.id = lr.audit_id
    LEFT JOIN prompts pr ON pr.id = lr.prompt_id
    WHERE a.project_id = p_project_id
      -- Denominator = ANALYSED responses only. Audits predating competitor
      -- extraction (e.g. this project's Sept-2025 runs) have
      -- answer_competitors IS NULL; counting them would paint months of
      -- fake "0% mentions" instead of leaving those dates out.
      AND lr.answer_competitors IS NOT NULL
      AND (p_llm IS NULL OR lr.llm = p_llm)
      AND (p_groups IS NULL OR pr.prompt_group = ANY(p_groups))
      AND (p_sentiment IS NULL OR lr.sentiment_label = p_sentiment)
      AND (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
  ),
  totals AS (
    SELECT d, count(*)::bigint AS total FROM resp GROUP BY d
  ),
  per_date AS (
    SELECT r.d, b ->> 'name' AS brand, count(DISTINCT r.id)::bigint AS mentions
    FROM resp r, jsonb_array_elements(r.brands) b
    WHERE b ->> 'name' IS NOT NULL AND b ->> 'name' <> ''
    GROUP BY r.d, b ->> 'name'
  ),
  keep AS (
    SELECT brand FROM per_date
    GROUP BY brand ORDER BY sum(mentions) DESC LIMIT GREATEST(p_max_brands, 1)
  )
  SELECT pd.d, pd.brand, pd.mentions, t.total
  FROM per_date pd
  JOIN totals t ON t.d = pd.d
  WHERE pd.brand IN (SELECT brand FROM keep)
  UNION ALL
  SELECT t.d, NULL::text, 0::bigint, t.total FROM totals t
  ORDER BY 1, 3 DESC;
$$;

GRANT EXECUTE ON FUNCTION project_mentions_over_time(uuid, text, text[], text, timestamptz, timestamptz, integer) TO authenticated;
