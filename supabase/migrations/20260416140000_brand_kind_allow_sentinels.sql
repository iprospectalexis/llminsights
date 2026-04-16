-- Allow brand_kind='none' for sentinel rows in response_brand_sentiment.
--
-- The handler inserts sentinel rows with brand='__none__' (no brands detected),
-- brand='__error__' (batch item raised), or brand='__stuck__' (force-skip) to
-- satisfy the NOT EXISTS (response_brand_sentiment) idempotency filter in
-- get_responses_for_sentiment_v2. Without this, when a response has no brands
-- or a batch item errors, the row never gets an entry in this table and the
-- audit loops forever in analyzing_sentiment.
--
-- The original CHECK constraint only allowed ('own', 'competitor'), so every
-- sentinel INSERT failed with a check-violation and the whole batch aborted.
-- Dashboards already filter these rows via brand IN ('__none__', '__error__',
-- '__stuck__') / is_fallback=TRUE, so 'none' is semantically correct and safe.

ALTER TABLE response_brand_sentiment
  DROP CONSTRAINT IF EXISTS response_brand_sentiment_brand_kind_check;

ALTER TABLE response_brand_sentiment
  ADD CONSTRAINT response_brand_sentiment_brand_kind_check
    CHECK (brand_kind IN ('own', 'competitor', 'none'));
