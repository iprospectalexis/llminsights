-- Cost reduction: backfill NULL llm_responses.raw_response_data for rows
-- that already have everything we need (competitors extracted, citations
-- column populated).
--
-- raw_response_data is the largest JSONB column on the largest table —
-- it stores the full provider response (with HTML scrubbed). After a
-- row reaches `extracting_competitors` and writes `answer_competitors`,
-- the raw payload is no longer needed:
--   - sentiment analysis reads answer_text
--   - citation rendering reads the `citations` / `links_attached` cols
--   - extract_competitors is a pure function of answer_text + known_brands
--
-- The ongoing pipeline change (in supabase_db.py:update_competitors_batch)
-- NULLs raw_response_data on every extracted row going forward. This
-- migration cleans up the backlog.
--
-- Guard: ``citations IS NOT NULL`` protects legacy BrightData rows that
-- never populated the citations column (their citations are still
-- embedded inside raw_response_data; the frontend extracts them at
-- render time as a fallback). OneSearch rows always populate citations
-- during polling, so they are safe to wipe.
--
-- Note on space reclaim: NULLing the column does not shrink the table
-- on disk — Postgres keeps the dead tuples and the TOAST blocks until
-- vacuumed. To reclaim space:
--   VACUUM FULL public.llm_responses;     -- exclusive lock, off-hours
-- OR
--   pg_repack --table=public.llm_responses  -- online, no lock
--
-- This migration only NULLs the values; the operator runs the reclaim
-- step manually after verifying nothing broke.

UPDATE public.llm_responses
SET raw_response_data = NULL
WHERE answer_competitors IS NOT NULL
  AND raw_response_data IS NOT NULL
  AND citations IS NOT NULL;
