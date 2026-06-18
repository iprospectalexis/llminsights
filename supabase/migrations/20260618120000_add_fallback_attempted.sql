-- Auto-fallback bookkeeping for llm_responses
--
-- When a source's rows exhaust polling with no data (poll_terminal_reason =
-- 'provider_no_response'), the pipeline re-triggers that source ONCE on an
-- alternate provider (Gemini -> DataForSEO, Perplexity -> BrightData) and
-- resets the rows to re-poll the new job. `fallback_attempted` is the loop
-- guard: a row can only fall back a single time, after which a second
-- exhaustion is terminal.
--
-- Fast & safe to apply on a large table: a constant-default column add is a
-- metadata-only operation in Postgres 11+ (no table rewrite), so it stays
-- well within run_migrations.py's 10s command_timeout.

ALTER TABLE llm_responses
  ADD COLUMN IF NOT EXISTS fallback_attempted boolean NOT NULL DEFAULT false;
