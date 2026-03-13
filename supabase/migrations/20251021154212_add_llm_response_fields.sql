/*
  # Add additional fields to llm_responses table

  1. Changes
    - Add `web_search_query` (text) - Search query used by the LLM
    - Add `citations` (jsonb) - Citations array from the LLM response
    - Add `links_attached` (jsonb) - Links attached to the response
    - Add `search_sources` (jsonb) - Search sources used
    - Add `is_map` (boolean) - Whether the response includes a map
    - Add `shopping` (jsonb) - Shopping-related data from response
    - Add `shopping_visible` (boolean) - Whether shopping results are visible

  2. Notes
    - These fields extract important data from raw_response_data for easier querying
    - All fields are nullable as not all LLMs provide all fields
*/

-- Add new columns to llm_responses table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'web_search_query'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN web_search_query text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'citations'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN citations jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'links_attached'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN links_attached jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'search_sources'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN search_sources jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'is_map'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN is_map boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'shopping'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN shopping jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_responses' AND column_name = 'shopping_visible'
  ) THEN
    ALTER TABLE llm_responses ADD COLUMN shopping_visible boolean DEFAULT false;
  END IF;
END $$;
