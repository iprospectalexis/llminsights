/*
  # Add Web Search Trigger Percentage Function
  
  1. New Function
    - `get_web_search_trigger_percentage_by_time` - Calculates the percentage of prompts that triggered web search
    - A prompt is considered to have triggered web search if it has citations (non-null, non-empty array)
    - Returns percentage by LLM and time period
  
  2. Security
    - Uses SECURITY DEFINER to allow authenticated users to see global metrics
    - Only returns aggregated data (percentages), no individual records
*/

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
  SELECT 
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    ROUND(
      (COUNT(*) FILTER (WHERE lr.citations IS NOT NULL 
                         AND lr.citations != 'null'::jsonb 
                         AND lr.citations != '[]'::jsonb
                         AND jsonb_array_length(lr.citations::jsonb) > 0)::numeric 
       / NULLIF(COUNT(*)::numeric, 0)) * 100, 
      2
    ) as value
  FROM llm_responses lr
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;
