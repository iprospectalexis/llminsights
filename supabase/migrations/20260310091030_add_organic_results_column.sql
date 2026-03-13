/*
  # Add organic_results column to llm_responses

  1. Changes
    - Add `organic_results` jsonb column to `llm_responses` table
    - This will store the organic search results from Google AI Overview responses
    
  2. Notes
    - The column is nullable since not all LLMs return organic results
    - Existing data will have NULL values by default
*/

-- Add organic_results column to llm_responses table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'organic_results'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN organic_results jsonb DEFAULT NULL;
  END IF;
END $$;
