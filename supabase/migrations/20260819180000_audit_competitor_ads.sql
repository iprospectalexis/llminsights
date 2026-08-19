-- Competitor-advertiser detection per audit, for Status alerts.
--
-- Returns advertisers found in an audit's answers whose normalized name
-- equals a competitor brand of the audit's project (same normalization as
-- the frontend normalizeBrandKey: lowercase, alphanumerics only — accent
-- differences are tolerated by unaccent-less deployments only for ASCII;
-- brand aliases are not consulted in v1).

DROP FUNCTION IF EXISTS audit_competitor_ads(uuid[]);

CREATE FUNCTION audit_competitor_ads(p_audit_ids uuid[])
RETURNS TABLE(audit_id uuid, advertiser text, impressions bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT lr.audit_id, lr.ads->>'name' AS advertiser, count(*)::bigint AS impressions
  FROM llm_responses lr
  JOIN audits a ON a.id = lr.audit_id
  JOIN brands b ON b.project_id = a.project_id AND b.is_competitor
  WHERE lr.audit_id = ANY(p_audit_ids)
    AND lr.ads IS NOT NULL
    AND lr.ads->>'name' IS NOT NULL
    AND regexp_replace(lower(lr.ads->>'name'), '[^a-z0-9]', '', 'g') =
        regexp_replace(lower(b.brand_name), '[^a-z0-9]', '', 'g')
  GROUP BY lr.audit_id, lr.ads->>'name';
$$;

GRANT EXECUTE ON FUNCTION audit_competitor_ads(uuid[]) TO authenticated;
