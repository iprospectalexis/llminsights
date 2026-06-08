-- Cost tracking: add a DataForSEO scrape rate.
--
-- DataForSEO's SERP google/organic/live/advanced with load_async_ai_overview
-- bills per keyword (per task). The sample response reported cost=$0.0075
-- for one keyword, so we seed that as the per-prompt rate. The backend
-- cost_tracker looks up rates by (provider, operation, unit); the audit
-- job-trigger path records one `prompt` unit per prompt with
-- provider='dataforseo' (from the LLM provider_config), so this row makes
-- those events cost-attributed instead of $0.
--
-- Adjust unit_cost_usd here whenever DataForSEO pricing changes — the
-- backend cache (5 min TTL) picks new values up automatically.

INSERT INTO api_pricing_rates(provider, model, operation, unit, unit_cost_usd, notes)
VALUES
  ('dataforseo', NULL, 'scrape', 'prompt', 0.00750000,
   '~$0.0075 per keyword for SERP google/organic/live/advanced + load_async_ai_overview (confirm with real billing)');
