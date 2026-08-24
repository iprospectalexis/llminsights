-- ═══════════════════════════════════════════════════════════════════════
-- Defense-in-depth: audits.status ↔ audits.pipeline_state consistency
-- ═══════════════════════════════════════════════════════════════════════
--
-- Problem:
-- -------
-- The `onesearch-webhook`, `poll-audit-results` and `reprocess-audit-results`
-- edge functions used to write `audits.status = 'completed'` without also
-- setting `pipeline_state`. The Python pipeline worker, meanwhile, advances
-- audits through its own state machine via `pipeline_state`. When the webhook
-- path raced against the Python path (which happens for every OneSearch-backed
-- audit with sentiment=true), the webhook would mark the audit completed
-- while `pipeline_state` was still 'created' / 'polling' / etc. The Python
-- worker then refused to touch it (it filters by `pipeline_state`), which
-- meant the `analyzing_sentiment` and `finalizing` handlers never ran and
-- `response_brand_sentiment` stayed empty — the Sentiment tab and /mentions
-- page showed "No sentiment data yet" despite hundreds of llm_responses.
--
-- We audited and found 10 such zombie audits across 2 days. This migration
-- does two things:
--
--   1. REPAIR existing zombies so `status` and `pipeline_state` are
--      consistent. The only safe repair here is to push `pipeline_state`
--      forward to 'completed' — we cannot retroactively demote `status`
--      because metrics/reports may already have been computed on top of it.
--      Sentiment V2 backfill for each individual zombie is a separate,
--      opt-in data-repair step (see `backfill_dazn_sentiment.py` for the
--      pattern).
--
--   2. ENFORCE the invariant at the database level via a CHECK constraint,
--      so that any future code path that tries to set status='completed'
--      without also advancing pipeline_state will fail fast with a clear
--      error instead of silently corrupting data.
--
-- The constraint is added VALID (not NOT VALID), because step 1 eliminates
-- all existing violations. If the VALIDATE fails, the migration aborts
-- and nothing is committed — which is exactly what we want.
--
-- The three edge functions have been patched in the same commit (see
-- supabase/functions/{onesearch-webhook,poll-audit-results,reprocess-audit-results}/
-- index.ts) so that after this migration is applied AND the functions are
-- redeployed, no new zombies can be created.

BEGIN;

-- ── Step 1: repair existing zombies ────────────────────────────────────
-- Log which rows we're about to touch so the migration is audit-traceable.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM audits
  WHERE status = 'completed'
    AND pipeline_state NOT IN ('completed', 'failed');

  RAISE NOTICE
    'audits_status_pipeline_state_consistency: repairing % zombie audits',
    v_count;
END
$$;

UPDATE audits
SET pipeline_state = 'completed'
WHERE status = 'completed'
  AND pipeline_state NOT IN ('completed', 'failed');

-- ── Step 2: add the CHECK constraint ──────────────────────────────────
-- `status = 'completed'` now implies `pipeline_state IN ('completed','failed')`.
-- The 'failed' case covers the scenario where the Python pipeline gave up
-- after an unrecoverable error and a human operator marked the audit
-- 'completed' from the admin UI to exit the retry loop.
ALTER TABLE audits
  ADD CONSTRAINT audits_status_pipeline_state_consistent
  CHECK (
    status <> 'completed'
    OR pipeline_state IN ('completed', 'failed')
  );

COMMENT ON CONSTRAINT audits_status_pipeline_state_consistent ON audits IS
  'Prevents zombie audits: status=completed requires pipeline_state to also '
  'reach a terminal state (completed or failed). See migration '
  '20260409200000 for context.';

COMMIT;
