-- Per-audit, per-LLM collection stats for the Status page.
--
-- Complements audit_response_stats (totals only) with an LLM breakdown so the
-- UI can show, for each audit, which LLMs collected fully, which came back
-- partial/empty, and WHY (poll_terminal_reason counts):
--   total    — rows for this audit×llm
--   answered — rows with a non-empty answer_text
--   pending  — no answer yet and not terminal (still collecting)
--   failed   — no answer and terminal (provider_no_response, dropped, …)
--   reasons  — jsonb {reason: count} over the failed rows
--
-- SECURITY INVOKER (default): RLS on llm_responses applies to the caller.

CREATE OR REPLACE FUNCTION audit_llm_response_stats(p_audit_ids uuid[])
RETURNS TABLE(
  audit_id uuid,
  llm text,
  total bigint,
  answered bigint,
  pending bigint,
  failed bigint,
  reasons jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT r.audit_id, r.llm,
           (r.answer_text IS NOT NULL AND r.answer_text <> '') AS has_answer,
           r.poll_terminal_reason
    FROM llm_responses r
    WHERE r.audit_id = ANY(p_audit_ids)
  ),
  reason_counts AS (
    SELECT rc.audit_id, rc.llm, jsonb_object_agg(rc.poll_terminal_reason, rc.n) AS reasons
    FROM (
      SELECT b.audit_id, b.llm, b.poll_terminal_reason, count(*) AS n
      FROM base b
      WHERE NOT b.has_answer AND b.poll_terminal_reason IS NOT NULL
      GROUP BY b.audit_id, b.llm, b.poll_terminal_reason
    ) rc
    GROUP BY rc.audit_id, rc.llm
  )
  SELECT b.audit_id, b.llm,
         count(*)::bigint                                                          AS total,
         count(*) FILTER (WHERE b.has_answer)::bigint                              AS answered,
         count(*) FILTER (WHERE NOT b.has_answer
                            AND b.poll_terminal_reason IS NULL)::bigint            AS pending,
         count(*) FILTER (WHERE NOT b.has_answer
                            AND b.poll_terminal_reason IS NOT NULL)::bigint        AS failed,
         rc.reasons
  FROM base b
  LEFT JOIN reason_counts rc ON rc.audit_id = b.audit_id AND rc.llm = b.llm
  GROUP BY b.audit_id, b.llm, rc.reasons;
$$;

GRANT EXECUTE ON FUNCTION audit_llm_response_stats(uuid[]) TO authenticated;
