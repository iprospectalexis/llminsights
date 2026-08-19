-- Cost tracker pricing gaps.
--
-- gpt-5-nano never had rate rows → every competitors_extract /
-- domain_categorize / brand_domain_resolve event was recorded with
-- cost_usd = 0 while really costing ~$86/mo (dashboards under-reported the
-- OpenAI spend by ~75%). Also adds gpt-5.6-luna — the new competitors
-- extraction model (reasoning_effort=none).
--
-- unit_cost_usd is per TOKEN (mirrors the existing gpt-5-mini rows:
-- $/1M ÷ 1e6). Luna prices are the post-2026-07-30 cut: $0.20/$1.20 per 1M;
-- cached input assumed at the standard 90%-off ratio.

INSERT INTO api_pricing_rates (provider, model, operation, unit, unit_cost_usd)
VALUES
  ('openai', 'gpt-5-nano',   'chat', 'token_input',        0.00000005),
  ('openai', 'gpt-5-nano',   'chat', 'token_output',       0.00000040),
  ('openai', 'gpt-5-nano',   'chat', 'token_cached_input', 0.000000005),
  ('openai', 'gpt-5.6-luna', 'chat', 'token_input',        0.00000020),
  ('openai', 'gpt-5.6-luna', 'chat', 'token_output',       0.00000120),
  ('openai', 'gpt-5.6-luna', 'chat', 'token_cached_input', 0.00000002);
