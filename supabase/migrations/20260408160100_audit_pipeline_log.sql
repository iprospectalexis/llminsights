-- Lightweight insert-only log of pipeline crashes and notable events.
--
-- Decouples observability from `audits.error_message` (single mutable
-- field that loses history on the next crash). Every CRASH @ phase from
-- `handle_polling` / `process_step` writes one row here, so the operator
-- can answer "what's wrong with audit X" with one SELECT, no log diving:
--
--   SELECT created_at, state, phase, level, message
--   FROM audit_pipeline_log
--   WHERE audit_id = '...'
--   ORDER BY created_at DESC LIMIT 50;
--
-- Insert-only by design — never UPDATE, never DELETE — so nothing in
-- the application path can corrupt the journal.

CREATE TABLE IF NOT EXISTS audit_pipeline_log (
  id          bigserial   PRIMARY KEY,
  audit_id    uuid        NOT NULL,
  state       text        NOT NULL,
  phase       text        NOT NULL,
  level       text        NOT NULL DEFAULT 'error',
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_pipeline_log_audit_idx
  ON audit_pipeline_log (audit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_pipeline_log_recent_idx
  ON audit_pipeline_log (created_at DESC)
  WHERE level <> 'info';
