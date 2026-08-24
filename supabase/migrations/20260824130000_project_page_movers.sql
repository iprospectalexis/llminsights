-- Pages Insights: Movers/Shakers with a day-based baseline, mirror of
-- project_domain_movers but keyed by normalized page URL.
--
-- normalize_page_url replicates the frontend's normalizeUrl(): fragment and
-- scheme dropped, host lowercased and www-stripped, trailing slashes trimmed
-- from the path (query preserved) — so client-side sparkline lookups match
-- the RPC's keys.

CREATE OR REPLACE FUNCTION normalize_page_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_url IS NULL OR p_url = '' THEN '' ELSE (
    WITH u AS (
      SELECT regexp_replace(regexp_replace(regexp_replace(p_url, '#.*$', ''), '^https?://', ''), '^www\.', '') AS s
    ), parts AS (
      SELECT lower(split_part(s, '/', 1)) AS host,
             CASE WHEN strpos(s, '/') > 0 THEN substr(s, strpos(s, '/')) ELSE '' END AS rest
      FROM u
    ), pq AS (
      SELECT host,
             split_part(rest, '?', 1) AS path,
             CASE WHEN strpos(rest, '?') > 0 THEN substr(rest, strpos(rest, '?')) ELSE '' END AS query
      FROM parts
    )
    SELECT host || coalesce(nullif(regexp_replace(path, '/+$', ''), ''), '/') || query FROM pq
  ) END;
$$;

DROP FUNCTION IF EXISTS project_page_movers(uuid, text, text[], integer);

CREATE FUNCTION project_page_movers(
  p_project_id uuid,
  p_llm text DEFAULT NULL,
  p_groups text[] DEFAULT NULL,
  p_days integer DEFAULT 7
)
RETURNS TABLE(page_url text, sample_url text, domain text, title text,
              last_count bigint, prev_count bigint,
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
    SELECT an.* FROM answered an, last_a l
    WHERE an.audit_id <> l.audit_id
    ORDER BY abs(extract(epoch FROM
      (an.created_at - (l.created_at - make_interval(days => GREATEST(p_days, 1))))))
    LIMIT 1
  ),
  cits AS (
    SELECT c.audit_id,
           normalize_page_url(c.page_url) AS u,
           min(c.page_url) AS sample_url,
           min(lower(regexp_replace(c.domain, '^www\.', ''))) AS dom,
           count(DISTINCT (c.prompt_id, c.llm, coalesce(c.run_index, 1)))::bigint AS n
    FROM citations c
    WHERE c.audit_id IN (SELECT audit_id FROM last_a UNION SELECT audit_id FROM base_a)
      AND c.page_url IS NOT NULL AND c.page_url <> ''
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
  titles AS (
    SELECT normalize_page_url(c.page_url) AS u,
           (array_agg(c.citation_text ORDER BY c.checked_at DESC)
              FILTER (WHERE c.citation_text IS NOT NULL AND c.citation_text <> ''
                        AND c.citation_text !~ '^https?://'
                        AND c.citation_text NOT IN ('No description available', 'No description'))
           )[1] AS title
    FROM citations c
    WHERE c.audit_id IN (SELECT audit_id FROM last_a UNION SELECT audit_id FROM base_a)
      AND c.page_url IS NOT NULL AND c.page_url <> ''
    GROUP BY 1
  ),
  lc AS (SELECT u, sample_url, dom, n FROM cits WHERE audit_id = (SELECT audit_id FROM last_a)),
  pc AS (SELECT u, sample_url, dom, n FROM cits WHERE audit_id = (SELECT audit_id FROM base_a))
  SELECT u AS page_url,
         coalesce(lc.sample_url, pc.sample_url) AS sample_url,
         coalesce(lc.dom, pc.dom) AS domain,
         t.title,
         coalesce(lc.n, 0) AS last_count,
         coalesce(pc.n, 0) AS prev_count,
         (SELECT total FROM last_a) AS last_total,
         (SELECT total FROM base_a) AS prev_total,
         (SELECT created_at FROM last_a) AS last_date,
         (SELECT created_at FROM base_a) AS prev_date
  FROM lc
  FULL OUTER JOIN pc USING (u)
  LEFT JOIN titles t USING (u)
  WHERE EXISTS (SELECT 1 FROM base_a);
$$;

GRANT EXECUTE ON FUNCTION normalize_page_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION project_page_movers(uuid, text, text[], integer) TO authenticated;
