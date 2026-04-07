-- Per-row polling state for llm_responses
--
-- Decouples audit-level forward progress from row-level provider failures.
-- Once `poll_terminal_reason` is set, the row is no longer "actively pending"
-- even if both data columns are still NULL — the polling handler can
-- transition the audit out of `polling` without that row blocking it.
--
-- Reasons used by `app/services/audit_pipeline.py:handle_polling`:
--   provider_no_response  — exhausted attempts, provider never delivered
--   provider_dropped      — provider returned data but not for this prompt
--   provider_error        — provider returned an error consistently
--   polling_timeout       — global audit deadline reached
--   orphan_no_job_id      — neither job_id nor snapshot_id was set on insert
--   polling_giveup        — manual fail

ALTER TABLE llm_responses
  ADD COLUMN IF NOT EXISTS poll_attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_polled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_polled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS poll_terminal_reason text;

-- Partial index used by `get_active_pending_responses` to skip recently-polled
-- rows quickly without scanning the whole table.
CREATE INDEX IF NOT EXISTS llm_responses_poll_idx
  ON llm_responses (audit_id, last_polled_at NULLS FIRST)
  WHERE answer_text IS NULL
    AND raw_response_data IS NULL
    AND poll_terminal_reason IS NULL;
