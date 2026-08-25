-- Barometer: Ads — cross-project view of ad penetration in LLM answers.
--
-- Ads are captured from the SearchGPT/ChatGPT interface (sponsored unit:
-- advertiser name, url, carousel cards) since 2026-08-19, stored in
-- llm_responses.ads (jsonb). These RPCs aggregate them per country / over
-- time / per advertiser. SECURITY INVOKER like the other barometer
-- functions: RLS scopes regular users to their projects, managers see all.
--
-- An "ad response" = a searchgpt answer whose ads block carries an
-- advertiser name or carousel cards. One response carries at most one
-- sponsored unit, so advertiser counts are per-response.

-- The barometer scans only ad-carrying rows most of the time.
CREATE INDEX IF NOT EXISTS idx_llm_responses_ads_created
  ON llm_responses (created_at)
  WHERE ads IS NOT NULL;

-- ── Scorecards ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS barometer_ads_overview(text);
CREATE FUNCTION barometer_ads_overview(p_country text DEFAULT NULL)
RETURNS TABLE(total_responses bigint, responses_with_ads bigint, pct_with_ads numeric,
              unique_advertisers bigint, unique_ads bigint, ads_per_advertiser numeric,
              pct_with_shopping numeric)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT lr.ads, lr.shopping_visible,
           (lr.ads IS NOT NULL AND (lr.ads->>'name' IS NOT NULL
              OR jsonb_array_length(coalesce(lr.ads->'carousel_cards', '[]'::jsonb)) > 0)) AS has_ads
    FROM llm_responses lr
    JOIN audits a ON a.id = lr.audit_id
    JOIN projects p ON p.id = a.project_id
    WHERE lr.llm = 'searchgpt'
      AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
      AND lr.created_at >= '2026-08-19'
      AND (p_country IS NULL OR p.country = p_country)
  ),
  ads AS (
    SELECT lower(trim(ads->>'name')) AS advertiser,
           coalesce(ads->>'url', '') AS ad_url
    FROM base WHERE has_ads AND ads->>'name' IS NOT NULL
  )
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE has_ads)::bigint,
         CASE WHEN count(*) > 0
              THEN round(count(*) FILTER (WHERE has_ads)::numeric / count(*) * 100, 1)
              ELSE 0 END,
         (SELECT count(DISTINCT advertiser) FROM ads)::bigint,
         (SELECT count(DISTINCT (advertiser, ad_url)) FROM ads)::bigint,
         CASE WHEN (SELECT count(DISTINCT advertiser) FROM ads) > 0
              THEN round((SELECT count(DISTINCT (advertiser, ad_url)) FROM ads)::numeric
                         / (SELECT count(DISTINCT advertiser) FROM ads), 1)
              ELSE 0 END,
         CASE WHEN count(*) > 0
              THEN round(count(*) FILTER (WHERE shopping_visible)::numeric / count(*) * 100, 1)
              ELSE 0 END
  FROM base;
$$;
GRANT EXECUTE ON FUNCTION barometer_ads_overview(text) TO authenticated;

-- ── Penetration over time ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS barometer_ads_over_time(text, text);
CREATE FUNCTION barometer_ads_over_time(p_country text DEFAULT NULL,
                                        p_granularity text DEFAULT 'day')
RETURNS TABLE(time_period text, total_responses bigint, responses_with_ads bigint,
              pct_with_ads numeric, unique_advertisers bigint)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT date_trunc(p_granularity, lr.created_at) AS d,
           (lr.ads IS NOT NULL AND (lr.ads->>'name' IS NOT NULL
              OR jsonb_array_length(coalesce(lr.ads->'carousel_cards', '[]'::jsonb)) > 0)) AS has_ads,
           CASE WHEN lr.ads->>'name' IS NOT NULL
                THEN lower(trim(lr.ads->>'name')) END AS advertiser
    FROM llm_responses lr
    JOIN audits a ON a.id = lr.audit_id
    JOIN projects p ON p.id = a.project_id
    WHERE lr.llm = 'searchgpt'
      AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
      AND lr.created_at >= '2026-08-19'
      AND (p_country IS NULL OR p.country = p_country)
  )
  SELECT to_char(d, 'YYYY-MM-DD'),
         count(*)::bigint,
         count(*) FILTER (WHERE has_ads)::bigint,
         round(count(*) FILTER (WHERE has_ads)::numeric / count(*) * 100, 1),
         count(DISTINCT advertiser)::bigint
  FROM base
  GROUP BY d
  ORDER BY d;
