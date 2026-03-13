/*
  # Add current_step to audits table

  ## Overview
  This migration adds a current_step field to the audits table to provide more detailed
  status information during audit execution. This allows the UI to show specific steps
  like "Getting results", "Processing results", "Sentiment Analysis" instead of just "Running".

  ## Changes
  1. Add current_step column to audits table
     - Possible values: 'getting_results', 'processing_results', 'sentiment_analysis', null
     - Default: null (for completed or not-started audits)

  2. Security
     - No RLS changes needed (inherits from audits table)
*/

-- Add current_step column to audits table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audits' AND column_name = 'current_step'
  ) THEN
    ALTER TABLE audits
    ADD COLUMN current_step text CHECK (
      current_step IN ('getting_results', 'processing_results', 'sentiment_analysis')
    );

    -- Add comment for documentation
    COMMENT ON COLUMN audits.current_step IS 'Current step of a running audit: getting_results, processing_results, or sentiment_analysis';
  END IF;
END $$;