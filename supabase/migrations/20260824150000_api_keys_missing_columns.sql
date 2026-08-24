-- Align the api_keys table with the ApiKey ORM model.
--
-- The model (llmi_be/app/models/api_key.py) declares rate_limit, daily_limit,
-- max_prompts_per_job, total_requests, total_jobs and total_prompts, but the
-- prod table never had them. SQLAlchemy SELECTs exactly the model's columns,
-- so any request to a /api/v1/jobs* endpoint authenticated with a DB-backed
-- partner key (not the legacy master API_KEY) 500s with UndefinedColumn.
-- The columns are additive with sane defaults; existing rows backfill to 0 /
-- the documented defaults.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS rate_limit integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS max_prompts_per_job integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS total_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_jobs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_prompts integer NOT NULL DEFAULT 0;
