/*
  # Fix Web Search Count - Filter by LLM
  
  1. Bug Fix
    - The EXISTS subquery in the denominator wasn't filtering by LLM
    - This caused prompts with citations in ONE LLM to be counted in ALL LLMs
    - Example: If a prompt had searches in Perplexity but not SearchGPT,
      it was incorrectly counted in SearchGPT's denominator
  
  2. Changes
    - Add `AND lr2.llm = lr.llm` to the EXISTS clause
    - Now only counts prompts that have citations for the specific LLM
  
  3. Impact
    - More accurate "fan-out" metric per LLM
    - Each LLM's average is calculated only from its own prompts with citations
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
            AND lr2.llm = lr.llm
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
