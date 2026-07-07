-- Per-audit response stats for the Status page.
--
-- The audit row's responses_received counts rows that left the polling set for
-- ANY reason — including provider_no_response / dropped failures — so it
-- overstates what was actually collected. This returns, per audit, the total
-- responses and how many actually have an answer, so the UI can show
-- "collected" vs "no response".
--
-- SECURITY INVOKER (default): RLS on llm_responses applies, so a caller only
-- counts audits they can see (the Status page is admin/manager, who see all).

CREATE OR REPLACE FUNCTION audit_response_stats(p_audit_ids uuid[])
RETURNS TABLE(audit_id uuid, total bigint, answered bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT r.audit_id,
         count(*)::bigint AS total,
         count(*) FILTER (
           WHERE r.answer_text IS NOT NULL AND r.answer_text <> ''
         )::bigint AS answered
  FROM llm_responses r
  WHERE r.audit_id = ANY(p_audit_ids)
  GROUP BY r.audit_id;
$$;

GRANT EXECUTE ON FUNCTION audit_response_stats(uuid[]) TO authenticated;
