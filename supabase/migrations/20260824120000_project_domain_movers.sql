-- Movers/Shakers over a longer horizon than the page's 5-audit window.
--
-- The client compares "last audit vs previous audit" from data it already
-- holds; for the 7d/14d/30d/90d modes the baseline audit is far outside
-- that window, so this RPC returns, per domain, the citing-response counts
-- of exactly TWO audits: the latest completed one and the completed audit
-- closest to (latest - N days). The client computes deltas and ranks.
--
-- Counting matches the Domains tab: a response key is (prompt, llm, run);
-- SearchGPT citations count only with cited = true, other LLMs with
-- cited IS DISTINCT FROM false ("More" tier and AIO organic excluded).
--
-- SECURITY INVOKER: the caller's RLS applies.

DROP FUNCTION IF EXISTS project_domain_movers(uuid, text, text[], integer);

CREATE FUNCTION project_domain_movers(
  p_project_id uuid,
  p_llm text DEFAULT NULL,
  p_groups text[] DEFAULT NULL,
  p_days integer DEFAULT 7
)
RETURNS TABLE(domain text, last_count bigint, prev_count bigint,
              last_total bigint, prev_total bigint,
              last_date timestamptz, prev_date timestamptz)
LANGUAGE sql
STABLE
AS $$
  WITH answered AS (
    SELECT lr.audit_id, a.created_at, count(*)::bigint AS total
    FROM llm_responses lr
    JOIN audits a ON a.id = lr.audit_id
    LEFT JOIN prompts pr ON pr.id = lr.prompt_id
    WHERE a.project_id = p_project_id
      AND a.status = 'completed'
      AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
      AND (p_llm IS NULL OR lr.llm = p_llm)
      AND (p_groups IS NULL OR pr.prompt_group = ANY(p_groups))
    GROUP BY lr.audit_id, a.created_at
  ),
  last_a AS (
    SELECT * FROM answered ORDER BY created_at DESC LIMIT 1
  ),
  base_a AS (
    -- The audit closest to the target date, never the latest itself. When
    -- the project is younger than N days this degrades to the oldest audit.
    SELECT an.* FROM answered an, last_a l
    WHERE an.audit_id <> l.audit_id
    ORDER BY abs(extract(epoch FROM
      (an.created_at - (l.created_at - make_interval(days => GREATEST(p_days, 1))))))
    LIMIT 1
  ),
  cits AS (
    SELECT c.audit_id,
           lower(regexp_replace(c.domain, '^www\.', '')) AS dom,
           count(DISTINCT (c.prompt_id, c.llm, coalesce(c.run_index, 1)))::bigint AS n
    FROM citations c
    WHERE c.audit_id IN (SELECT audit_id FROM last_a UNION SELECT audit_id FROM base_a)
      AND c.domain IS NOT NULL AND c.domain <> ''
      AND (p_llm IS NULL OR c.llm = p_llm)
      AND (CASE WHEN c.llm = 'searchgpt'
                THEN c.cited IS TRUE
                ELSE c.cited IS DISTINCT FROM false END)
      AND (p_groups IS NULL OR EXISTS (
             SELECT 1 FROM prompts pr
             WHERE pr.id = c.prompt_id AND pr.prompt_group = ANY(p_groups)))
    GROUP BY 1, 2
  ),
  lc AS (SELECT dom, n FROM cits WHERE audit_id = (SELECT audit_id FROM last_a)),
  pc AS (SELECT dom, n FROM cits WHERE audit_id = (SELECT audit_id FROM base_a))
  SELECT coalesce(lc.dom, pc.dom) AS domain,
         coalesce(lc.n, 0) AS last_count,
         coalesce(pc.n, 0) AS prev_count,
         (SELECT total FROM last_a) AS last_total,
         (SELECT total FROM base_a) AS prev_total,
         (SELECT created_at FROM last_a) AS last_date,
         (SELECT created_at FROM base_a) AS prev_date
  FROM lc
  FULL OUTER JOIN pc USING (dom)
  WHERE EXISTS (SELECT 1 FROM base_a);
$$;

GRANT EXECUTE ON FUNCTION project_domain_movers(uuid, text, text[], integer) TO authenticated;
