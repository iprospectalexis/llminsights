/*
  # Fix Type Mismatch in monitor_audit_health()
  
  ## Problem
  COUNT() returns bigint but function expects integer for expected_responses
  
  ## Solution
  Change expected_responses type to bigint
*/

-- Recreate with correct types
DROP FUNCTION IF EXISTS monitor_audit_health();

CREATE OR REPLACE FUNCTION monitor_audit_health()
RETURNS TABLE(
  audit_id uuid,
  project_name text,
  status text,
  current_step text,
  progress integer,
  created_at timestamptz,
  duration_minutes integer,
  expected_responses bigint,
  received_responses bigint,
  completion_percentage numeric,
  is_stuck boolean,
  fallback_used_count bigint,
  health_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH audit_data AS (
    SELECT 
      a.id,
      p.name as project_name,
      a.status,
      a.current_step,
      a.progress,
      a.created_at,
      EXTRACT(EPOCH FROM (NOW() - a.created_at))/60 as duration_mins,
      a.llms,
      (SELECT COUNT(*) FROM prompts pr WHERE pr.project_id = a.project_id) as prompt_count,
      (SELECT COUNT(*) FROM llm_responses lr WHERE lr.audit_id = a.id) as response_count
    FROM audits a
    JOIN projects p ON a.project_id = p.id
    WHERE a.status IN ('running', 'pending', 'completed', 'failed')
      AND a.created_at > NOW() - INTERVAL '24 hours' -- Last 24 hours only
  ),
  audit_metrics AS (
    SELECT 
      ad.*,
      (ad.prompt_count * array_length(ad.llms, 1)) as expected_count,
      CASE 
        WHEN ad.prompt_count > 0 THEN 
          ROUND((ad.response_count::numeric / (ad.prompt_count * array_length(ad.llms, 1))::numeric * 100), 2)
        ELSE 0
      END as completion_pct,
      -- Check if stuck (running > 10 mins with all data received)
      CASE 
        WHEN ad.status = 'running' 
          AND ad.duration_mins > 10 
          AND ad.response_count >= (ad.prompt_count * array_length(ad.llms, 1))
        THEN true
        ELSE false
      END as is_stuck_audit,
      -- Count fallback usage
      (SELECT COUNT(*) FROM audit_completion_logs acl 
       WHERE acl.audit_id = ad.id AND acl.event_type = 'fallback_used') as fallback_count
    FROM audit_data ad
  )
  SELECT 
    am.id as audit_id,
    am.project_name,
    am.status,
    am.current_step,
    am.progress,
    am.created_at,
    am.duration_mins::integer as duration_minutes,
    am.expected_count as expected_responses,
    am.response_count as received_responses,
    am.completion_pct as completion_percentage,
    am.is_stuck_audit as is_stuck,
    am.fallback_count as fallback_used_count,
    CASE
      WHEN am.status = 'completed' THEN 'healthy'
      WHEN am.status = 'failed' THEN 'failed'
      WHEN am.is_stuck_audit THEN 'stuck'
      WHEN am.status = 'running' AND am.duration_mins > 60 THEN 'slow'
      WHEN am.status = 'running' AND am.completion_pct > 90 THEN 'completing'
      WHEN am.status = 'running' THEN 'running'
      ELSE 'pending'
    END as health_status
  FROM audit_metrics am
  ORDER BY am.created_at DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION monitor_audit_health() TO authenticated;
GRANT EXECUTE ON FUNCTION monitor_audit_health() TO service_role;
