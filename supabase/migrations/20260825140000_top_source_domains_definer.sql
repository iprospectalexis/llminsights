-- Top Sources barometer: fix the manager-path timeout.
--
-- The function was SECURITY INVOKER, so for admins/managers the citations
-- RLS became a 3-policy OR (owner EXISTS ∨ member EXISTS ∨ jwt-role check)
-- evaluated across the whole ~1M-row citations table: 8.1s measured — just
-- over Supabase's 8s statement_timeout for the authenticated role. The
-- barometer page therefore rendered empty for exactly the users it is meant
-- for. A plain member's scoped scan takes 1.2s and was fine.
--
-- Now SECURITY DEFINER with the authorization decided ONCE up front:
--   - admins/managers (JWT role claim, same rule as the managers_access_all_*
--     policies) aggregate with no per-row auth predicate (~0.6s for 30d);
--   - everyone else gets an explicit membership filter replicating the
--     citations RLS (project owner or project_members row).

DROP FUNCTION IF EXISTS top_source_domains(text, integer, text, text, boolean, integer, integer, text);

CREATE FUNCTION top_source_domains(
  p_llm text DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'total_citations',
  p_asc boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_category text DEFAULT NULL
)
RETURNS TABLE(domain text, cited_count bigint, more_count bigint, total_citations bigint,
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
BEGIN
  IF v_uid IS NULL AND NOT v_is_manager THEN
    RETURN;  -- anonymous callers see nothing
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT c.domain AS dom,
           count(*) FILTER (WHERE c.cited IS DISTINCT FROM false) AS cited_count,
           count(*) FILTER (WHERE c.cited = false)                AS more_count,
           count(*)                                               AS total_citations,
           min(c.checked_at)                                      AS first_seen,
           max(c.checked_at)                                      AS last_seen
    FROM citations c
    WHERE c.domain IS NOT NULL AND c.domain <> ''
      AND (p_llm IS NULL OR c.llm = p_llm)
      AND (p_days IS NULL OR c.checked_at >= now() - make_interval(days => p_days))
      AND (p_search IS NULL OR p_search = '' OR c.domain ILIKE '%' || p_search || '%')
      -- Authorization: managers skip the predicate entirely (v_is_manager is
      -- a plan-time constant here); others replicate the citations RLS.
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
  ),
  cat AS (
    SELECT a.*, COALESCE(dc.category, 'Unknown') AS cat_name
    FROM agg a
    LEFT JOIN domain_categories dc ON dc.domain = a.dom
  )
  SELECT ct.dom, ct.cited_count, ct.more_count, ct.total_citations,
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

REVOKE ALL ON FUNCTION top_source_domains(text, integer, text, text, boolean, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION top_source_domains(text, integer, text, text, boolean, integer, integer, text) TO authenticated;
