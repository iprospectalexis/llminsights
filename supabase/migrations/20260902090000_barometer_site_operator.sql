-- Barometer: share of ChatGPT (SearchGPT) fan-out queries that use the
-- "site:" operator, over time.
--
-- ChatGPT started restricting part of its web searches to a domain with
-- "site:<domain> ..." in early August 2026 (0% of fan-out queries before,
-- ~25% of them in August). This RPC feeds the "site:" chart on the
-- Barometers page: per period, the share of individual queries carrying the
-- operator and the share of responses with at least one such query.
--
-- Same conventions as the sibling get_web_search_*_by_time functions:
-- web_search_query is a text column holding either a JSON array of queries
-- or a single query; SECURITY DEFINER with an auth.uid() guard; the
-- operator is matched at a word start so "website:" does not count.

DROP FUNCTION IF EXISTS get_web_search_site_operator_by_time(text);

CREATE OR REPLACE FUNCTION get_web_search_site_operator_by_time(date_trunc_arg text)
RETURNS TABLE(
  time_period text,
  queries_total bigint,
  queries_with_site bigint,
  pct_queries numeric,
  responses_total bigint,
  responses_with_site bigint,
  pct_responses numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow authenticated users
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  WITH expanded AS (
    SELECT lr.id, lr.created_at, q.query
    FROM llm_responses lr
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(lr.web_search_query::jsonb) AS query
      WHERE lr.web_search_query ~ '^\[.*\]$'
      UNION ALL
      SELECT lr.web_search_query AS query
      WHERE NOT (lr.web_search_query ~ '^\[.*\]$')
    ) q
    WHERE lr.llm = 'searchgpt'
      AND lr.web_search_query IS NOT NULL
      AND lr.web_search_query <> ''
      AND lr.web_search_query <> '[]'
  ),
  flagged AS (
    SELECT e.id, e.created_at, (e.query ~* '(^|[^a-z])site:') AS has_site
    FROM expanded e
    WHERE e.query IS NOT NULL AND btrim(e.query) <> ''
  ),
  per_query AS (
    SELECT date_trunc(date_trunc_arg, f.created_at) AS d,
           count(*) AS q_total,
           count(*) FILTER (WHERE f.has_site) AS q_site
    FROM flagged f
    GROUP BY 1
  ),
  per_response AS (
    SELECT date_trunc(date_trunc_arg, r.created_at) AS d,
           count(*) AS r_total,
           count(*) FILTER (WHERE r.any_site) AS r_site
    FROM (
      SELECT f.id, min(f.created_at) AS created_at, bool_or(f.has_site) AS any_site
      FROM flagged f
      GROUP BY f.id
    ) r
    GROUP BY 1
  )
  SELECT to_char(pq.d, 'YYYY-MM-DD') AS time_period,
         pq.q_total::bigint,
         pq.q_site::bigint,
         round(pq.q_site::numeric / NULLIF(pq.q_total, 0) * 100, 2),
         pr.r_total::bigint,
         pr.r_site::bigint,
         round(pr.r_site::numeric / NULLIF(pr.r_total, 0) * 100, 2)
  FROM per_query pq
  JOIN per_response pr USING (d)
  ORDER BY pq.d;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_web_search_site_operator_by_time(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_web_search_site_operator_by_time(text) TO authenticated, service_role;