$$;
GRANT EXECUTE ON FUNCTION barometer_ads_over_time(text, text) TO authenticated;

-- ── Top advertisers ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS barometer_ads_top_advertisers(text, integer);
CREATE FUNCTION barometer_ads_top_advertisers(p_country text DEFAULT NULL,
                                              p_limit integer DEFAULT 20)
RETURNS TABLE(advertiser text, sample_url text, responses bigint, share_pct numeric,
              unique_ads bigint, projects bigint, countries text, last_seen date)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT trim(lr.ads->>'name') AS advertiser_raw,
           lower(trim(lr.ads->>'name')) AS advertiser_norm,
           coalesce(lr.ads->>'url', '') AS ad_url,
           a.project_id, p.country, lr.created_at
    FROM llm_responses lr
    JOIN audits a ON a.id = lr.audit_id
    JOIN projects p ON p.id = a.project_id
    WHERE lr.llm = 'searchgpt'
      AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
      AND lr.created_at >= '2026-08-19'
      AND lr.ads->>'name' IS NOT NULL
      AND (p_country IS NULL OR p.country = p_country)
  ),
  tot AS (SELECT count(*)::numeric AS n FROM base)
  SELECT max(advertiser_raw),
         -- longest url tends to be the real landing page, not a bare domain
         (array_agg(nullif(ad_url, '') ORDER BY length(ad_url) DESC))[1],
         count(*)::bigint,
         round(count(*)::numeric / (SELECT n FROM tot) * 100, 1),
         count(DISTINCT ad_url)::bigint,
         count(DISTINCT project_id)::bigint,
         string_agg(DISTINCT coalesce(country, '??'), ', '),
         max(created_at)::date
  FROM base
  GROUP BY advertiser_norm
  ORDER BY count(*) DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION barometer_ads_top_advertisers(text, integer) TO authenticated;

-- ── Most ad-exposed projects ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS barometer_ads_top_projects(text, integer);
CREATE FUNCTION barometer_ads_top_projects(p_country text DEFAULT NULL,
                                           p_limit integer DEFAULT 10)
RETURNS TABLE(project_id uuid, project_name text, country text,
              total_responses bigint, responses_with_ads bigint,
              pct_with_ads numeric, unique_advertisers bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT p.id, p.name, p.country,
         count(*)::bigint,
         count(*) FILTER (WHERE lr.ads IS NOT NULL AND (lr.ads->>'name' IS NOT NULL
            OR jsonb_array_length(coalesce(lr.ads->'carousel_cards', '[]'::jsonb)) > 0))::bigint,
         round(count(*) FILTER (WHERE lr.ads IS NOT NULL AND (lr.ads->>'name' IS NOT NULL
            OR jsonb_array_length(coalesce(lr.ads->'carousel_cards', '[]'::jsonb)) > 0))::numeric
            / count(*) * 100, 1),
         count(DISTINCT CASE WHEN lr.ads->>'name' IS NOT NULL
                             THEN lower(trim(lr.ads->>'name')) END)::bigint
  FROM llm_responses lr
  JOIN audits a ON a.id = lr.audit_id
  JOIN projects p ON p.id = a.project_id
  WHERE lr.llm = 'searchgpt'
    AND lr.answer_text IS NOT NULL AND lr.answer_text <> ''
    AND lr.created_at >= '2026-08-19'
    AND (p_country IS NULL OR p.country = p_country)
  GROUP BY p.id, p.name, p.country
  HAVING count(*) >= 10   -- a 3-response project at 33% is noise, not signal
  ORDER BY 6 DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION barometer_ads_top_projects(text, integer) TO authenticated;
