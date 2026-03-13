/*
  # Fix Web Search Queries Array Handling
  
  1. Problem
    - Web search queries are stored as JSON arrays: ["query1", "query2", "query3"]
    - Current functions treat the entire array as a single query
    - This causes incorrect metrics for count, length, and word count
  
  2. Solution
    - Update all three functions to properly handle JSON arrays
    - When web_search_query is an array, expand each element
    - Calculate metrics based on individual queries, not the JSON string
  
  3. Functions Updated
    - get_web_search_count_by_time: Count each query in the array separately
    - get_web_search_length_by_time: Calculate length for each query in the array
    - get_web_search_word_count_by_time: Count words for each query in the array
*/

-- Fix get_web_search_count_by_time to handle JSON arrays
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
  WITH expanded_queries AS (
    SELECT 
      lr.created_at,
      lr.llm,
      lr.citations,
      CASE 
        -- If web_search_query is a valid JSON array, count array elements
        WHEN lr.web_search_query ~ '^\[.*\]$' 
          AND lr.web_search_query::jsonb IS NOT NULL 
        THEN jsonb_array_length(lr.web_search_query::jsonb)
        -- Otherwise, treat as single query
        WHEN lr.web_search_query IS NOT NULL AND lr.web_search_query != ''
        THEN 1
        -- NULL or empty
        ELSE 0
      END as query_count
    FROM llm_responses lr
    WHERE lr.web_search_query IS NOT NULL 
      AND lr.web_search_query != ''
  )
  SELECT 
    to_char(date_trunc(date_trunc_arg, eq.created_at), 'YYYY-MM-DD') as time_period,
    eq.llm,
    ROUND(
      SUM(eq.query_count)::numeric 
      / NULLIF(
        COUNT(*) FILTER (
          WHERE eq.citations IS NOT NULL 
          AND jsonb_array_length(eq.citations) > 0
        )::numeric, 
        0
      ),
      2
    ) as value
  FROM expanded_queries eq
  GROUP BY date_trunc(date_trunc_arg, eq.created_at), eq.llm
  ORDER BY date_trunc(date_trunc_arg, eq.created_at), eq.llm;
END;
$$;

-- Fix get_web_search_length_by_time to handle JSON arrays
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
      CASE 
        -- If web_search_query is a valid JSON array, expand to individual queries
        WHEN lr.web_search_query ~ '^\[.*\]$' 
          AND lr.web_search_query::jsonb IS NOT NULL 
        THEN jsonb_array_elements_text(lr.web_search_query::jsonb)
        -- Otherwise, treat as single query
        ELSE lr.web_search_query
      END as individual_query
    FROM llm_responses lr
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

-- Fix get_web_search_word_count_by_time to handle JSON arrays
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
      CASE 
        -- If web_search_query is a valid JSON array, expand to individual queries
        WHEN lr.web_search_query ~ '^\[.*\]$' 
          AND lr.web_search_query::jsonb IS NOT NULL 
        THEN jsonb_array_elements_text(lr.web_search_query::jsonb)
        -- Otherwise, treat as single query
        ELSE lr.web_search_query
      END as individual_query
    FROM llm_responses lr
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