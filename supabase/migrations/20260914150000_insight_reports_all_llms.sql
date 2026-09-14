-- insight_reports.target_llm only allowed the three original LLMs; the
-- Insights page offers every LLM the project audits, so a Google AI Mode /
-- AI Overview / Bing Copilot / Grok report failed at INSERT with
-- "violates check constraint insight_reports_target_llm_check" (2026-09-14).

ALTER TABLE insight_reports DROP CONSTRAINT IF EXISTS insight_reports_target_llm_check;
ALTER TABLE insight_reports ADD CONSTRAINT insight_reports_target_llm_check
  CHECK (target_llm IN (
    'searchgpt', 'perplexity', 'gemini',
    'google-ai-overview', 'google-ai-mode', 'bing-copilot', 'grok'
  ));
