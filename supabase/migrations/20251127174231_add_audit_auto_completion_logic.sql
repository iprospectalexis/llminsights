/*
  # Add Auto-Completion Logic for Stuck Audits
  
  1. Purpose
    - Detect audits stuck in "running" state
    - Automatically mark as completed when all steps are done
    - Update progress percentage accurately
  
  2. Changes
    - Add function to check audit completion status
    - Add function to auto-complete stuck audits
    - Add last_activity_at timestamp to track progress
  
  3. Completion Criteria
    - responses_received == responses_sent (all responses collected)
    - competitors_found == responses_received (all competitors extracted)
    - sentiment_analyzed == responses_received (all sentiment analyzed)
    - Or: no activity for > 1 hour with partial completion
*/

-- Add last_activity_at column to audits table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audits' AND column_name = 'last_activity_at'
  ) THEN
    ALTER TABLE audits ADD COLUMN last_activity_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create function to check if audit is complete
CREATE OR REPLACE FUNCTION is_audit_complete(p_audit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metrics record;
  v_expected_responses integer;
  v_llm_count integer;
BEGIN
  -- Get metrics for the audit
  SELECT 
    total_prompts,
    responses_sent,
    responses_received,
    competitors_found,
    sentiment_analyzed
  INTO v_metrics
  FROM audit_metrics_mv
  WHERE audit_id = p_audit_id;
  
  -- Get number of LLMs for this audit
  SELECT array_length(llms, 1) INTO v_llm_count
  FROM audits
  WHERE id = p_audit_id;
  
  -- Calculate expected responses
  v_expected_responses := v_metrics.total_prompts * v_llm_count;
  
  -- Check if all steps are complete
  RETURN (
    v_metrics.responses_sent >= v_expected_responses AND
    v_metrics.responses_received >= v_metrics.responses_sent AND
    v_metrics.competitors_found >= v_metrics.responses_received AND
    v_metrics.sentiment_analyzed >= v_metrics.responses_received
  );
END;
$$;

-- Create function to calculate audit progress percentage
CREATE OR REPLACE FUNCTION calculate_audit_progress(p_audit_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metrics record;
  v_expected_responses integer;
  v_llm_count integer;
  v_total_steps integer;
  v_completed_steps numeric;
  v_progress integer;
BEGIN
  -- Get metrics for the audit
  SELECT 
    total_prompts,
    responses_sent,
    responses_received,
    competitors_found,
    sentiment_analyzed
  INTO v_metrics
  FROM audit_metrics_mv
  WHERE audit_id = p_audit_id;
  
  -- Get number of LLMs for this audit
  SELECT array_length(llms, 1) INTO v_llm_count
  FROM audits
  WHERE id = p_audit_id;
  
  -- Calculate expected responses
  v_expected_responses := v_metrics.total_prompts * v_llm_count;
  
  -- Total steps: send + receive + competitors + sentiment (4 steps per response)
  v_total_steps := v_expected_responses * 4;
  
  -- Completed steps
  v_completed_steps := (
    v_metrics.responses_sent +
    v_metrics.responses_received +
    v_metrics.competitors_found +
    v_metrics.sentiment_analyzed
  );
  
  -- Calculate percentage
  IF v_total_steps > 0 THEN
    v_progress := LEAST(100, ROUND((v_completed_steps / v_total_steps * 100)::numeric));
  ELSE
    v_progress := 0;
  END IF;
  
  RETURN v_progress;
END;
$$;

-- Create function to auto-complete audits
CREATE OR REPLACE FUNCTION auto_complete_audits()
RETURNS TABLE(audit_id uuid, previous_status text, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH audit_updates AS (
    UPDATE audits a
    SET 
      status = CASE
        WHEN is_audit_complete(a.id) THEN 'completed'
        WHEN a.last_activity_at < now() - interval '2 hours' AND a.status = 'running' THEN 'failed'
        ELSE a.status
      END,
      progress = calculate_audit_progress(a.id),
      finished_at = CASE
        WHEN is_audit_complete(a.id) AND a.finished_at IS NULL THEN now()
        ELSE a.finished_at
      END
    WHERE 
      a.status IN ('running', 'pending')
      AND (
        is_audit_complete(a.id)
        OR a.last_activity_at < now() - interval '2 hours'
      )
    RETURNING a.id, a.status as prev_status, 
      CASE
        WHEN is_audit_complete(a.id) THEN 'completed'
        ELSE 'failed'
      END as next_status
  )
  SELECT 
    au.id as audit_id,
    au.prev_status as previous_status,
    au.next_status as new_status
  FROM audit_updates au;
END;
$$;

-- Create trigger to update last_activity_at
CREATE OR REPLACE FUNCTION update_audit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE audits
  SET last_activity_at = now()
  WHERE id = NEW.audit_id;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS llm_responses_activity_update ON llm_responses;

-- Create trigger on llm_responses
CREATE TRIGGER llm_responses_activity_update
  AFTER INSERT OR UPDATE ON llm_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_audit_activity();

-- Update existing audits with last_activity_at based on most recent response
UPDATE audits a
SET last_activity_at = COALESCE(
  (
    SELECT MAX(lr.created_at)
    FROM llm_responses lr
    WHERE lr.audit_id = a.id
  ),
  a.started_at,
  a.created_at
)
WHERE last_activity_at IS NULL OR last_activity_at = created_at;

-- Run auto-completion once to fix existing stuck audits
SELECT * FROM auto_complete_audits();