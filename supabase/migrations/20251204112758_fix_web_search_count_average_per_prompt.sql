/*
  # Fix Web Search Count Function - Average Per Prompt
  
  1. Changes
    - Updates `get_web_search_count_by_time` to calculate average number of web searches per prompt
    - Old logic: counted total web search queries
    - New logic: (count of web searches) / (count of unique prompts) for each LLM and time period
  
  2. Purpose
    - Show average "fan-out" - how many web searches occur per prompt on average
    - Provides insight into how frequently each LLM uses web search per prompt
*/

-- Drop and recreate the function with corrected logic
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
  SELECT 
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    ROUND(
      COUNT(*) FILTER (WHERE lr.web_search_query IS NOT NULL AND lr.web_search_query != '')::numeric 
      / NULLIF(COUNT(DISTINCT lr.prompt_id)::numeric, 0),
      2
    ) as value
  FROM llm_responses lr
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;
