-- Avalanche mode: N runs of every prompt per LLM in one audit.
--
--   llm_responses.run_index  — which run (1..N) a row belongs to. All
--     historical rows are run 1 via the default.
--   citations.run_index      — citations are persisted per run; the polling
--     delete+insert cycle keys on (audit_id, prompt_id, llm, run_index) so
--     concurrent runs can't wipe or duplicate each other's citations.
--   audits.runs_per_prompt   — 1 for normal audits, 3 for Avalanche. Lets the
--     UI/metrics know the denominator semantics.
--
-- Cost design (per the N-runs objectivity plan): competitor extraction
-- (gpt-5-nano, cheap) runs on ALL runs so mention metrics use one uniform
-- instrument across runs; sentiment (gpt-5-mini, the expensive call) runs on
-- run 1 only — see get_responses_for_sentiment_v2.
--
-- Constant defaults → metadata-only ALTERs, safe under the migration timeout.

ALTER TABLE llm_responses
  ADD COLUMN IF NOT EXISTS run_index smallint NOT NULL DEFAULT 1;

ALTER TABLE citations
  ADD COLUMN IF NOT EXISTS run_index smallint NOT NULL DEFAULT 1;

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS runs_per_prompt smallint NOT NULL DEFAULT 1;
