/*
  # Add Web Search Word Count Function
  
  1. New Function
    - `get_web_search_word_count_by_time` - Calculates the average word count of web search queries
    - Counts words by splitting on whitespace and filtering empty strings
    - Returns average word count by LLM and time period
  
  2. Security
    - Uses SECURITY DEFINER to allow authenticated users to see global metrics
    - Only returns aggregated data (averages), no individual records
*/

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
  SELECT 
    to_char(date_trunc(date_trunc_arg, lr.created_at), 'YYYY-MM-DD') as time_period,
    lr.llm,
    ROUND(
      AVG(
        array_length(
          regexp_split_to_array(
            TRIM(lr.web_search_query), 
            E'\\s+'
          ), 
          1
        )
      )::numeric, 
      2
    ) as value
  FROM llm_responses lr
  WHERE lr.web_search_query IS NOT NULL
    AND lr.web_search_query != ''
    AND TRIM(lr.web_search_query) != ''
  GROUP BY date_trunc(date_trunc_arg, lr.created_at), lr.llm
  ORDER BY date_trunc(date_trunc_arg, lr.created_at), lr.llm;
END;
$$;