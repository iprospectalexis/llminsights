/*
  # Update LLM Responses Check Constraint
  
  1. Changes
    - Drop the old check constraint that only allowed 3 LLMs
    - Add new check constraint that includes all 7 supported LLMs:
      - searchgpt
      - perplexity
      - gemini
      - google-ai-overview
      - google-ai-mode
      - grok
      - bing-copilot
  
  2. Security
    - No changes to RLS policies
*/

-- Drop the old constraint
ALTER TABLE llm_responses DROP CONSTRAINT IF EXISTS llm_responses_llm_check;

-- Add new constraint with all supported LLMs
ALTER TABLE llm_responses 
ADD CONSTRAINT llm_responses_llm_check 
CHECK (llm = ANY (ARRAY[
  'searchgpt'::text,
  'perplexity'::text,
  'gemini'::text,
  'google-ai-overview'::text,
  'google-ai-mode'::text,
  'grok'::text,
  'bing-copilot'::text
]));
