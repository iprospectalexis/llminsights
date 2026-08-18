-- Global domain categorization for GEO analysis.
--
-- One row per domain, shared by ALL projects (a domain's nature — media,
-- forum, marketplace… — is objective). The project-relative overlay
-- (Own Brand / Competitor) is computed in the UI from the project's own
-- domain + brand lists and is NOT stored here.
--
-- source: 'rule' (curated static rules), 'llm' (gpt-5-nano batch
-- classification), 'manual' (user override — always wins on upsert).
--
-- Written only by the backend (direct postgres connection); authenticated
-- users read it for the Domains / Top Sources pages.

CREATE TABLE IF NOT EXISTS domain_categories (
  domain      text PRIMARY KEY,
  category    text NOT NULL CHECK (category IN (
    'Corporate', 'News/Media', 'Review/Comparison', 'Marketplace/Retail',
    'Social Media', 'Community/Forum', 'Video', 'Encyclopedia/Reference',
    'Education', 'Government/NGO', 'Blogs/Personal', 'Other'
  )),
  source      text NOT NULL DEFAULT 'llm' CHECK (source IN ('rule', 'llm', 'manual')),
  confidence  numeric,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE domain_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "domain_categories_read" ON domain_categories;
CREATE POLICY "domain_categories_read"
  ON domain_categories FOR SELECT TO authenticated USING (true);

GRANT SELECT ON domain_categories TO authenticated;

-- Top Sources: expose the category + optional category filter.
-- DROP + CREATE because the return type gains a column.

DROP FUNCTION IF EXISTS top_source_domains(text, integer, text, text, boolean, integer, integer);

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
RETURNS TABLE(
  domain text,
  cited_count bigint,
  more_count bigint,
  total_citations bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  category text,
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
  ),
  cat AS (
    SELECT a.*, COALESCE(dc.category, 'Unknown') AS category
    FROM agg a
    LEFT JOIN domain_categories dc ON dc.domain = a.domain
  )
  SELECT ct.domain, ct.cited_count, ct.more_count, ct.total_citations,
         ct.first_seen, ct.last_seen, ct.category,
         count(*) OVER ()::bigint AS total_count
  FROM cat ct
  WHERE (p_category IS NULL OR ct.category = p_category)
  ORDER BY
    (CASE p_sort
       WHEN 'cited_count' THEN ct.cited_count
       WHEN 'more_count'  THEN ct.more_count
       ELSE ct.total_citations
     END) * (CASE WHEN p_asc THEN 1 ELSE -1 END),
    ct.domain ASC
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION top_source_domains(text, integer, text, text, boolean, integer, integer, text) TO authenticated;
