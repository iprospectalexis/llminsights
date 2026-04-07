-- Add error_message column to audits.
--
-- This column has been written to by the Python pipeline since commit
-- c440918 (auto-fail sweep), 4812a6f (process_step except blocks) and
-- 442cb0e (handle_polling terminal sweeps), but the column was never
-- actually added to the schema. Every UPDATE that touched it raised
-- 42703 and was silently swallowed by `try: ... except: pass` blocks,
-- which means:
--
--   1. The 60-min auto-fail sweep was a no-op on prod (its UPDATE
--      contained `error_message = COALESCE(error_message, ...)` which
--      rolled back the whole statement on 42703).
--   2. We had no operator-visible cause for any stuck audit since
--      c440918 — every "stuck" investigation required log archaeology.
--
-- After this migration both paths start working.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS error_message text;
