/*
  # Update auto_complete_audits to clear current_step

  ## Overview
  This migration updates the auto_complete_audits function to clear the current_step
  field when marking audits as completed or failed.

  ## Changes
  1. Update auto_complete_audits function to set current_step to null for completed/failed audits
*/

-- Update function to auto-complete audits with current_step clearing
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
        WHEN is_audit_complete(a.id) OR (a.last_activity_at < now() - interval '2 hours' AND a.status = 'running') THEN NULL
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