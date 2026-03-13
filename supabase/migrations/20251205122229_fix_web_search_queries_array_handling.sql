/*
  # Fix Web Search Queries Array Handling - Part 2
  
  1. Problem
    - Previous migration used set-returning function inside CASE which doesn't work properly
    - Need to use LATERAL JOIN or UNION to properly expand JSON arrays
  
  2. Solution
    - Use CROSS JOIN LATERAL to expand JSON arrays
    - This properly handles both JSON arrays and plain strings
  
  3. Functions Updated
    - get_web_search_length_by_time: Use LATERAL JOIN for array expansion
    - get_web_search_word_count_by_time: Use LATERAL JOIN for array expansion
*/

-- Fix get_web_search_length_by_time with proper LATERAL JOIN
DROP FUNCTION IF EXISTS get_web_search_length_by_time(text);

CREATE OR REPLACE FUNCTION get_web_search_length_by_time(date_trunc_arg text)
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
  WITH expanded_queries AS (
    SELECT 
      lr.created_at,
      lr.llm,
      query_element as individual_query
    FROM llm_responses lr
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(lr.web_search_query::jsonb) as query_element
      WHERE lr.web_search_query ~ '^\[.*\]$'
      UNION ALL
      SELECT lr.web_search_query as query_element
      WHERE NOT (lr.web_search_query ~ '^\[.*\]$')
    ) queries
    WHERE lr.web_search_query IS NOT NULL
      AND lr.web_search_query != ''
  )
  SELECT 
    to_char(date_trunc(date_trunc_arg, eq.created_at), 'YYYY-MM-DD') as time_period,
    eq.llm,
    ROUND(AVG(LENGTH(eq.individual_query))::numeric, 2) as value
  FROM expanded_queries eq
  WHERE eq.individual_query IS NOT NULL
    AND eq.individual_query != ''
  GROUP BY date_trunc(date_trunc_arg, eq.created_at), eq.llm
  ORDER BY date_trunc(date_trunc_arg, eq.created_at), eq.llm;
END;
$$;

-- Fix get_web_search_word_count_by_time with proper LATERAL JOIN
DROP FUNCTION IF EXISTS get_web_search_word_count_by_time(text);

CREATE OR REPLACE FUNCTION get_web_search_word_count_by_time(date_trunc_arg text)
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
  WITH expanded_queries AS (
    SELECT 
      lr.created_at,
      lr.llm,
      query_element as individual_query
    FROM llm_responses lr
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(lr.web_search_query::jsonb) as query_element
      WHERE lr.web_search_query ~ '^\[.*\]$'
      UNION ALL
      SELECT lr.web_search_query as query_element
      WHERE NOT (lr.web_search_query ~ '^\[.*\]$')
    ) queries
    WHERE lr.web_search_query IS NOT NULL
      AND lr.web_search_query != ''
  )
  SELECT 
    to_char(date_trunc(date_trunc_arg, eq.created_at), 'YYYY-MM-DD') as time_period,
    eq.llm,
    ROUND(
      AVG(
        array_length(
          regexp_split_to_array(
            TRIM(eq.individual_query), 
            E'\\s+'
          ), 
          1
        )
      )::numeric, 
      2
    ) as value
  FROM expanded_queries eq
  WHERE eq.individual_query IS NOT NULL
    AND eq.individual_query != ''
    AND TRIM(eq.individual_query) != ''
  GROUP BY date_trunc(date_trunc_arg, eq.created_at), eq.llm
  ORDER BY date_trunc(date_trunc_arg, eq.created_at), eq.llm;
END;
$$;