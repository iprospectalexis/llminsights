/*
  # Fix Web Search Count - Only Prompts with Citations
  
  1. Changes
    - Updates `get_web_search_count_by_time` to count only prompts that have citations
    - Old logic: average across ALL prompts (including those without web searches)
    - New logic: average across only prompts that have at least one citation
  
  2. Purpose
    - Show the "fan-out" specifically for prompts that triggered web search
    - Provides more accurate insight into web search behavior when it occurs
    - Excludes prompts that didn't use web search from the calculation
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
      / NULLIF(
        COUNT(DISTINCT lr.prompt_id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM llm_responses lr2
            WHERE lr2.prompt_id = lr.prompt_id
            AND lr2.web_search_query IS NOT NULL 
            AND lr2.web_search_query != ''
          )
        )::numeric, 
        0
      ),
      2
    ) as value
  FROM llm_responses lr
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;
