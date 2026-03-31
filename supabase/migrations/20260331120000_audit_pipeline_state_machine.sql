/*
  Audit Pipeline State Machine

  Adds pipeline_state column (replaces current_step), worker locking,
  and granular progress counters to support a robust, server-side
  audit pipeline with single-owner processing.
*/

-- 1. Pipeline state (replaces current_step)
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pipeline_state text
  DEFAULT 'created'
  CHECK (pipeline_state IN (
    'created', 'fetching', 'polling',
    'extracting_competitors', 'analyzing_sentiment',
    'finalizing', 'completed', 'failed'
  ));

-- 2. Worker lock for single-owner processing
ALTER TABLE audits ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- 3. Granular progress counters
ALTER TABLE audits ADD COLUMN IF NOT EXISTS responses_expected int DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS responses_received int DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS competitors_processed int DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS competitors_total int DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS sentiment_processed int DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS sentiment_total int DEFAULT 0;

-- 4. Enhance audit_steps with progress tracking
ALTER TABLE audit_steps ADD COLUMN IF NOT EXISTS processed_count int DEFAULT 0;
ALTER TABLE audit_steps ADD COLUMN IF NOT EXISTS total_count int DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE audit_steps ADD COLUMN started_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE audit_steps ADD COLUMN finished_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 5. Backfill existing data
UPDATE audits SET pipeline_state = 'completed' WHERE status = 'completed' AND pipeline_state IS NULL;
UPDATE audits SET pipeline_state = 'failed' WHERE status IN ('failed', 'cancelled') AND pipeline_state IS NULL;
UPDATE audits SET pipeline_state = 'polling' WHERE status = 'running' AND pipeline_state IS NULL;

-- 6. Index for scheduler queries (only active audits)
CREATE INDEX IF NOT EXISTS idx_audits_pipeline_active
  ON audits(pipeline_state)
  WHERE pipeline_state NOT IN ('completed', 'failed');

-- 7. Drop old current_step constraint (deprecated, replaced by pipeline_state)
ALTER TABLE audits DROP CONSTRAINT IF EXISTS audits_current_step_check;

-- 8. Stale lock cleanup function
CREATE OR REPLACE FUNCTION release_stale_audit_locks()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  UPDATE audits SET locked_by = NULL, locked_at = NULL
  WHERE locked_by IS NOT NULL AND locked_at < NOW() - INTERVAL '5 minutes';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;
