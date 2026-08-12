-- Top Sources: correct per-domain aggregation + date frames.
--
-- The page previously read domain_citations_mv, whose rows are per
-- (project_id, domain, llm). In the single-LLM view the page showed those
-- rows RAW — the same domain appeared once per project with partial counts,
-- and sorting/pagination ranked the fragments, not the domain totals. The
-- MV also can't be sliced by date (it stores lifetime aggregates only).
--
-- This function aggregates the live citations table by domain (across all
-- projects), with optional LLM / date-window / search filters and
-- server-side sort + pagination. total_count (window count) feeds the pager.
--
-- SECURITY INVOKER: citations RLS applies to the caller — managers/admins
-- see global data, clients only their projects (the MV, granted to all
-- authenticated users, had no such scoping — materialized views can't
-- carry RLS).
--
-- cited semantics match the app-wide convention (and the MV): cited_count =
-- cited IS DISTINCT FROM false (true + null: Perplexity/Gemini don't set the
-- flag), more_count = cited = false (SearchGPT "More" links).

CREATE OR REPLACE FUNCTION top_source_domains(
  p_llm text DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'total_citations',
  p_asc boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  domain text,
  cited_count bigint,
  more_count bigint,
  total_citations bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH agg AS (
    SELECT c.domain,
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
    GROUP BY c.domain
  )
  SELECT a.domain, a.cited_count, a.more_count, a.total_citations,
         a.first_seen, a.last_seen,
         count(*) OVER ()::bigint AS total_count
  FROM agg a
  ORDER BY
    (CASE p_sort
       WHEN 'cited_count' THEN a.cited_count
       WHEN 'more_count'  THEN a.more_count
       ELSE a.total_citations
     END) * (CASE WHEN p_asc THEN 1 ELSE -1 END),
    a.domain ASC
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION top_source_domains(text, integer, text, text, boolean, integer, integer) TO authenticated;

-- Date-window scans hit checked_at; keep them off a full table scan.
CREATE INDEX IF NOT EXISTS citations_checked_at_idx ON citations(checked_at);
