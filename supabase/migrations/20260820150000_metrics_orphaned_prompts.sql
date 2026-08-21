-- Citation Rate must not silently read 0% (or a meaningless number) when a
-- project's prompt links were destroyed.
--
-- An old project-edit flow deleted and re-inserted every prompt; the
-- llm_responses / citations FKs are ON DELETE SET NULL, so those rows lost
-- prompt_id. 96 projects are affected (16% of all citation rows, 11% of all
-- responses); 20 of them are FULLY orphaned. A citation whose prompt_id is
-- NULL cannot be attributed to a response — SQL's NULL <> NULL correctly
-- refuses the join, which made those projects report citation_rate = 0.
--
-- Now: Citation Rate is computed over ATTRIBUTABLE answers only, and when a
-- project has none, it is stored as NULL — "not measurable" — instead of a
-- fabricated 0%. Mention Rate is unaffected (it only needs answer_text).

-- DROP first: the return type gains a column, which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS recalculate_project_metrics(uuid);

CREATE FUNCTION recalculate_project_metrics(p_project_id uuid)
RETURNS TABLE(mention_rate integer, citation_rate integer,
              answered_responses bigint, attributable bigint,
              mentioned bigint, cited bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_domain text;
  v_domain_mode text;
  v_pattern text;
  v_answered bigint := 0;
  v_attributable bigint := 0;
  v_mentioned bigint := 0;
  v_cited bigint := 0;
  v_mr integer := 0;
  v_cr integer := NULL;
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
         count(*) FILTER (WHERE an.prompt_id IS NOT NULL),
         count(*) FILTER (WHERE v_pattern IS NOT NULL AND an.txt ~ v_pattern),
         count(*) FILTER (WHERE an.prompt_id IS NOT NULL AND v_domain <> '' AND EXISTS (
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
    INTO v_answered, v_attributable, v_mentioned, v_cited
  FROM answered an;

  IF v_answered > 0 THEN
    v_mr := round((v_mentioned::numeric / v_answered) * 100);
  END IF;

  -- NULL, not 0, when nothing can be attributed: the difference between
  -- "nobody cites us" and "we cannot tell".
  IF v_attributable > 0 THEN
    v_cr := round((v_cited::numeric / v_attributable) * 100);
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

  RETURN QUERY SELECT v_mr, v_cr, v_answered, v_attributable, v_mentioned, v_cited;
END;
$$;

REVOKE ALL ON FUNCTION recalculate_project_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_project_metrics(uuid) TO service_role;
