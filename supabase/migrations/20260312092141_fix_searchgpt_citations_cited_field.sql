/*
  # Fix SearchGPT Citations - Set Cited Field Based on links_attached

  1. Problem
    - Citations from SearchGPT's links_attached are stored with cited=NULL
    - Should be cited=true since links_attached represents actual citations shown in answer
    - Prompts page reads from llm_responses.links_attached (shows correct count)
    - Overview page reads from citations table (shows incorrect count due to cited=NULL)

  2. Changes
    - Update citations table to set cited=true for SearchGPT citations from links_attached
    - Identify these by checking if the citation URL exists in llm_responses.links_attached

  3. Impact
    - Fixes inconsistency between Prompts page and Overview page citation metrics
    - Only affects SearchGPT citations where cited=NULL
*/

-- Update SearchGPT citations to cited=true if they exist in links_attached
UPDATE citations c
SET cited = true
FROM llm_responses lr
WHERE c.audit_id = lr.audit_id
  AND c.prompt_id = lr.prompt_id
  AND c.llm = lr.llm
  AND c.llm = 'searchgpt'
  AND c.cited IS NULL
  AND lr.links_attached IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(lr.links_attached) AS link
    WHERE link->>'url' = c.page_url
  );

-- Log the update
DO $$
DECLARE
  v_updated_count integer;
BEGIN
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % SearchGPT citations to cited=true', v_updated_count;
END $$;
