/*
  # Add OneSearch SERP API Support

  ## Purpose
  Add support for OneSearch SERP API as an alternative data provider to BrightData.

  ## Changes

  ### 1. llm_responses table
    - Add `job_id` column for OneSearch job tracking
    - Add `data_provider` column to identify which provider was used (BrightData/OneSearch)
    - Add index on job_id for faster lookups

  ### 2. Audits table
    - Add `data_provider` column to track which provider was used for the audit

  ## Migration Notes
    - `snapshot_id` remains for BrightData backward compatibility
    - `job_id` is used for OneSearch API
    - `data_provider` defaults to 'BrightData' for existing records
*/

-- Add data_provider column to llm_responses
ALTER TABLE llm_responses
  ADD COLUMN IF NOT EXISTS data_provider text DEFAULT 'BrightData';

-- Add job_id column for OneSearch API
ALTER TABLE llm_responses
  ADD COLUMN IF NOT EXISTS job_id text;

-- Add index on job_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_llm_responses_job_id ON llm_responses (job_id);

-- Add constraint to ensure valid data providers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_data_provider'
    AND conrelid = 'llm_responses'::regclass
  ) THEN
    ALTER TABLE llm_responses
      ADD CONSTRAINT valid_data_provider
      CHECK (data_provider IN ('BrightData', 'OneSearch SERP API'));
  END IF;
END $$;

-- Add data_provider column to audits table
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS data_provider text DEFAULT 'BrightData';

-- Add constraint to ensure valid data providers in audits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_audit_data_provider'
    AND conrelid = 'audits'::regclass
  ) THEN
    ALTER TABLE audits
      ADD CONSTRAINT valid_audit_data_provider
      CHECK (data_provider IN ('BrightData', 'OneSearch SERP API'));
  END IF;
END $$;

-- Update existing records to have BrightData as default (already set by DEFAULT, but explicit for clarity)
UPDATE llm_responses
SET data_provider = 'BrightData'
WHERE data_provider IS NULL;

UPDATE audits
SET data_provider = 'BrightData'
WHERE data_provider IS NULL;
