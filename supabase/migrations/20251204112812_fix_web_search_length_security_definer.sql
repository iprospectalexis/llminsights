/*
  # Fix Web Search Length Function Security
  
  1. Changes
    - Updates `get_web_search_length_by_time` to use SECURITY DEFINER
    - Adds authentication check for consistency with other barometer functions
  
  2. Security
    - Uses SECURITY DEFINER to allow authenticated users to see global metrics
    - Only returns aggregated data (averages), no individual records
*/

-- Drop and recreate the function with SECURITY DEFINER
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
  SELECT 
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    ROUND(AVG(LENGTH(lr.web_search_query))::numeric, 2) as value
  FROM llm_responses lr
  WHERE lr.web_search_query IS NOT NULL
    AND lr.web_search_query != ''
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;
