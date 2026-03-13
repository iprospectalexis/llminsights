/*
  # Fix Recovery Function Logging
  
  ## Problem
  Logging inside recover_stuck_audits() causes recursive call
  
  ## Solution
  Remove the recursive INSERT call and simplify logging
*/

-- Recreate function without recursive call
CREATE OR REPLACE FUNCTION recover_stuck_audits()
RETURNS TABLE(
  audit_id uuid,
  project_name text,
  stuck_duration_minutes integer,
  expected_responses bigint,
  received_responses bigint,
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
  ),
  logged_updates AS (
    INSERT INTO audit_completion_logs (audit_id, event_type, details)
    SELECT 
      au.id,
      'recovered',
      jsonb_build_object(
        'project_name', au.project_name,
        'stuck_duration_minutes', au.stuck_minutes,
        'expected_responses', au.expected_count,
        'received_responses', au.response_count
      )
    FROM audit_updates au
    RETURNING audit_id
  )
  SELECT 
    au.id as audit_id,
    au.project_name,
    au.stuck_minutes as stuck_duration_minutes,
    au.expected_count as expected_responses,
    au.response_count as received_responses,
    'recovered' as action_taken
  FROM audit_updates au;
  
  GET DIAGNOSTICS v_recovered_count = ROW_COUNT;
  
  -- Log recovery attempt
  IF v_recovered_count = 0 THEN
    RAISE NOTICE 'Recovery job completed: 0 audits recovered';
  ELSE
    RAISE NOTICE 'Recovery job completed: % audits recovered', v_recovered_count;
  END IF;
END;
$$;
