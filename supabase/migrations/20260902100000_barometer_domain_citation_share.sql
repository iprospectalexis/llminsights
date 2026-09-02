-- Barometer: share of responses citing a given domain, per LLM over time.
--
-- Feeds the "Reddit.com citation share" chart on the Barometers page
-- (p_domain = 'reddit.com'), but is generic: any registrable domain works.
--
-- A "response" is one (audit, prompt, llm, run) group of the citations
-- table; the denominator is the responses that carry at least one citation
-- in the period (web search happened), the numerator those with at least
-- one citation of the domain. Only citations actually used in the answer
-- count (cited IS DISTINCT FROM false — NULL means cited for providers
-- that carry no flag), matching recalculate_project_metrics().
--
-- Domain values in the table are not perfectly normalised (e.g.
-- 'https://www.reddit.com/', 'Reddit' from Google goto source labels,
-- 'business.reddit.com'), so the match normalises: protocol/www/path
-- stripped and lower-cased, then exact, subdomain, or the bare source
-- label (split_part(p_domain, '.', 1)). A cheap ILIKE prefilter keeps the
-- regexp work off the ~1.2M rows that cannot match.
--
-- Same conventions as the sibling get_web_search_*_by_time functions.

DROP FUNCTION IF EXISTS get_domain_citation_share_by_time(text, text);

CREATE OR REPLACE FUNCTION get_domain_citation_share_by_time(date_trunc_arg text, p_domain text)
RETURNS TABLE(time_period text, llm text, value numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text := lower(btrim(p_domain));
  v_label  text := split_part(lower(btrim(p_domain)), '.', 1);
BEGIN
  -- Only allow authenticated users
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_domain IS NULL OR v_domain = '' THEN
    RAISE EXCEPTION 'p_domain is required';
  END IF;

  RETURN QUERY
  WITH resp AS (
    SELECT date_trunc(date_trunc_arg, c.checked_at) AS d,
           c.llm,
           -- Match on the domain column only: reading page_url for every
           -- row doubled the call time (3.3s vs 1.8s over 1.2M rows) and
           -- it did not add a single match (0 URL-only Reddit rows). CASE (not AND)
           -- keeps the regexps off rows the cheap ILIKE already excludes.
           bool_or(
             CASE WHEN c.domain ILIKE '%' || v_label || '%'
                  THEN (
                    regexp_replace(regexp_replace(lower(c.domain), '^https?://(www\.)?', ''), '/.*$', '')
                      IN (v_domain, v_label)
                    OR regexp_replace(regexp_replace(lower(c.domain), '^https?://(www\.)?', ''), '/.*$', '')
                      LIKE '%.' || v_domain
                  )
                  ELSE false END
           ) AS cites_domain
    FROM citations c
    WHERE c.cited IS DISTINCT FROM false
      AND c.checked_at IS NOT NULL
    GROUP BY 1, 2, c.audit_id, c.prompt_id, c.run_index
  )
  SELECT to_char(r.d, 'YYYY-MM-DD') AS time_period,
         r.llm,
         round(count(*) FILTER (WHERE r.cites_domain)::numeric / NULLIF(count(*), 0) * 100, 2) AS value
  FROM resp r
  GROUP BY r.d, r.llm
  ORDER BY r.d, r.llm;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_domain_citation_share_by_time(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_domain_citation_share_by_time(text, text) TO authenticated, service_role;
