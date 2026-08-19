-- Analysis-coverage transparency: a green "completed" audit could hide rows
-- whose competitor extraction failed (e.g. the gpt-5-nano "No output from
-- OpenAI" sentinels) — answers exist, but Brand Leadership silently
-- undercounts them and nothing in the UI says so.
--
-- New bucket per (audit, llm):
--   competitors_missing — answered rows whose answer_competitors is NULL
--                         (never extracted) or carries an 'error' key or
--                         lacks the 'brands' key. Prefilter skips
--                         ({"brands":[], "_skipped":true}) count as OK —
--                         "no brands in this answer" is a result.
--
-- Computed live from llm_responses, so repairs (re-extraction backfills)
-- clear the warning automatically. DROP + CREATE: return type changes.

DROP FUNCTION IF EXISTS audit_llm_response_stats(uuid[]);

CREATE FUNCTION audit_llm_response_stats(p_audit_ids uuid[])
RETURNS TABLE(
  audit_id uuid,
  llm text,
  total bigint,
  answered bigint,
  pending bigint,
  failed bigint,
  scraped_empty bigint,
  competitors_missing bigint,
  reasons jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT r.audit_id, r.llm,
           (r.answer_text IS NOT NULL AND r.answer_text <> '') AS has_answer,
           (r.raw_response_data IS NOT NULL
             OR r.organic_results IS NOT NULL
             OR r.citations IS NOT NULL
             OR r.all_sources IS NOT NULL) AS has_payload,
           (r.answer_competitors IS NOT NULL
             AND r.answer_competitors ? 'brands'
             AND NOT (r.answer_competitors ? 'error')) AS competitors_ok,
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
                            AND b.poll_terminal_reason IS NULL
                            AND NOT b.has_payload)::bigint                         AS pending,
         count(*) FILTER (WHERE NOT b.has_answer
                            AND b.poll_terminal_reason IS NOT NULL)::bigint        AS failed,
         count(*) FILTER (WHERE NOT b.has_answer
                            AND b.poll_terminal_reason IS NULL
                            AND b.has_payload)::bigint                             AS scraped_empty,
         count(*) FILTER (WHERE b.has_answer AND NOT b.competitors_ok)::bigint     AS competitors_missing,
         rc.reasons
  FROM base b
  LEFT JOIN reason_counts rc ON rc.audit_id = b.audit_id AND rc.llm = b.llm
  GROUP BY b.audit_id, b.llm, rc.reasons;
$$;

GRANT EXECUTE ON FUNCTION audit_llm_response_stats(uuid[]) TO authenticated;
