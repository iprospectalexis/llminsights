/*
  # Add all_sources column to llm_responses table

  1. Changes
    - Add `all_sources` column to `llm_responses` table to store all sources data from OneSearch API
    - Column type: jsonb to support flexible data structure
    - Column is nullable as it may not be available for all LLM providers
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'all_sources'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN all_sources jsonb;
  END IF;
END $$;
