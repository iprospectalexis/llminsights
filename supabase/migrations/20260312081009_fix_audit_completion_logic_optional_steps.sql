/*
  # Fix Audit Completion Logic - Make Sentiment & Competitors Optional

  1. Problem
    - Audits get stuck in "running" state even when all LLM responses are received
    - Current logic requires sentiment_analyzed and competitors_found to be complete
    - These are optional post-processing steps that may not run

  2. Changes
    - Update is_audit_complete() to only check for responses received
    - Sentiment and competitor extraction are now optional
    - An audit is complete when all expected responses are received

  3. Completion Criteria (Updated)
    - responses_received >= expected_responses (total_prompts * llm_count)
    - OR: responses_sent >= expected_responses AND responses_received >= 95% of responses_sent
*/

-- Update the audit completion check to not require sentiment/competitors
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
    responses_received
  INTO v_metrics
  FROM audit_metrics_mv
  WHERE audit_id = p_audit_id;
  
  -- If no metrics found, audit is not complete
  IF v_metrics IS NULL THEN
    RETURN false;
  END IF;
  
  -- Get number of LLMs for this audit
  SELECT array_length(llms, 1) INTO v_llm_count
  FROM audits
  WHERE id = p_audit_id;
  
  -- Calculate expected responses
  v_expected_responses := v_metrics.total_prompts * COALESCE(v_llm_count, 0);
  
  -- An audit is complete if:
  -- 1. We have all expected responses, OR
  -- 2. We have sent all expected responses AND received at least 95% of them
  RETURN (
    v_metrics.responses_received >= v_expected_responses OR
    (v_metrics.responses_sent >= v_expected_responses AND 
     v_metrics.responses_received >= (v_expected_responses * 0.95))
  );
END;
$$;

-- Update the auto-completion function to also clear current_step
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
      current_step = CASE
        WHEN is_audit_complete(a.id) THEN NULL
        ELSE a.current_step
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
