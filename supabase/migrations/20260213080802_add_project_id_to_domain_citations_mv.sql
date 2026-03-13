/*
  # Add project_id to domain citations materialized view

  1. Changes
    - Drop existing domain_citations_mv
    - Recreate with project_id included
    - Add project_id to indexes
    - Update refresh function
    - Recreate trigger

  2. Purpose
    - Enable filtering citations by project
    - Show correct citation counts per project on Top Sources page
*/

-- Drop existing trigger
DROP TRIGGER IF EXISTS citations_domain_refresh ON citations;

-- Drop existing function
DROP FUNCTION IF EXISTS trigger_refresh_domain_citations();

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS domain_citations_mv CASCADE;

-- Create new materialized view with project_id
CREATE MATERIALIZED VIEW domain_citations_mv AS
SELECT 
  a.project_id,
  c.domain,
  c.llm,
  COUNT(*) FILTER (WHERE c.cited = true) as cited_count,
  COUNT(*) FILTER (WHERE c.cited = false) as more_count,
  COUNT(*) as total_citations,
  MIN(c.checked_at) as first_seen,
  MAX(c.checked_at) as last_seen
FROM citations c
INNER JOIN audits a ON a.id = c.audit_id
WHERE c.domain IS NOT NULL AND c.domain != ''
GROUP BY a.project_id, c.domain, c.llm;

-- Create composite unique index including project_id
CREATE UNIQUE INDEX domain_citations_mv_project_domain_llm_idx 
ON domain_citations_mv(project_id, domain, llm);

-- Create index on domain for text search
CREATE INDEX domain_citations_mv_domain_idx 
ON domain_citations_mv USING gin(domain gin_trgm_ops);

-- Create index on project_id for filtering
CREATE INDEX domain_citations_mv_project_id_idx 
ON domain_citations_mv(project_id);

-- Grant access to authenticated users
GRANT SELECT ON domain_citations_mv TO authenticated;

-- Update refresh function (no changes needed, but recreate for consistency)
CREATE OR REPLACE FUNCTION refresh_domain_citations_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY domain_citations_mv;
END;
$$;

-- Recreate trigger function
CREATE OR REPLACE FUNCTION trigger_refresh_domain_citations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM refresh_domain_citations_mv();
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Recreate trigger on citations
CREATE TRIGGER citations_domain_refresh
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_domain_citations();

-- Initial refresh with new structure
REFRESH MATERIALIZED VIEW domain_citations_mv;
