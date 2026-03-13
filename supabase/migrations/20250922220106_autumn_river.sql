/*
  # Add answer_competitors column to llm_responses table

  1. New Column
    - `answer_competitors` (jsonb, nullable)
      - Stores extracted competitor data from LLM responses
      - Separate from raw_response_data for better data organization

  2. Changes
    - Add new jsonb column to store competitor extraction results
    - This will replace storing competitors in raw_response_data
*/

ALTER TABLE llm_responses 
ADD COLUMN IF NOT EXISTS answer_competitors jsonb;

-- Add index for better query performance on competitor data
CREATE INDEX IF NOT EXISTS idx_llm_responses_answer_competitors 
ON llm_responses USING gin (answer_competitors);

-- Add comment to document the column purpose
COMMENT ON COLUMN llm_responses.answer_competitors IS 'Extracted competitor data from LLM response content';