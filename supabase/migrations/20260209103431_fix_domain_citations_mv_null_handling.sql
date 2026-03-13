/*
  # Fix Domain Citations Materialized View NULL Handling
  
  1. Issue
    - The cited field in citations table can be TRUE, FALSE, or NULL
    - NULL should be treated as cited for backward compatibility
    - Current materialized view only counts cited = TRUE, missing ~230k NULL citations
  
  2. Fix
    - Update cited_count to include NULL values: (cited = TRUE OR cited IS NULL)
    - Keep more_count as cited = FALSE
    - Update total_citations to be cited_count + more_count
  
  3. Impact
    - Provides accurate citation counts
    - Maintains backward compatibility with legacy data
*/

-- Drop the existing materialized view
DROP MATERIALIZED VIEW IF EXISTS domain_citations_mv CASCADE;

-- Recreate materialized view with correct NULL handling
CREATE MATERIALIZED VIEW domain_citations_mv AS
SELECT 
  c.domain,
  c.llm,
  COUNT(*) FILTER (WHERE c.cited = true OR c.cited IS NULL) as cited_count,
  COUNT(*) FILTER (WHERE c.cited = false) as more_count,
  COUNT(*) as total_citations,
  MIN(c.checked_at) as first_seen,
  MAX(c.checked_at) as last_seen
FROM citations c
WHERE c.domain IS NOT NULL AND c.domain != ''
GROUP BY c.domain, c.llm;

-- Recreate composite unique index for fast lookups and concurrent refresh
CREATE UNIQUE INDEX domain_citations_mv_domain_llm_idx 
ON domain_citations_mv(domain, llm);

-- Recreate index on domain for text search
CREATE INDEX domain_citations_mv_domain_idx 
ON domain_citations_mv USING gin(domain gin_trgm_ops);

-- Grant access to authenticated users
GRANT SELECT ON domain_citations_mv TO authenticated;

-- Refresh with new data
REFRESH MATERIALIZED VIEW domain_citations_mv;
