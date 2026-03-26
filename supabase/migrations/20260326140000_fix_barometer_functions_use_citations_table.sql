/*
  # Fix Barometer Functions - Use citations table instead of llm_responses.citations JSONB

  Problem:
  - The llm_responses.citations JSONB column was not being populated during audit processing
    (bug fixed separately). Existing data has NULL values in this column.
  - Barometer functions get_web_search_count_by_time and get_web_search_trigger_percentage_by_time
    relied on this column, resulting in empty/zero data.

  Solution:
  - Rewrite functions to LEFT JOIN with the citations table instead
  - The citations table is reliably populated by collect_citations() during audit processing
  - Use a CTE with DISTINCT to pre-compute which responses have citations, then LEFT JOIN
  - This is ~40x faster than using correlated subqueries in FILTER clauses
*/

-- Fix get_web_search_count_by_time: use citations table for denominator
DROP FUNCTION IF EXISTS get_web_search_count_by_time(text);

CREATE OR REPLACE FUNCTION get_web_search_count_by_time(date_trunc_arg text)
RETURNS TABLE(time_period text, llm text, value numeric)
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
  WITH has_citations AS (
    SELECT DISTINCT c.audit_id, c.prompt_id, c.llm
    FROM citations c
  )
  SELECT
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    ROUND(
      COUNT(*) FILTER (
        WHERE lr.web_search_query IS NOT NULL
        AND lr.web_search_query != ''
      )::numeric
      / NULLIF(
        COUNT(*) FILTER (
          WHERE hc.audit_id IS NOT NULL
        )::numeric,
        0
      ),
      2
    ) as value
  FROM llm_responses lr
  LEFT JOIN has_citations hc
    ON hc.audit_id = lr.audit_id
    AND hc.prompt_id = lr.prompt_id
    AND hc.llm = lr.llm
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;

-- Fix get_web_search_trigger_percentage_by_time: use citations table
DROP FUNCTION IF EXISTS get_web_search_trigger_percentage_by_time(text);

CREATE OR REPLACE FUNCTION get_web_search_trigger_percentage_by_time(date_trunc_arg text)
RETURNS TABLE(time_period text, llm text, value numeric)
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
  WITH has_citations AS (
    SELECT DISTINCT c.audit_id, c.prompt_id, c.llm
    FROM citations c
  )
  SELECT
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    ROUND(
      (COUNT(*) FILTER (
        WHERE hc.audit_id IS NOT NULL
      )::numeric
       / NULLIF(COUNT(*)::numeric, 0)) * 100,
      2
    ) as value
  FROM llm_responses lr
  LEFT JOIN has_citations hc
    ON hc.audit_id = lr.audit_id
    AND hc.prompt_id = lr.prompt_id
    AND hc.llm = lr.llm
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;
