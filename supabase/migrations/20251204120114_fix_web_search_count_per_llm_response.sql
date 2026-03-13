/*
  # Fix Web Search Count - Calculate per LLM Response with Citations
  
  1. Correction
    - Changed from counting unique prompts to counting individual llm_responses
    - Denominator now counts llm_responses that have citations (not prompts)
    - Each llm_response is treated independently
  
  2. Formula
    - Numerator: Count of llm_responses with web_search_query
    - Denominator: Count of llm_responses with citations (jsonb array length > 0)
    - Result: Average number of web searches per LLM response with citations
  
  3. Example
    - If 197 llm_responses have web_search_query
    - And 201 llm_responses have citations
    - Average = 197 / 201 = 0.98 web searches per response with citations
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
      COUNT(*) FILTER (
        WHERE lr.web_search_query IS NOT NULL 
        AND lr.web_search_query != ''
      )::numeric 
      / NULLIF(
        COUNT(*) FILTER (
          WHERE lr.citations IS NOT NULL 
          AND jsonb_array_length(lr.citations) > 0
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
