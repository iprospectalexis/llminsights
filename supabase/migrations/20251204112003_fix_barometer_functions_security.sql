/*
  # Fix Barometer Functions Security
  
  1. Changes
    - Update functions to use SECURITY DEFINER instead of SECURITY INVOKER
    - This allows authenticated users to see aggregated global metrics
    - Safe because functions only return aggregated data, not individual records
  
  2. Security
    - Functions remain restricted to authenticated users only
    - Only aggregated metrics are exposed (counts and averages)
    - No sensitive individual data is revealed
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS get_web_search_count_by_time(text);
DROP FUNCTION IF EXISTS get_web_search_length_by_time(text);

-- Recreate with SECURITY DEFINER
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
  SELECT 
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    COUNT(*)::numeric as value
  FROM llm_responses lr
  WHERE lr.web_search_query IS NOT NULL
    AND lr.web_search_query != ''
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;

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
  SELECT 
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    AVG(LENGTH(lr.web_search_query))::numeric as value
  FROM llm_responses lr
  WHERE lr.web_search_query IS NOT NULL
    AND lr.web_search_query != ''
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;
