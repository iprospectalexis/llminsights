"""
backfill_dazn_sentiment.py

One-shot sentiment backfill for DAZN audit c18a6cdd.

Why: the legacy force-complete cron flipped audit.status to 'completed' while
pipeline_state was still 'created'. The LLM-fetch + citation extraction had
already run (480 llm_responses with answer_text, 4989 citations), but
analyzing_sentiment never executed — response_brand_sentiment = 0.
Because status='completed' + finished_at is now set, the Python pipeline
worker will never pick this audit up again. Hence: standalone re-run.

What it does:
  1. Imports the real `app.services` sentiment code from llmi_be so we run
     the exact same logic the pipeline would have — same model, same
     prompt version, same cache, same brand detection, same rbs schema.
     No duplication, no drift.
  2. Fetches pending rows via db.get_responses_for_sentiment_v2 (idempotent:
     if a row already has rbs entries, it's skipped).
  3. Iterates in batches of 10, writes rbs + legacy llm_responses.sentiment_*.
  4. Updates stale audits counters (responses_expected/received,
     sentiment_total/processed) so the UI shows real numbers.
  5. Does NOT touch pipeline_state, status, or finished_at. Audit stays
     'completed' — this is a pure data repair.

DATABASE_URL_OVERRIDE is forced to the Supabase POOLER endpoint because
the configured `db.<ref>.supabase.co` is IPv6-only and not reachable from
this host (same problem that broke the backend container).

Requires: OPENAI_API_KEY in env (inherited from llmi_be/.env).

Usage:
    python backfill_dazn_sentiment.py
    python backfill_dazn_sentiment.py --apply
"""
from __future__ import annotations

# ── Force the pooler DSN BEFORE importing app.config (it caches). ─────────
import os
os.environ["DATABASE_URL_OVERRIDE"] = (
    "postgresql+asyncpg://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)

import argparse
import asyncio
import sys
from pathlib import Path

# Make llmi_be importable from the repo root.
REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / "llmi_be"))

from sqlalchemy import text  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.services import openai_client  # noqa: E402
from app.services.brand_matcher import BrandSpec, detect_brands_in_text  # noqa: E402
from app.services.supabase_db import db  # noqa: E402
from app.services.audit_pipeline import (  # noqa: E402
    _sentiment_cache_key,
    _legacy_summary_label,
)

AUDIT_ID = "c18a6cdd-be3b-4e3e-bf0c-7edc08e2cc35"
PROJECT_ID = "1606c700-6c73-4f97-b303-592fa38f214f"
BATCH_SIZE = 10


async def _count_rbs(audit_id: str) -> int:
    async with AsyncSessionLocal() as s:
        row = (await s.execute(
            text("SELECT count(*) AS n FROM response_brand_sentiment WHERE audit_id = :a"),
            {"a": audit_id},
        )).mappings().first()
    return int(row["n"])


async def _update_audit_counters(
    audit_id: str,
    responses_expected: int,
    responses_received: int,
    sentiment_total: int,
    sentiment_processed: int,
) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("""
                UPDATE audits
                SET responses_expected = :re,
                    responses_received = :rr,
                    sentiment_total    = :st,
                    sentiment_processed = :sp
                WHERE id = :aid
            """),
            {
                "aid": audit_id,
                "re": responses_expected,
                "rr": responses_received,
                "st": sentiment_total,
                "sp": sentiment_processed,
            },
        )
        await s.commit()


