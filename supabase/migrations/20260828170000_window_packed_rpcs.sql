-- Packed columnar transport for the project dashboard's data window.
--
-- The dashboards load every llm_response and citation row of the
-- selected period. Shipping those as row objects costs ~500B/row of
-- JSON field names, repeated URLs/titles/domains, and dozens of paged
-- requests (PostgREST caps at 1000 rows). These two RPCs return the
-- SAME data as one dictionary-encoded payload of row-tuples; the
-- frontend unpacks into row objects identical to the REST shapes
-- (llm_responses.citations arrives in its citations_slim projection —
-- the slim transform is inlined here so it runs set-based, not per
-- row).
--
-- Result shape (both): {n, <dicts...>, rows: [[...tuple...], ...]}
-- Tuple layouts are documented above each function and mirrored in
-- src/lib/windowPacked.ts.
--
-- SECURITY DEFINER with an up-front access check (same pattern as
-- top_source_domains): manager/admin via JWT claims, otherwise project
-- owner or project_members membership. Runs as owner, so per-row RLS
-- policies do not re-execute for every row.

DROP FUNCTION IF EXISTS public.project_citations_window_packed(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.project_responses_window_packed(uuid, timestamptz, timestamptz);

-- Citations tuple:
--   [url_i, dom_i, txt_i, llm_i, aud_i, prm_i,
--    position, cited, sentiment_score, sentiment_label, checked_epoch]
CREATE OR REPLACE FUNCTION public.project_citations_window_packed(
  p_project uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_audit_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- coalesce() is load-bearing: with no JWT the app_metadata branch
  -- yields NULL, NULL poisons the OR chain, and IF NOT NULL does not
  -- raise — the guard would silently pass.
  IF NOT coalesce(
    (auth.jwt() ->> 'role') IN ('admin', 'manager')
    OR ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'manager')
    OR EXISTS (SELECT 1 FROM projects p
               WHERE p.id = p_project AND p.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM project_members pm
               WHERE pm.project_id = p_project AND pm.user_id = auth.uid())
  , false) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  WITH rows AS MATERIALIZED (
    SELECT c.id, c.audit_id, c.prompt_id, c.llm, c.page_url, c.domain,
           c.citation_text, c.position, c.cited,
           c.sentiment_score, c.sentiment_label, c.checked_at
    FROM citations c
    JOIN audits a ON a.id = c.audit_id
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
  ),
  d_url AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT page_url AS v FROM rows WHERE page_url IS NOT NULL) t
  ),
  d_dom AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT domain AS v FROM rows WHERE domain IS NOT NULL) t
  ),
  d_txt AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT citation_text AS v FROM rows WHERE citation_text IS NOT NULL) t
  ),
  d_llm AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT llm AS v FROM rows WHERE llm IS NOT NULL) t
  ),
  d_aud AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT audit_id AS v FROM rows) t
  ),
  d_prm AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT prompt_id AS v FROM rows WHERE prompt_id IS NOT NULL) t
  )
  SELECT jsonb_build_object(
    'n',       (SELECT count(*) FROM rows),
    'urls',    coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_url), '[]'::jsonb),
    'domains', coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_dom), '[]'::jsonb),
    'texts',   coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_txt), '[]'::jsonb),
    'llms',    coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_llm), '[]'::jsonb),
    'audits',  coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_aud), '[]'::jsonb),
    'prompts', coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_prm), '[]'::jsonb),
    'rows',    coalesce((
      SELECT jsonb_agg(jsonb_build_array(
               du.i, dd.i, dt.i, dl.i, da.i, dp.i,
               r.position, r.cited, r.sentiment_score, r.sentiment_label,
               floor(extract(epoch FROM r.checked_at))::bigint
             ) ORDER BY r.id)
      FROM rows r
      LEFT JOIN d_url du ON du.v = r.page_url
      LEFT JOIN d_dom dd ON dd.v = r.domain
      LEFT JOIN d_txt dt ON dt.v = r.citation_text
      LEFT JOIN d_llm dl ON dl.v = r.llm
      LEFT JOIN d_aud da ON da.v = r.audit_id
      LEFT JOIN d_prm dp ON dp.v = r.prompt_id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- Responses tuple (v2 — answer_text never ships in bulk):
--   [id, aud_i, prm_i, llm_i, answered(0/1), created_epoch,
--    sentiment_score, sentiment_label, shopping(0/1/null),
--    is_map(0/1/null), ad_name, web_search_query,
--    cit_p (null | [[url_i, cited, ttl_i], ...]),
--    links_p (null | [url_i, ...]),
--    srcs_p (null | [[url_i, sdom_i], ...]),
--    comp_kind (0 null / 1 brands / 2 other-truthy),
--    comp_p (null | [brand_i, ...]),
--    ment_p (null | [pbrand_i, ...] — project brands matched in the
--            answer via brand_boundary_pattern: word-boundary,
--            unaccented, alias-aware — same rules as project metrics)]
-- Payload also carries 'v': 2 and the 'pbrands' dictionary (project
-- brand names in index order).
CREATE OR REPLACE FUNCTION public.project_responses_window_packed(
  p_project uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_audit_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- coalesce() is load-bearing: with no JWT the app_metadata branch
  -- yields NULL, NULL poisons the OR chain, and IF NOT NULL does not
  -- raise — the guard would silently pass.
  IF NOT coalesce(
    (auth.jwt() ->> 'role') IN ('admin', 'manager')
    OR ((auth.jwt() -> 'app_metadata') ->> 'role') IN ('admin', 'manager')
    OR EXISTS (SELECT 1 FROM projects p
               WHERE p.id = p_project AND p.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM project_members pm
               WHERE pm.project_id = p_project AND pm.user_id = auth.uid())
  , false) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  -- `rows` stays LIGHT on purpose: the heavy jsonb columns are only
  -- exploded by the ent CTEs below, each reading its own column
  -- straight from the table (one detoast pass, no temp-file rewrite
  -- of 30+MB of jsonb).
  WITH rows AS MATERIALIZED (
    SELECT r.id, r.audit_id, r.prompt_id, r.llm,
           (r.answer_text IS NOT NULL AND r.answer_text != '') AS answered,
           r.web_search_query, r.sentiment_score, r.sentiment_label,
           r.shopping_visible, r.is_map,
           r.ads->>'name' AS ad_name, r.created_at,
           (r.citations IS NULL) AS cit_null,
           (jsonb_typeof(r.citations) = 'array') AS cit_arr,
           (r.links_attached IS NULL) AS links_null,
           (r.all_sources IS NULL) AS srcs_null,
           CASE WHEN r.answer_competitors IS NULL THEN 0
                WHEN jsonb_typeof(r.answer_competitors->'brands') = 'array' THEN 1
                ELSE 2 END AS comp_kind
    FROM llm_responses r
    JOIN audits a ON a.id = r.audit_id
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
  ),
  -- Project brand dictionary + per-response mention flags. Matching
  -- reuses brand_boundary_pattern (word-boundary, unaccent, aliases,
  -- names >= 3 chars) so the dashboards agree with project metrics.
  pb AS MATERIALIZED (
    SELECT b.brand_name AS v,
           row_number() OVER (ORDER BY b.brand_name) - 1 AS i,
           public.brand_boundary_pattern(
             array_prepend(b.brand_name, coalesce(b.aliases, '{}'))) AS pat
    FROM brands b
    WHERE b.project_id = p_project AND b.brand_name IS NOT NULL
  ),
  rtxt AS MATERIALIZED (
    SELECT r.id, extensions.unaccent(lower(r.answer_text)) AS t
    FROM llm_responses r
    JOIN audits a ON a.id = r.audit_id
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
      AND r.answer_text IS NOT NULL AND r.answer_text != ''
  ),
  ment AS MATERIALIZED (
    SELECT rt.id, jsonb_agg(pb.i ORDER BY pb.i) AS v
    FROM rtxt rt
    JOIN pb ON pb.pat IS NOT NULL AND rt.t ~ pb.pat
    GROUP BY rt.id
  ),
  -- citations_slim inlined at entry level: title = title|name (120),
  -- else description (160) — exactly what the consumers display.
  cit_ent AS MATERIALIZED (
    SELECT r.id, e.ord,
           e.val->>'url' AS url,
           e.val->'cited' AS cited,
           coalesce(
             nullif(left(coalesce(nullif(e.val->>'title',''), nullif(e.val->>'name','')), 120), ''),
             left(e.val->>'description', 160)
           ) AS ttl
    FROM llm_responses r
    JOIN audits a ON a.id = r.audit_id,
    LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.citations) = 'array' THEN r.citations ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(val, ord)
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
  ),
  link_ent AS MATERIALIZED (
    SELECT r.id, e.ord, e.val->>'url' AS url
    FROM llm_responses r
    JOIN audits a ON a.id = r.audit_id,
    LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.links_attached) = 'array' THEN r.links_attached ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(val, ord)
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
  ),
  src_ent AS MATERIALIZED (
    SELECT r.id, e.ord, e.val->>'url' AS url, e.val->>'domain' AS dom
    FROM llm_responses r
    JOIN audits a ON a.id = r.audit_id,
    LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.all_sources) = 'array' THEN r.all_sources ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(val, ord)
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
  ),
  brand_ent AS MATERIALIZED (
    SELECT r.id, b.ord,
           coalesce(b.val->>'name',
                    CASE WHEN jsonb_typeof(b.val) = 'string' THEN b.val #>> '{}' END) AS name
    FROM llm_responses r
    JOIN audits a ON a.id = r.audit_id,
    LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.answer_competitors->'brands') = 'array'
           THEN r.answer_competitors->'brands' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS b(val, ord)
    WHERE a.project_id = p_project
      AND a.created_at >= p_from AND a.created_at <= p_to
      AND (p_audit_ids IS NULL OR a.id = ANY(p_audit_ids))
  ),
  d_url AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i FROM (
      SELECT DISTINCT url AS v FROM cit_ent WHERE url IS NOT NULL
      UNION SELECT DISTINCT url FROM link_ent WHERE url IS NOT NULL
      UNION SELECT DISTINCT url FROM src_ent WHERE url IS NOT NULL
    ) t
  ),
  d_ttl AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT ttl AS v FROM cit_ent WHERE ttl IS NOT NULL) t
  ),
  d_sdom AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT dom AS v FROM src_ent WHERE dom IS NOT NULL) t
  ),
  d_brand AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT name AS v FROM brand_ent WHERE name IS NOT NULL) t
  ),
  d_llm AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT llm AS v FROM rows WHERE llm IS NOT NULL) t
  ),
  d_aud AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT audit_id AS v FROM rows) t
  ),
  d_prm AS MATERIALIZED (
    SELECT v, row_number() OVER (ORDER BY v) - 1 AS i
    FROM (SELECT DISTINCT prompt_id AS v FROM rows WHERE prompt_id IS NOT NULL) t
  ),
  cit_pack AS MATERIALIZED (
    SELECT ce.id,
           jsonb_agg(jsonb_build_array(du.i, ce.cited, dt.i) ORDER BY ce.ord) AS v
    FROM cit_ent ce
    LEFT JOIN d_url du ON du.v = ce.url
    LEFT JOIN d_ttl dt ON dt.v = ce.ttl
    GROUP BY ce.id
  ),
  link_pack AS MATERIALIZED (
    SELECT le.id, jsonb_agg(du.i ORDER BY le.ord) AS v
    FROM link_ent le
    LEFT JOIN d_url du ON du.v = le.url
    GROUP BY le.id
  ),
  src_pack AS MATERIALIZED (
    SELECT se.id,
           jsonb_agg(jsonb_build_array(du.i, ds.i) ORDER BY se.ord) AS v
    FROM src_ent se
    LEFT JOIN d_url du ON du.v = se.url
    LEFT JOIN d_sdom ds ON ds.v = se.dom
    GROUP BY se.id
  ),
  comp_pack AS MATERIALIZED (
    SELECT be.id, jsonb_agg(db.i ORDER BY be.ord) AS v
    FROM brand_ent be
    LEFT JOIN d_brand db ON db.v = be.name
    GROUP BY be.id
  )
  SELECT jsonb_build_object(
    'v',        2,
    'n',        (SELECT count(*) FROM rows),
    'pbrands',  coalesce((SELECT jsonb_agg(v ORDER BY i) FROM pb), '[]'::jsonb),
    'urls',     coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_url), '[]'::jsonb),
    'titles',   coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_ttl), '[]'::jsonb),
    'sdomains', coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_sdom), '[]'::jsonb),
    'brands',   coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_brand), '[]'::jsonb),
    'llms',     coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_llm), '[]'::jsonb),
    'audits',   coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_aud), '[]'::jsonb),
    'prompts',  coalesce((SELECT jsonb_agg(v ORDER BY i) FROM d_prm), '[]'::jsonb),
    'rows',     coalesce((
      SELECT jsonb_agg(jsonb_build_array(
               r.id, da.i, dp.i, dl.i,
               CASE WHEN r.answered THEN 1 ELSE 0 END,
               floor(extract(epoch FROM r.created_at))::bigint,
               r.sentiment_score, r.sentiment_label,
               CASE WHEN r.shopping_visible IS NULL THEN NULL
                    WHEN r.shopping_visible THEN 1 ELSE 0 END,
               CASE WHEN r.is_map IS NULL THEN NULL
                    WHEN r.is_map THEN 1 ELSE 0 END,
               r.ad_name, r.web_search_query,
               CASE WHEN r.cit_null THEN NULL
                    ELSE coalesce(cp.v, '[]'::jsonb) END,
               CASE WHEN r.links_null THEN NULL
                    ELSE coalesce(lp.v, '[]'::jsonb) END,
               CASE WHEN r.srcs_null THEN NULL
                    ELSE coalesce(sp.v, '[]'::jsonb) END,
               r.comp_kind,
               CASE WHEN r.comp_kind = 1
                    THEN coalesce(kp.v, '[]'::jsonb) END,
               CASE WHEN r.answered THEN coalesce(mp.v, '[]'::jsonb) END
             ) ORDER BY r.id)
      FROM rows r
      LEFT JOIN d_llm dl ON dl.v = r.llm
      LEFT JOIN d_aud da ON da.v = r.audit_id
      LEFT JOIN d_prm dp ON dp.v = r.prompt_id
      LEFT JOIN cit_pack cp ON cp.id = r.id
      LEFT JOIN link_pack lp ON lp.id = r.id
      LEFT JOIN src_pack sp ON sp.id = r.id
      LEFT JOIN comp_pack kp ON kp.id = r.id
      LEFT JOIN ment mp ON mp.id = r.id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.project_citations_window_packed(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_responses_window_packed(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_citations_window_packed(uuid, timestamptz, timestamptz, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_responses_window_packed(uuid, timestamptz, timestamptz, uuid[]) TO authenticated, service_role;
