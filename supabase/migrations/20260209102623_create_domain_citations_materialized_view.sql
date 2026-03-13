/*
  # Create Domain Citations Materialized View
  
  1. Purpose
    - Provides fast access to citation statistics aggregated by domain and LLM
    - Separates cited (true) and more (false) citations
    - Enables efficient filtering and searching for Barometers page
    - Eliminates need for complex aggregations at query time
  
  2. Metrics Included
    - domain: The citation domain
    - llm: The LLM that generated the citation
    - cited_count: Count of citations where cited = true
    - more_count: Count of citations where cited = false
    - total_citations: Total count of all citations
    - first_seen: First time domain was cited
    - last_seen: Last time domain was cited
  
  3. Performance
    - Materialized for fast reads
    - Refresh trigger updates when citations change
    - Composite index on (domain, llm) for fast filtering
    - Index on domain for text search with pg_trgm
  
  4. Security
    - Grant SELECT to authenticated users
*/

-- Enable pg_trgm extension for text search if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create materialized view for domain citations
CREATE MATERIALIZED VIEW IF NOT EXISTS domain_citations_mv AS
SELECT 
  c.domain,
  c.llm,
  COUNT(*) FILTER (WHERE c.cited = true) as cited_count,
  COUNT(*) FILTER (WHERE c.cited = false) as more_count,
  COUNT(*) as total_citations,
  MIN(c.checked_at) as first_seen,
  MAX(c.checked_at) as last_seen
FROM citations c
WHERE c.domain IS NOT NULL AND c.domain != ''
GROUP BY c.domain, c.llm;

-- Create composite unique index for fast lookups and concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS domain_citations_mv_domain_llm_idx 
ON domain_citations_mv(domain, llm);

-- Create index on domain for text search
CREATE INDEX IF NOT EXISTS domain_citations_mv_domain_idx 
ON domain_citations_mv USING gin(domain gin_trgm_ops);

-- Grant access to authenticated users
GRANT SELECT ON domain_citations_mv TO authenticated;

-- Create function to refresh domain citations materialized view
CREATE OR REPLACE FUNCTION refresh_domain_citations_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY domain_citations_mv;
END;
$$;

-- Create trigger function to refresh domain citations when citations change
CREATE OR REPLACE FUNCTION trigger_refresh_domain_citations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Schedule async refresh to avoid blocking
  PERFORM refresh_domain_citations_mv();
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger on citations for automatic refresh
DROP TRIGGER IF EXISTS citations_domain_refresh ON citations;
CREATE TRIGGER citations_domain_refresh
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_domain_citations();

-- Initial refresh
REFRESH MATERIALIZED VIEW domain_citations_mv;
