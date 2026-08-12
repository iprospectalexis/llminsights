-- Per-project LLM selection for scheduled audits.
--
-- Scheduled audits always ran with the hardcoded default (searchgpt +
-- perplexity): the backend scheduler built RunAuditRequest without `llms`,
-- and the schedule settings UI had no LLM picker. This column stores the
-- project's choice; NULL (or empty) keeps the historical default, so existing
-- schedules behave exactly as before.
--
-- Constant-default-free column add: metadata-only, safe under the 10s
-- migration timeout.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS schedule_llms text[];
