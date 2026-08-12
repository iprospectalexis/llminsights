-- Split "scraped fine, but the SERP has no AI answer" out of "no response".
--
-- Google AI Overview doesn't exist for every query. For those queries the
-- scrape succeeds (raw payload + organic results are stored) but answer_text
-- stays empty — that's DATA ("no AIO for this query"), not a collection
-- failure. The Status page previously lumped these rows into "no response",
-- making every AIO audit look partially failed (e.g. 36/50).
--
-- New bucket:
--   scraped_empty — no answer, not terminal, but a payload was stored
--                   (raw_response_data / organic_results / citations /
--                   all_sources). Works retroactively for existing audits.
--   pending       — narrowed to rows with NO payload at all.
--
-- DROP + CREATE because the return type changes (extra column).

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
         rc.reasons
  FROM base b
  LEFT JOIN reason_counts rc ON rc.audit_id = b.audit_id AND rc.llm = b.llm
  GROUP BY b.audit_id, b.llm, rc.reasons;
$$;

GRANT EXECUTE ON FUNCTION audit_llm_response_stats(uuid[]) TO authenticated;
