-- Brand → official-site domain, for brand favicons/logos.
--
-- Global (one row per normalized brand name, shared by all projects).
-- Tier 0 lives client-side (most-cited matching domain from the project's
-- own citations); this table is the fallback filled after each audit:
--   'citations' — resolved from the project's citation domains server-side
--   'llm'       — gpt-5-nano "official website of brand X"
--   'manual'    — operator override, never overwritten
--
-- Written only by the backend; authenticated users read it.

CREATE TABLE IF NOT EXISTS brand_domains (
  brand_norm  text PRIMARY KEY,          -- normalized: lowercase, no accents/spaces
  brand_name  text NOT NULL,             -- one original spelling, for display/debug
  domain      text NOT NULL,             -- registrable domain, no www
  source      text NOT NULL DEFAULT 'llm' CHECK (source IN ('citations', 'llm', 'manual')),
  confidence  numeric,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE brand_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_domains_read" ON brand_domains;
CREATE POLICY "brand_domains_read"
  ON brand_domains FOR SELECT TO authenticated USING (true);

GRANT SELECT ON brand_domains TO authenticated;