async def main(apply: bool) -> int:
    print("=" * 72)
    print(f"DAZN sentiment backfill — audit {AUDIT_ID[:8]}")
    print(f"DSN: {os.environ['DATABASE_URL_OVERRIDE'].split('@')[1]}")
    print(f"mode: {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 72)

    # ── Sanity checks ─────────────────────────────────────────────────────
    audit = await db.get_audit(AUDIT_ID)
    if not audit:
        print(f"  ERROR: audit {AUDIT_ID} not found")
        return 1
    print(f"  audit status={audit.get('status')} "
          f"pipeline_state={audit.get('pipeline_state')} "
          f"sentiment_flag={audit.get('sentiment')}")
    if not audit.get("sentiment"):
        print("  ERROR: sentiment flag is disabled on this audit. Aborting.")
        return 1

    own_specs, comp_specs = await db.get_brand_specs(AUDIT_ID)
    print(f"  brands: own={len(own_specs)} competitor={len(comp_specs)}")
    if not own_specs and not comp_specs:
        print("  ERROR: no brands configured on project. Aborting.")
        return 1
    own_set = {s["name"] for s in own_specs}
    all_specs = [
        BrandSpec(name=s["name"], aliases=s["aliases"])
        for s in (own_specs + comp_specs)
    ]

    pending = await db.get_responses_for_sentiment_v2(AUDIT_ID)
    print(f"  pending responses (no rbs yet): {len(pending)}")
    rbs_before = await _count_rbs(AUDIT_ID)
    print(f"  rbs rows currently in DB: {rbs_before}")

    if not pending:
        print()
        print("  nothing to backfill — every response already has rbs rows.")
        # Still fix stale counters even on empty backfill.
        if apply:
            total_responses = pending_from_count = None
            async with AsyncSessionLocal() as s:
                row = (await s.execute(
                    text("""
                        SELECT
                          (SELECT count(*) FROM llm_responses WHERE audit_id = :a) AS total,
                          (SELECT count(*) FROM llm_responses
                            WHERE audit_id = :a AND answer_text IS NOT NULL) AS with_ans,
                          (SELECT count(DISTINCT lr.id)
                             FROM llm_responses lr
                             JOIN response_brand_sentiment rbs ON rbs.response_id = lr.id
                            WHERE lr.audit_id = :a) AS with_rbs
                    """),
                    {"a": AUDIT_ID},
                )).mappings().first()
            await _update_audit_counters(
                AUDIT_ID,
                responses_expected=int(row["total"]),
                responses_received=int(row["with_ans"]),
                sentiment_total=int(row["with_ans"]),
                sentiment_processed=int(row["with_rbs"]),
            )
            print("  counters updated.")
        return 0

    project_name = await db.get_project_name(AUDIT_ID) or ""
    _, project_id, _ = await db.get_own_brands(AUDIT_ID)
    cost_ctx = {
        "audit_id": AUDIT_ID,
        "project_id": project_id,
        "user_id": None,  # standalone run — no user attribution
    }
    print(f"  project_name={project_name!r}")
    print()

    if not apply:
        # Sample 3 rows to show what brand detection will pick up.
        print("DRY-RUN — brand-detection preview on first 3 responses:")
        for i, r in enumerate(pending[:3]):
            detected = detect_brands_in_text(r.get("answer_text") or "", all_specs)
            print(f"  [{i}] {str(r['id'])[:8]} llm={r['llm']} "
                  f"answer_len={len(r.get('answer_text') or '')} "
                  f"detected={detected}")
        print()
        print(f"Would process {len(pending)} responses in batches of {BATCH_SIZE}.")
        print(f"Model: {openai_client.MODEL}  "
              f"prompt_version: {openai_client.SENTIMENT_PROMPT_VERSION}")
        print()
        print("Rerun with --apply to write.")
        return 0

    # ── Apply path ────────────────────────────────────────────────────────
    print(f"Processing {len(pending)} responses in batches of {BATCH_SIZE}...")
    print(f"Model: {openai_client.MODEL}  "
          f"version: {openai_client.SENTIMENT_PROMPT_VERSION}")
    print()

    processed = 0
    skipped_no_brand = 0
    rbs_written = 0
    cache_hits = 0
    api_calls = 0
    errors = 0

    async def process_one(resp: dict) -> tuple[list[dict], list[dict], str]:
        """Returns (rbs_rows, legacy_updates, reason). reason in {'ok','no_brand','cache','error'}."""
        nonlocal cache_hits, api_calls
        answer_text = resp.get("answer_text") or ""
        detected = detect_brands_in_text(answer_text, all_specs)
        if not detected:
            return [], [], "no_brand"

        cache_key = _sentiment_cache_key(
            answer_text,
            detected,
            openai_client.MODEL,
            openai_client.SENTIMENT_PROMPT_VERSION,
        )
        cached = await db.get_sentiment_cache(cache_key)
        if cached and isinstance(cached, dict) and "brands" in cached:
            result = cached
            cache_hits += 1
            reason = "cache"
        else:
            result = await openai_client.analyze_response_sentiment(
                prompt_text=resp.get("prompt_text") or "",
                answer_text=answer_text,
                brands_to_score=detected,
                industry=project_name,
                _ctx=cost_ctx,
            )
            api_calls += 1
            if not result.get("_fallback"):
                await db.put_sentiment_cache(cache_key, result)
            reason = "ok"

        is_fallback = bool(result.get("_fallback"))
        rbs_rows: list[dict] = []
        for b in result.get("brands", []):
            rbs_rows.append({
                "response_id": str(resp["id"]),
                "audit_id": AUDIT_ID,
                "brand": b["brand"],
                "brand_kind": "own" if b["brand"] in own_set else "competitor",
                "label": b["label"],
                "score": b["score"],
                "confidence": b.get("confidence"),
                "reasoning": b.get("reasoning"),
                "is_fallback": is_fallback,
                "model": openai_client.MODEL,
                "prompt_version": openai_client.SENTIMENT_PROMPT_VERSION,
            })
        score, label = _legacy_summary_label(rbs_rows)
        legacy = [{"id": str(resp["id"]), "score": score, "label": label}]
        return rbs_rows, legacy, reason

    for i in range(0, len(pending), BATCH_SIZE):
        batch = pending[i:i + BATCH_SIZE]
        try:
            results = await asyncio.gather(
                *(process_one(r) for r in batch),
                return_exceptions=True,
            )
            flat_rbs: list[dict] = []
            flat_legacy: list[dict] = []
            for r in results:
                if isinstance(r, Exception):
                    errors += 1
                    print(f"    [ERR] {r}")
                    continue
                rbs_rows, legacy, reason = r
                if reason == "no_brand":
                    skipped_no_brand += 1
                flat_rbs.extend(rbs_rows)
                flat_legacy.extend(legacy)
                rbs_written += len(rbs_rows)

            if flat_rbs:
                await db.upsert_response_brand_sentiment(flat_rbs)
            if flat_legacy:
                await db.update_sentiment_batch(flat_legacy)
        except Exception as e:
            errors += len(batch)
            print(f"  batch {i // BATCH_SIZE} failed: {e}")

        processed = min(i + BATCH_SIZE, len(pending))
        print(f"  batch {i // BATCH_SIZE + 1}/{(len(pending) + BATCH_SIZE - 1) // BATCH_SIZE}: "
              f"processed={processed}/{len(pending)}  rbs_written={rbs_written}  "
              f"cache_hits={cache_hits}  api_calls={api_calls}  errors={errors}")

    print()
    print("=" * 72)
    print("Done. Updating stale audit counters...")
    print("=" * 72)

    async with AsyncSessionLocal() as s:
        row = (await s.execute(
            text("""
                SELECT
                  (SELECT count(*) FROM llm_responses WHERE audit_id = :a) AS total,
                  (SELECT count(*) FROM llm_responses
                    WHERE audit_id = :a AND answer_text IS NOT NULL) AS with_ans,
                  (SELECT count(DISTINCT lr.id)
                     FROM llm_responses lr
                     JOIN response_brand_sentiment rbs ON rbs.response_id = lr.id
                    WHERE lr.audit_id = :a) AS with_rbs,
                  (SELECT count(*) FROM response_brand_sentiment WHERE audit_id = :a) AS rbs_total
            """),
            {"a": AUDIT_ID},
        )).mappings().first()

    print(f"  llm_responses total       = {row['total']}")
    print(f"  llm_responses w/ answer   = {row['with_ans']}")
    print(f"  responses with rbs        = {row['with_rbs']}")
    print(f"  response_brand_sentiment  = {row['rbs_total']}")

    await _update_audit_counters(
        AUDIT_ID,
        responses_expected=int(row["total"]),
        responses_received=int(row["with_ans"]),
        sentiment_total=int(row["with_ans"]),
        sentiment_processed=int(row["with_rbs"]),
    )
    print("  counters updated on audits row.")

    print()
    print("Summary:")
    print(f"  processed        {processed}")
    print(f"  rbs rows written {rbs_written}")
    print(f"  cache hits       {cache_hits}")
    print(f"  openai calls     {api_calls}")
    print(f"  no brand detected {skipped_no_brand}")
    print(f"  errors           {errors}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill sentiment_v2 on DAZN audit c18a6cdd."
    )
    parser.add_argument("--apply", action="store_true",
                        help="Actually call OpenAI + write rbs rows. Default dry-run.")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(apply=args.apply)))
