-- OpenAI Batch API for scheduled audits (50% pricing).
--
--   audits.is_scheduled         — set by run_audit from the scheduler flag;
--                                 gates the batch path (manual audits stay on
--                                 live calls for fast feedback).
--   audits.competitors_batch_id — OpenAI batch id while the extraction batch
--                                 is in flight; literal 'applied' once its
--                                 results are written (stragglers then fall
--                                 through to the live path).
--   audits.sentiment_batch_id   — same, for the sentiment stage.
--
-- Constant defaults → metadata-only ALTER.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS is_scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS competitors_batch_id text,
  ADD COLUMN IF NOT EXISTS sentiment_batch_id text;
