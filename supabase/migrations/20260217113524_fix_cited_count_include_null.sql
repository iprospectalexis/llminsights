/*
  # Fix Citation Counting Logic

  1. Changes
    - Update domain_citations_mv to count cited_count as citations where cited IS NOT false
    - This includes both cited=true and cited=null (Perplexity/Gemini citations)
    - Keep more_count as cited=false (SearchGPT "More" citations)

  2. Reasoning
    - SearchGPT provides explicit cited=true/false values
    - Perplexity and Gemini don't provide this field (cited=null)
    - We want to treat null as "cited" since they're actual citations in the response
    - Only cited=false represents "more information" sources not directly cited

  3. Impact
    - "Citations (Cited)" column will now show true + null citations
    - "Citations (More)" column will only show false citations
    - Better reflects actual citation behavior across different LLMs
*/

-- Drop existing trigger
DROP TRIGGER IF EXISTS citations_domain_refresh ON citations;

-- Drop existing function
DROP FUNCTION IF EXISTS trigger_refresh_domain_citations();

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS domain_citations_mv CASCADE;

-- Recreate materialized view with corrected cited_count logic
CREATE MATERIALIZED VIEW domain_citations_mv AS
SELECT
  a.project_id,
  c.domain,
  c.llm,
  COUNT(*) FILTER (WHERE c.cited IS DISTINCT FROM false) as cited_count,
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

-- Recreate refresh function
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
