-- Top Sources barometer v3: country filter + trend vs the previous period.
--
-- - p_country filters citations to audits of projects with that country
--   (project settings), NULL = all countries.
-- - When p_days is set, the scan covers TWO back-to-back windows of that
--   length; per domain we return the previous window's total alongside the
--   current counts, so the UI can show citations trend vs the previous
--   period of the same duration. All-time (p_days NULL) has no baseline —
--   prev_total_citations comes back NULL.
-- - Keeps the SECURITY DEFINER split from 20260825140000: managers (JWT
--   role) aggregate with no per-row auth predicate; others get the explicit
--   owner-or-member filter replicating citations RLS. Manager+8s-limit was
--   the original outage.
--
-- Current-window semantics are unchanged: counts, first/last seen, category
-- filter and sorting all apply to the CURRENT window only; domains with no
-- citations in the current window are not listed (a domain that vanished is
-- the Domains-tab Movers/Shakers' job, not the top list's).

DROP FUNCTION IF EXISTS top_source_domains(text, integer, text, text, boolean, integer, integer, text);
DROP FUNCTION IF EXISTS top_source_domains(text, integer, text, text, boolean, integer, integer, text, text);

CREATE FUNCTION top_source_domains(
  p_llm text DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'total_citations',
  p_asc boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_category text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS TABLE(domain text, cited_count bigint, more_count bigint, total_citations bigint,
              prev_total_citations bigint,
              first_seen timestamptz, last_seen timestamptz, category text, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_manager boolean :=
    (auth.jwt() ->> 'role') IN ('admin', 'manager')
    OR ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'manager');
  v_cur_from timestamptz := CASE WHEN p_days IS NULL THEN NULL
                                 ELSE now() - make_interval(days => p_days) END;
  v_prev_from timestamptz := CASE WHEN p_days IS NULL THEN NULL
                                  ELSE now() - make_interval(days => 2 * p_days) END;
BEGIN
  IF v_uid IS NULL AND NOT v_is_manager THEN
    RETURN;  -- anonymous callers see nothing
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT c.domain AS dom,
           count(*) FILTER (WHERE (v_cur_from IS NULL OR c.checked_at >= v_cur_from)
                              AND c.cited IS DISTINCT FROM false)      AS cited_count,
           count(*) FILTER (WHERE (v_cur_from IS NULL OR c.checked_at >= v_cur_from)
                              AND c.cited = false)                     AS more_count,
           count(*) FILTER (WHERE v_cur_from IS NULL OR c.checked_at >= v_cur_from)
                                                                       AS total_citations,
           CASE WHEN v_cur_from IS NULL THEN NULL
                ELSE count(*) FILTER (WHERE c.checked_at < v_cur_from) END
                                                                       AS prev_total,
           min(c.checked_at) FILTER (WHERE v_cur_from IS NULL OR c.checked_at >= v_cur_from)
                                                                       AS first_seen,
           max(c.checked_at) FILTER (WHERE v_cur_from IS NULL OR c.checked_at >= v_cur_from)
                                                                       AS last_seen
    FROM citations c
    WHERE c.domain IS NOT NULL AND c.domain <> ''
      AND (p_llm IS NULL OR c.llm = p_llm)
      AND (v_prev_from IS NULL OR c.checked_at >= v_prev_from)
      AND (p_search IS NULL OR p_search = '' OR c.domain ILIKE '%' || p_search || '%')
      AND (p_country IS NULL OR EXISTS (
            SELECT 1 FROM audits a2 JOIN projects p2 ON p2.id = a2.project_id
            WHERE a2.id = c.audit_id AND p2.country = p_country))
      AND (v_is_manager OR EXISTS (
            SELECT 1
            FROM audits a
            JOIN projects p ON p.id = a.project_id
            WHERE a.id = c.audit_id
              AND (p.created_by = v_uid
                   OR EXISTS (SELECT 1 FROM project_members pm
                              WHERE pm.project_id = p.id AND pm.user_id = v_uid))
          ))
    GROUP BY c.domain
    HAVING count(*) FILTER (WHERE v_cur_from IS NULL OR c.checked_at >= v_cur_from) > 0
  ),
  cat AS (
    SELECT a.*, COALESCE(dc.category, 'Unknown') AS cat_name
    FROM agg a
    LEFT JOIN domain_categories dc ON dc.domain = a.dom
  )
  SELECT ct.dom, ct.cited_count, ct.more_count, ct.total_citations,
         ct.prev_total,
         ct.first_seen, ct.last_seen, ct.cat_name,
         count(*) OVER ()::bigint
  FROM cat ct
  WHERE (p_category IS NULL OR ct.cat_name = p_category)
  ORDER BY
    (CASE p_sort
       WHEN 'cited_count' THEN ct.cited_count
       WHEN 'more_count'  THEN ct.more_count
       ELSE ct.total_citations
     END) * (CASE WHEN p_asc THEN 1 ELSE -1 END),
    ct.dom ASC
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION top_source_domains(text, integer, text, text, boolean, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION top_source_domains(text, integer, text, text, boolean, integer, integer, text, text) TO authenticated;
