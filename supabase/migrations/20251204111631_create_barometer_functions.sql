/*
  # Create Barometer Database Functions
  
  1. Functions Created
    - `get_web_search_count_by_time` - Returns count of web search queries per LLM by time period
    - `get_web_search_length_by_time` - Returns average length of web search queries per LLM by time period
  
  2. Purpose
    - Support Barometers page with time-series data aggregation
    - Aggregate data by day, week, or month
    - Group by LLM for comparative analysis
  
  3. Security
    - Functions use SECURITY INVOKER (respects RLS)
    - Only authenticated users can access
*/

-- Function to get count of web search queries by time period and LLM
CREATE OR REPLACE FUNCTION get_web_search_count_by_time(date_trunc_arg text)
RETURNS TABLE(time_period text, llm text, value numeric)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
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

-- Function to get average length of web search queries by time period and LLM
CREATE OR REPLACE FUNCTION get_web_search_length_by_time(date_trunc_arg text)
RETURNS TABLE(time_period text, llm text, value numeric)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
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
