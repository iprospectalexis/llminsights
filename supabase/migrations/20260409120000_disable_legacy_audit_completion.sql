-- Neutralise legacy SQL force-complete functions.
--
-- Background: investigation of the Test_Maeva audit bug
-- (project 624ccdcf-f9a8-4cea-884a-1bb38d4d987d, audit c909051d) showed
-- that ~dozen recent audits have `status='completed'`, `progress=100`,
-- `finished_at=NOW()` but `pipeline_state='created'` (or 'polling') and
-- `responses_received=0`. This is a hard desync: the new Python
-- state-machine pipeline never flipped `pipeline_state` to 'completed',
-- yet something outside the pipeline force-marked the audit done.
--
-- Six such audits all flipped within a 1-minute window at 2026-04-09
-- 17:01 UTC with zero entries in `audit_completion_logs`. That rules
-- out every SQL function that logs its work. The remaining suspects:
--
--   * legacy Supabase Edge Function `auto-complete-stuck-audits`
--     (still deployed) calling `auto_complete_audits()` via RPC;
--   * the old host-level backend on :8000 calling the same RPC directly;
--   * any other out-of-repo ad-hoc caller.
--
-- Rather than hunt the caller, we neutralise the callees. The new
-- Python pipeline (audit_pipeline.handle_finalize) is the *only*
-- sanctioned path to `status='completed'` and it writes
-- `pipeline_state='completed'` atomically. Every SQL function below is
-- legacy and must never touch the audits table again.
--
-- Each function is rewritten to a no-op that returns an empty result
-- set so any lingering caller sees "nothing to do" and exits cleanly.
-- A RAISE NOTICE is emitted so accidental callers are visible in logs.

-- ── auto_complete_audits ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_complete_audits()
RETURNS TABLE(audit_id uuid, previous_status text, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RAISE NOTICE 'auto_complete_audits() is disabled (legacy). The Python pipeline handles completion.';
  RETURN;
END;
$function$;

-- ── complete_stuck_audits ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_stuck_audits()
RETURNS TABLE(audit_id uuid, responses_marked_failed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RAISE NOTICE 'complete_stuck_audits() is disabled (legacy). The Python pipeline handles completion.';
  RETURN;
END;
$function$;

-- ── force_complete_stuck_audits ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.force_complete_stuck_audits()
RETURNS TABLE(
  recovered_audit_id uuid,
  project_name text,
  stuck_duration_minutes numeric,
  responses_total integer,
  responses_with_text integer,
  responses_with_competitors integer,
  action_taken text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RAISE NOTICE 'force_complete_stuck_audits() is disabled (legacy). The Python pipeline handles completion.';
  RETURN;
END;
$function$;

-- ── recover_stuck_audits ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recover_stuck_audits()
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
AS $function$
BEGIN
  RAISE NOTICE 'recover_stuck_audits() is disabled (legacy). The Python pipeline handles completion.';
  RETURN;
END;
$function$;

-- ── is_audit_complete ──────────────────────────────────────────────
-- Keep it readable but make its answer conservative: an audit is
-- "complete" only if Python pipeline set pipeline_state='completed'.
-- Any legacy caller that was doing `if is_audit_complete(id) then mark
-- completed` will now correctly see `false` for every in-flight audit.
CREATE OR REPLACE FUNCTION public.is_audit_complete(p_audit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_state text;
BEGIN
  SELECT pipeline_state INTO v_state FROM audits WHERE id = p_audit_id;
  RETURN v_state = 'completed';
END;
$function$;
