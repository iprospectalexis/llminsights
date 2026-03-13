/*
  # Add Aggregated Domain Citations

  1. Changes
    - Adds aggregated rows to domain_citations_mv with llm = 'all'
    - These rows show total citations across all LLMs for each domain
    - Allows displaying domains with total citations by default, while still supporting per-LLM filtering

  2. New Rows
    - For each domain, adds a row with llm = 'all' that aggregates:
      - cited_count: sum of all cited citations across all LLMs
      - more_count: sum of all more citations across all LLMs
      - total_citations: sum of all citations across all LLMs
      - first_seen: earliest citation date across all LLMs
      - last_seen: latest citation date across all LLMs
*/

-- Drop the existing materialized view
DROP MATERIALIZED VIEW IF EXISTS domain_citations_mv;

-- Recreate with aggregated rows
CREATE MATERIALIZED VIEW domain_citations_mv AS
WITH domain_llm_stats AS (
  SELECT
    c.domain,
    c.llm,
    COUNT(*) FILTER (WHERE c.cited = true OR c.cited IS NULL) AS cited_count,
    COUNT(*) FILTER (WHERE c.cited = false) AS more_count,
    COUNT(*) AS total_citations,
    MIN(COALESCE(c.checked_at, a.created_at)) AS first_seen,
    MAX(COALESCE(c.checked_at, a.created_at)) AS last_seen
  FROM citations c
  INNER JOIN audits a ON c.audit_id = a.id
  WHERE c.domain IS NOT NULL
  GROUP BY c.domain, c.llm
),
domain_total_stats AS (
  SELECT
    c.domain,
    'all' AS llm,
    COUNT(*) FILTER (WHERE c.cited = true OR c.cited IS NULL) AS cited_count,
    COUNT(*) FILTER (WHERE c.cited = false) AS more_count,
    COUNT(*) AS total_citations,
    MIN(COALESCE(c.checked_at, a.created_at)) AS first_seen,
    MAX(COALESCE(c.checked_at, a.created_at)) AS last_seen
  FROM citations c
  INNER JOIN audits a ON c.audit_id = a.id
  WHERE c.domain IS NOT NULL
  GROUP BY c.domain
)
SELECT * FROM domain_llm_stats
UNION ALL
SELECT * FROM domain_total_stats;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_domain_citations_mv_domain ON domain_citations_mv(domain);
CREATE INDEX IF NOT EXISTS idx_domain_citations_mv_llm ON domain_citations_mv(llm);
CREATE INDEX IF NOT EXISTS idx_domain_citations_mv_total_citations ON domain_citations_mv(total_citations DESC);
CREATE INDEX IF NOT EXISTS idx_domain_citations_mv_domain_llm ON domain_citations_mv(domain, llm);

-- Refresh the materialized view
REFRESH MATERIALIZED VIEW domain_citations_mv;
