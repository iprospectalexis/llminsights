/*
  # Fix Audit Completion - Add Fallback & Recovery Mechanism
  
  ## Problem
  Audits get stuck in "running" status even when all LLM responses are received because:
  - audit_metrics_mv can be empty or outdated for new audits
  - Materialized view refresh is async and may timeout under load
  - is_audit_complete() returns false when MV has no data
  
  ## Solution
  1. Add fallback logic to is_audit_complete() - count directly from llm_responses if MV is empty
  2. Create recovery job to unstick audits with complete data
  3. Add logging for debugging
  
  ## Changes
  - Update is_audit_complete() with direct count fallback
  - Create recover_stuck_audits() function
  - Add cron job to run recovery every minute
  - Add audit_completion_logs table for debugging
*/

-- Create logging table for audit completion events
CREATE TABLE IF NOT EXISTS audit_completion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL,
  event_type text NOT NULL, -- 'completion_check', 'fallback_used', 'recovered', 'failed'
  details jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_completion_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage logs
CREATE POLICY "Service role can manage audit completion logs"
  ON audit_completion_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Improved is_audit_complete with fallback logic
CREATE OR REPLACE FUNCTION is_audit_complete(p_audit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metrics record;
  v_expected_responses integer;
  v_received_responses integer;
  v_llm_count integer;
  v_total_prompts integer;
  v_use_fallback boolean := false;
BEGIN
  -- Get number of LLMs for this audit
  SELECT array_length(llms, 1) INTO v_llm_count
  FROM audits
  WHERE id = p_audit_id;
  
  -- Try to get metrics from materialized view (fast path)
  SELECT 
    total_prompts,
    responses_sent,
    responses_received
  INTO v_metrics
  FROM audit_metrics_mv
  WHERE audit_id = p_audit_id;
  
  -- If MV has no data, use fallback (direct count)
  IF v_metrics IS NULL OR v_metrics.total_prompts IS NULL THEN
    v_use_fallback := true;
    
    -- Count prompts for this project
    SELECT COUNT(*) INTO v_total_prompts
    FROM prompts p
    JOIN audits a ON p.project_id = a.project_id
    WHERE a.id = p_audit_id;
    
    -- Count received responses
    SELECT COUNT(*) INTO v_received_responses
    FROM llm_responses
    WHERE audit_id = p_audit_id;
    
    v_expected_responses := v_total_prompts * COALESCE(v_llm_count, 0);
    
    -- Log fallback usage
    INSERT INTO audit_completion_logs (audit_id, event_type, details)
    VALUES (
      p_audit_id, 
      'fallback_used',
      jsonb_build_object(
        'total_prompts', v_total_prompts,
        'expected_responses', v_expected_responses,
        'received_responses', v_received_responses,
        'llm_count', v_llm_count
      )
    );
    
    -- Return completion status
    RETURN v_received_responses >= v_expected_responses;
  END IF;
  
  -- Use MV data (normal path)
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

-- Function to recover stuck audits
CREATE OR REPLACE FUNCTION recover_stuck_audits()
RETURNS TABLE(
  audit_id uuid,
  project_name text,
  stuck_duration_minutes integer,
  expected_responses integer,
  received_responses integer,
  action_taken text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recovered_count integer := 0;
BEGIN
  RETURN QUERY
  WITH stuck_audits AS (
    SELECT 
      a.id,
      p.name as project_name,
      EXTRACT(EPOCH FROM (NOW() - a.created_at))/60 as stuck_minutes,
      a.llms,
      (SELECT COUNT(*) FROM prompts pr WHERE pr.project_id = a.project_id) as prompt_count,
      (SELECT COUNT(*) FROM llm_responses lr WHERE lr.audit_id = a.id) as response_count
    FROM audits a
    JOIN projects p ON a.project_id = p.id
    WHERE a.status = 'running'
      AND a.created_at < NOW() - INTERVAL '10 minutes' -- Stuck for more than 10 minutes
      AND a.last_activity_at > NOW() - INTERVAL '2 hours' -- But not completely dead
  ),
  recoverable_audits AS (
    SELECT 
      sa.*,
      (sa.prompt_count * array_length(sa.llms, 1)) as expected_count
    FROM stuck_audits sa
    WHERE sa.response_count >= (sa.prompt_count * array_length(sa.llms, 1)) -- All responses received
  ),
  audit_updates AS (
    UPDATE audits a
    SET 
      status = 'completed',
      current_step = NULL,
      finished_at = COALESCE(a.finished_at, NOW()),
      progress = 100
    FROM recoverable_audits ra
    WHERE a.id = ra.id
    RETURNING a.id, ra.project_name, ra.stuck_minutes::integer, ra.expected_count, ra.response_count
  )
  SELECT 
    au.id as audit_id,
    au.project_name,
    au.stuck_minutes as stuck_duration_minutes,
    au.expected_count as expected_responses,
    au.response_count as received_responses,
    'recovered' as action_taken
  FROM audit_updates au;
  
  -- Log recovered audits
  INSERT INTO audit_completion_logs (audit_id, event_type, details)
  SELECT 
    audit_id,
    'recovered',
    jsonb_build_object(
      'project_name', project_name,
      'stuck_duration_minutes', stuck_duration_minutes,
      'expected_responses', expected_responses,
      'received_responses', received_responses
    )
  FROM recover_stuck_audits();
  
  GET DIAGNOSTICS v_recovered_count = ROW_COUNT;
  
  -- Log recovery attempt
  IF v_recovered_count = 0 THEN
    RAISE NOTICE 'Recovery job completed: 0 audits recovered';
  ELSE
    RAISE NOTICE 'Recovery job completed: % audits recovered', v_recovered_count;
  END IF;
END;
$$;

-- Create cron job for audit recovery (runs every minute)
SELECT cron.schedule(
  'recover-stuck-audits-job',
  '* * * * *', -- Every minute
  $$
  SELECT recover_stuck_audits();
  $$
);

-- Update existing auto-completion function to add logging
CREATE OR REPLACE FUNCTION auto_complete_audits()
RETURNS TABLE(audit_id uuid, previous_status text, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_completed_count integer := 0;
  v_failed_count integer := 0;
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
  
  -- Count results
  SELECT COUNT(*) INTO v_completed_count
  FROM auto_complete_audits() WHERE new_status = 'completed';
  
  SELECT COUNT(*) INTO v_failed_count  
  FROM auto_complete_audits() WHERE new_status = 'failed';
  
  -- Log execution
  IF v_completed_count > 0 OR v_failed_count > 0 THEN
    RAISE NOTICE 'Auto-completion: % completed, % failed', v_completed_count, v_failed_count;
  END IF;
END;
$$;

-- Grant necessary permissions
GRANT SELECT ON audit_completion_logs TO authenticated;
GRANT ALL ON audit_completion_logs TO service_role;
