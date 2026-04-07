-- Sentiment Analysis V2: per-brand-per-response sentiment with cache + aliases
--
-- Replaces the single-row-per-response model on llm_responses with a
-- per-brand-per-response table that supports multi-brand scoring,
-- competitor sentiment, fallback tracking, and reasoning audit trail.
--
-- Additive migration: legacy llm_responses.sentiment_score / sentiment_label
-- columns are kept for backwards compat during rollout.

-- ── 1. Brand aliases for fuzzy matching ─────────────────────────────────
ALTER TABLE brands ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}';

-- ── 2. Per-brand-per-response sentiment table ───────────────────────────
CREATE TABLE IF NOT EXISTS response_brand_sentiment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id     uuid NOT NULL REFERENCES llm_responses(id) ON DELETE CASCADE,
  audit_id        uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  brand           text NOT NULL,
  brand_kind      text NOT NULL CHECK (brand_kind IN ('own', 'competitor')),
  label           text NOT NULL CHECK (label IN ('positive','neutral','negative','mention_only')),
  score           numeric NOT NULL CHECK (score >= -1 AND score <= 1),
  confidence      numeric CHECK (confidence >= 0 AND confidence <= 1),
  reasoning       text,
  is_fallback     boolean NOT NULL DEFAULT false,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, brand)
);

CREATE INDEX IF NOT EXISTS idx_rbs_audit_brand
  ON response_brand_sentiment(audit_id, brand);
CREATE INDEX IF NOT EXISTS idx_rbs_audit_kind
  ON response_brand_sentiment(audit_id, brand_kind);
CREATE INDEX IF NOT EXISTS idx_rbs_response
  ON response_brand_sentiment(response_id);

-- ── 3. Sentiment cache (dedup identical answer_text + brand_list calls) ─
CREATE TABLE IF NOT EXISTS sentiment_cache (
  cache_key     text PRIMARY KEY,
  result        jsonb NOT NULL,
  hit_count     int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sentiment_cache_last_used
  ON sentiment_cache(last_used_at);

-- ── 4. RLS — service role only (pipeline writes via asyncpg) ────────────
ALTER TABLE response_brand_sentiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentiment_cache ENABLE ROW LEVEL SECURITY;

-- Project members can read sentiment for their own audits
CREATE POLICY "Project members can read brand sentiment" ON response_brand_sentiment
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      JOIN projects p ON a.project_id = p.id
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = auth.uid()
      WHERE a.id = response_brand_sentiment.audit_id
        AND (p.created_by = auth.uid() OR pm.user_id IS NOT NULL)
    )
  );
