-- One definition of Mention Rate / Citation Rate, in SQL, for every caller.
--
-- Before this, five implementations disagreed:
--   • llmi_be calculate_project_metrics — per-PROMPT mentions (any LLM counts),
--     citations counted WITH cited=false, denominator = all rows incl. failed;
--   • edge recalculate-metrics / reprocess-audit-results — also kept cited=false;
--   • edge poll-audit-results / onesearch-webhook — excluded cited=false;
--   • the Overview page — per-RESPONSE, cited<>false.
-- A project card could therefore read 66% / 3% while its own Overview read
-- 35% / 6%.
--
-- Unified definitions (per RESPONSE = audit × prompt × llm × run):
--   denominator  = responses that actually carry an answer (a failed or
--                  empty scrape is not "an answer that ignored us");
--   Mention Rate = answers where an own brand (or alias) appears on a WORD
--                  BOUNDARY, accent-insensitively — the old substring test
--                  matched the 3-letter brand "eni" inside French words like
--                  "venir"/"devenir", inflating one project from 21% to 35%;
--   Citation Rate= answers with at least one citation of the project domain
--                  where cited IS DISTINCT FROM false — i.e. excluding the
--                  "More sources" tier and the organic SERP block stored
--                  alongside Google AI Overview (90% of recent AIO citation
--                  rows), which are not citations inside an AI answer.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;


-- Regex that matches any of the given names on a word boundary.
-- NULL when there is nothing usable (names shorter than 3 chars are dropped:
-- 1-2 letter tokens produce noise even with boundaries).
CREATE OR REPLACE FUNCTION brand_boundary_pattern(p_names text[])
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
    '(^|[^a-z0-9])(' || string_agg(esc, '|') || ')([^a-z0-9]|$)'
  END
  FROM (
    SELECT DISTINCT regexp_replace(
             lower(extensions.unaccent(trim(n))),
             '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') AS esc
    FROM unnest(coalesce(p_names, '{}')) AS n
    WHERE n IS NOT NULL AND length(trim(n)) >= 3
  ) s;
$$;


CREATE OR REPLACE FUNCTION recalculate_project_metrics(p_project_id uuid)
RETURNS TABLE(mention_rate integer, citation_rate integer,
              answered_responses bigint, mentioned bigint, cited bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_domain text;
  v_domain_mode text;
  v_pattern text;
  v_answered bigint := 0;
  v_mentioned bigint := 0;
  v_cited bigint := 0;
  v_mr integer := 0;
  v_cr integer := 0;
  v_prompts integer := 0;
  v_audits integer := 0;
  v_last timestamptz;
BEGIN
  SELECT lower(regexp_replace(coalesce(p.domain, ''), '^www\.', '')),
         coalesce(p.domain_mode, 'exact')
    INTO v_domain, v_domain_mode
  FROM projects p WHERE p.id = p_project_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_prompts FROM prompts WHERE project_id = p_project_id;
  SELECT count(*)::int INTO v_audits FROM audits
   WHERE project_id = p_project_id AND status = 'completed';
  SELECT max(finished_at) INTO v_last FROM audits
   WHERE project_id = p_project_id AND status = 'completed';

  -- Own brands + their aliases.
  SELECT brand_boundary_pattern(array_agg(name)) INTO v_pattern
  FROM (
    SELECT b.brand_name AS name FROM brands b
     WHERE b.project_id = p_project_id AND NOT b.is_competitor
    UNION
    SELECT unnest(b.aliases) FROM brands b
     WHERE b.project_id = p_project_id AND NOT b.is_competitor
       AND b.aliases IS NOT NULL
  ) n WHERE name IS NOT NULL;

  WITH answered AS (
    SELECT lr.audit_id, lr.prompt_id, lr.llm,
           coalesce(lr.run_index, 1) AS run_index,
           lower(extensions.unaccent(lr.answer_text)) AS txt
    FROM llm_responses lr
    JOIN audits a ON a.id = lr.audit_id
    WHERE a.project_id = p_project_id
      AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
  )
  SELECT count(*),
         count(*) FILTER (WHERE v_pattern IS NOT NULL AND an.txt ~ v_pattern),
         count(*) FILTER (WHERE v_domain <> '' AND EXISTS (
           SELECT 1 FROM citations c
           WHERE c.audit_id = an.audit_id
             AND c.prompt_id = an.prompt_id
             AND c.llm = an.llm
             AND coalesce(c.run_index, 1) = an.run_index
             AND c.cited IS DISTINCT FROM false
             AND c.domain IS NOT NULL
             AND (lower(regexp_replace(c.domain, '^www\.', '')) = v_domain
                  OR (v_domain_mode = 'subdomains'
                      AND lower(regexp_replace(c.domain, '^www\.', '')) LIKE '%.' || v_domain))
         ))
    INTO v_answered, v_mentioned, v_cited
  FROM answered an;

  IF v_answered > 0 THEN
    v_mr := round((v_mentioned::numeric / v_answered) * 100);
    v_cr := round((v_cited::numeric / v_answered) * 100);
  END IF;

  INSERT INTO project_metrics (project_id, mention_rate, citation_rate,
                               total_prompts, total_audits, last_audit_at, updated_at)
  VALUES (p_project_id, v_mr, v_cr, v_prompts, v_audits, coalesce(v_last, now()), now())
  ON CONFLICT (project_id) DO UPDATE SET
    mention_rate = EXCLUDED.mention_rate,
    citation_rate = EXCLUDED.citation_rate,
    total_prompts = EXCLUDED.total_prompts,
    total_audits = EXCLUDED.total_audits,
    last_audit_at = EXCLUDED.last_audit_at,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT v_mr, v_cr, v_answered, v_mentioned, v_cited;
END;
$$;

-- Service-role callers only (the backend pipeline and the recalculate-metrics
-- edge function). The function writes project_metrics, so it must not be
-- reachable from the browser directly.
REVOKE ALL ON FUNCTION recalculate_project_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_project_metrics(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION brand_boundary_pattern(text[]) TO authenticated, service_role;
