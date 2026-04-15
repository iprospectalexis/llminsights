"""
Audit Pipeline — State machine executor for robust, server-side audit processing.

Each audit progresses through a linear state machine:
  created → fetching → polling → extracting_competitors → analyzing_sentiment → finalizing → completed

Design principles:
  - Single-owner: CAS (Compare-And-Swap) transitions prevent race conditions
  - Checkpointed: each batch of work is saved immediately, crash-safe
  - Idempotent: handlers query for unprocessed items, so re-runs skip done work
  - Observable: progress counters updated after every batch
"""

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.config import get_settings
from app.services.supabase_db import db
from app.services import openai_client
from app.services.brand_matcher import BrandSpec, detect_brands_in_text

logger = logging.getLogger(__name__)
settings = get_settings()

# Unique worker ID for this server instance (prevents multi-instance conflicts)
WORKER_ID = str(uuid.uuid4())[:8]

# ── State transitions ────────────────────────────────────────────────

VALID_TRANSITIONS = {
    "fetching": "polling",
    "created": "polling",
    "polling": "extracting_competitors",
    "extracting_competitors": "analyzing_sentiment",
    "analyzing_sentiment": "finalizing",
    "finalizing": "completed",
}


async def try_claim(audit_id: str, worker_id: str) -> bool:
    """Try to claim an audit for processing (CAS lock)."""
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        result = await s.execute(text("""
            UPDATE audits
            SET locked_by = :worker, locked_at = now()
            WHERE id = :id
              AND (locked_by IS NULL OR locked_by = :worker
                   OR locked_at < now() - interval '5 minutes')
            RETURNING id
        """), {"id": audit_id, "worker": worker_id})
        await s.commit()
        return result.first() is not None


async def release(audit_id: str, worker_id: str) -> None:
    """Release the lock on an audit."""
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE audits SET locked_by = NULL, locked_at = NULL
            WHERE id = :id AND locked_by = :worker
        """), {"id": audit_id, "worker": worker_id})
        await s.commit()


async def transition_state(audit_id: str, from_state: str, to_state: str,
                           worker_id: str) -> bool:
    """Atomic state transition — returns True only if WE made the change."""
    from app.database import AsyncSessionLocal
    from sqlalchemy import text

    # Also update the legacy current_step for backward compat
    legacy_step_map = {
        "polling": "getting_results",
        "extracting_competitors": "processing_results",
        "analyzing_sentiment": "sentiment_analysis",
        "finalizing": "completing",
        "completed": None,
        "failed": None,
        "created": None,
    }

    async with AsyncSessionLocal() as s:
        result = await s.execute(text("""
            UPDATE audits
            SET pipeline_state = :to_state,
                current_step = :legacy_step,
                locked_at = now(),
                last_activity_at = now()
            WHERE id = :id
              AND pipeline_state = :from_state
              AND (locked_by IS NULL OR locked_by = :worker)
            RETURNING id
        """), {
            "id": audit_id,
            "to_state": to_state,
            "from_state": from_state,
            "worker": worker_id,
            "legacy_step": legacy_step_map.get(to_state),
        })
        await s.commit()
        return result.first() is not None


async def fail_audit(audit_id: str, reason: str) -> None:
    """Mark audit as failed."""
    now = datetime.now(timezone.utc)
    await db.update_audit(audit_id, {
        "status": "failed",
        "pipeline_state": "failed",
        "current_step": None,
        "finished_at": now,
        "locked_by": None,
        "locked_at": None,
    })
    logger.error(f"Audit {audit_id} FAILED: {reason}")


async def update_progress_counters(audit_id: str, **kwargs) -> None:
    """Update granular progress counters on the audit record."""
    await db.update_audit(audit_id, kwargs)


async def _heartbeat(audit_id: str) -> None:
    """Bump `last_activity_at` so the scheduler knows we're still alive.

    Called after every successful batch in long-running handlers
    (`handle_competitors`, `handle_sentiment`). Without this, long but healthy
    work would (a) be re-queued aggressively by the fair scheduler order
    (`COALESCE(last_activity_at, started_at)`) and (b) risk being killed by
    the 60-min auto-fail sweep even though it is making progress.
    """
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE audits SET last_activity_at = now() WHERE id = :id"),
                {"id": audit_id},
            )
            await s.commit()
    except Exception as e:
        logger.warning(f"[pipeline] {audit_id}: heartbeat failed: {e}")


# ── Step handlers ────────────────────────────────────────────────────

# Global per-audit safety net. The per-row exhaustion (MAX_POLL_ATTEMPTS_PER_ROW
# below) usually fires first; this is the back-stop for audits where the row
# state machine somehow drifted (e.g. clock skew, lost updates).
#
# 2026-04-08: bumped from 10 → 90 after Balenciaga_AUDIT_FR_non branded lost
# all 145 SearchGPT rows to a premature `polling_timeout` sweep. OneSearch
# processes SearchGPT as a single batch job spanning every prompt in the
# audit, and for 100+ prompts that batch can easily take 30–60 minutes to
# complete. 10 min was shorter than the provider's own latency — perplexity
# happened to finish inside the window and survived, searchgpt did not.
# 90 min gives real headroom (provider SLA is ~60 min worst-case for 200
# prompts) while still cutting off audits that have genuinely drifted.
POLLING_MAX_MINUTES = 90

# Per-row exhaustion. After this many polling attempts on a single row, mark
# it `provider_no_response` so it stops blocking the audit. With a 15s tick,
# 8 attempts ≈ 2 min of provider unresponsiveness before we give up on a row.
MAX_POLL_ATTEMPTS_PER_ROW = 8

# Don't re-poll the same row faster than this. Prevents hammering the
# provider when the scheduler tick interval drops or warm-starts overlap.
MIN_POLL_INTERVAL_SECONDS = 5

# Hard ceiling on a single handler invocation. If a handler hangs (slow OpenAI
# response, network stall, etc.) `process_step` aborts via `asyncio.wait_for`
# so the scheduler slot is freed and other audits keep moving. Must be longer
# than the slowest healthy step. With the bounded-batch handlers below, a
# single invocation processes at most ~50 responses, so 600s is generous.
PER_STEP_TIMEOUT_SECONDS = 1800  # 30 min — 600s was too tight for 200+ response audits

# Maximum number of outer batches a single handler invocation will process
# before yielding back to the scheduler. Keeps `extracting_competitors` and
# `analyzing_sentiment` forward-progress safe: each tick makes a measurable,
# checkpointed amount of progress and writes a heartbeat, instead of trying
# to do hundreds of responses inside a single wait_for budget.
MAX_BATCHES_PER_INVOCATION = 40  # = 800 responses with batch_size=20 (fits in 1800s timeout)


async def handle_fetching(audit_id: str, worker_id: str) -> None:
    """
    Recovery handler for audits stuck in `pipeline_state='fetching'`.

    The `run_audit` endpoint sets 'fetching' and launches `_trigger_jobs` as a
    BackgroundTask. If that background task crashes (connection error, OOM,
    worker restart) before transitioning to 'polling', the audit is invisible
    to the main scheduler and rots until the 60-min auto-fail sweep.

    Strategy:
      - If `llm_responses` rows already exist → transition to 'polling'.
        The polling handler is idempotent and will pick up from there.
      - If 0 responses and audit is older than 5 min → fail (trigger never ran).
      - Otherwise → do nothing; the background task may still be running.
    """
    all_responses = await db.get_all_responses_for_audit(audit_id)

    if all_responses:
        logger.warning(
            f"[pipeline] {audit_id}: recovering from 'fetching' state "
            f"({len(all_responses)} responses found) → polling"
        )
        transitioned = await transition_state(audit_id, "fetching", "polling", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: fetching → polling (recovery)")
        else:
            logger.warning(f"[pipeline] {audit_id}: CAS fetching→polling failed (will retry)")
        return

    # No responses yet — check how old the audit is
    audit_row = await db.get_audit(audit_id)
    anchor = (audit_row or {}).get("started_at") or (audit_row or {}).get("created_at")
    if isinstance(anchor, str):
        try:
            anchor = datetime.fromisoformat(anchor.replace("Z", "+00:00"))
        except ValueError:
            anchor = None

    if anchor and (datetime.now(timezone.utc) - anchor) > timedelta(minutes=5):
        logger.error(
            f"[pipeline] {audit_id}: stuck in 'fetching' with 0 responses "
            f"for >5 min — background trigger never completed, failing"
        )
        await fail_audit(
            audit_id,
            "Stuck in 'fetching' with no llm_responses — job trigger task crashed"
        )
        return

    # < 5 min and no responses: background task may still be running, skip.
    logger.info(
        f"[pipeline] {audit_id}: in 'fetching' with 0 responses, "
        f"waiting for background trigger task to finish"
    )


async def handle_created(audit_id: str, worker_id: str) -> None:
    """
    Recovery handler for audits stuck in `pipeline_state='created'`.

    These audits were created by a path that didn't set `pipeline_state`
    (e.g. the legacy `process_scheduled_audits_direct` SQL cron, or a
    direct INSERT). Without this handler they would sit invisible to the
    main scheduler forever and eventually be force-completed by legacy
    cleanup crons — losing all competitor + sentiment data.

    Strategy:
      - If `llm_responses` rows already exist for this audit → transition
        to `polling`. The polling handler is idempotent and will fast-
        forward to `extracting_competitors` once it sees all answers are in.
      - If 0 responses exist → mark the audit as failed (it was never
        properly initialised; nothing to recover).
    """
    all_responses = await db.get_all_responses_for_audit(audit_id)
    if not all_responses:
        logger.error(
            f"[pipeline] {audit_id}: stuck in 'created' with 0 llm_responses — "
            "no jobs were ever triggered, marking failed"
        )
        await fail_audit(audit_id, "abandoned in 'created' state with no responses")
        return

    logger.warning(
        f"[pipeline] {audit_id}: recovering from 'created' state "
        f"({len(all_responses)} responses found) → polling"
    )
    transitioned = await transition_state(audit_id, "created", "polling", worker_id)
    if transitioned:
        logger.info(f"[pipeline] {audit_id}: created → polling (recovery)")


async def handle_polling(audit_id: str, worker_id: str) -> None:
    """Bounded, per-row resumable polling.

    Source of truth is `db.get_polling_status(audit_id)`. A row leaves the
    "active_pending" set in exactly three ways:
      1. `answer_text` populated by a successful fetch (upsert_llm_responses)
      2. `raw_response_data` populated by a successful or partial fetch
      3. `poll_terminal_reason` set by an exhaustion sweep
            (provider_no_response, provider_dropped, provider_error,
             polling_timeout, orphan_no_job_id, polling_giveup)

    Single transition path: only the `active_pending == 0` branch advances
    the audit out of `polling`. Everything else just makes per-row progress
    and returns to the scheduler.
    """
    from app.api.v1.endpoints.audits import (
        fetch_onesearch_results, _fetch_brightdata_result, collect_citations
    )

    # `phase` tracks where in the handler we currently are. On any uncaught
    # exception the outer except block uses it to write a precise crash
    # record to logs + `audits.error_message` + `audit_pipeline_log`. This
    # is the *only* line of defense between a SQL helper crash and a
    # silently-stuck audit (see incident: 2026-04-08, mark_polling_terminal
    # crashing on `CAST(:ids AS uuid[])` for 40 minutes with no trace).
    phase = "enter"
    try:
        phase = "heartbeat_in"
        await _heartbeat(audit_id)

        phase = "step_running"
        try:
            await db.update_audit_step(audit_id, "parse", {
                "status": "running", "message": "Polling for LLM results..."
            })
        except Exception as e:
            logger.warning(f"[polling] {audit_id} step_running ignored: {e}")

        # ── Source of truth: SQL counts ─────────────────────────────────
        phase = "get_polling_status"
        status = await db.get_polling_status(audit_id)
        total          = status["total"]
        received       = status["received"]
        active_pending = status["active_pending"]
        terminal       = status["terminal"]
        max_attempts   = status["max_attempts"]

        phase = "update_progress_counters"
        progress_pct = min(round(((received) / total) * 60) if total else 0, 60)
        await update_progress_counters(
            audit_id,
            responses_expected=total,
            responses_received=received,
            progress=progress_pct,
        )

        phase = "log_summary"
        logger.info(
            f"[polling] {audit_id} total={total} received={received} "
            f"active={active_pending} terminal={terminal} max_attempts={max_attempts}"
        )

        # ── Branch 1: nothing left to actively poll → single transition ─
        phase = "branch_active_zero"
        if total > 0 and active_pending == 0:
            # Safety net: if ALL responses were "received" but NONE have
            # answer_text, the audit has no usable data (e.g. all OneSearch
            # triggers failed). Fail instead of running an empty pipeline.
            phase = "branch_active_zero_answer_check"
            answer_count_row = await db.execute_scalar(
                "SELECT count(*) FROM llm_responses "
                "WHERE audit_id = :aid AND answer_text IS NOT NULL",
                {"aid": audit_id},
            )
            answer_count = answer_count_row or 0
            if answer_count == 0:
                logger.error(
                    f"[polling] {audit_id}: 0/{total} responses have answer_text "
                    f"— failing audit (no usable data)"
                )
                await db.update_audit(audit_id, {
                    "status": "failed",
                    "pipeline_state": "failed",
                    "error_message": (
                        f"Polling finished but 0/{total} responses contain data. "
                        f"All provider jobs may have failed."
                    ),
                })
                await db.update_audit_step(audit_id, "parse", {
                    "status": "error",
                    "message": f"0/{total} responses have answers — no data to process",
                })
                return

            msg = (
                f"{received}/{total} received ({terminal} dropped by provider)"
                if terminal else f"All {total} responses received"
            )
            await db.update_audit_step(audit_id, "parse", {"status": "done", "message": msg})
            await db.update_audit_step(audit_id, "fetch", {"status": "done"})
            phase = "branch_active_zero_transition"
            transitioned = await transition_state(
                audit_id, "polling", "extracting_competitors", worker_id
            )
            if transitioned:
                logger.info(f"[polling] {audit_id}: polling → extracting_competitors")
            else:
                logger.warning(
                    f"[polling] {audit_id}: CAS transition polling→extracting_competitors "
                    f"FAILED (will retry next tick)"
                )
            return

        # ── Branch 2: global safety-net deadline ────────────────────────
        phase = "deadline_check"
        audit_row = await db.get_audit(audit_id)
        anchor = (audit_row or {}).get("started_at") or (audit_row or {}).get("created_at")
        if isinstance(anchor, str):
            try:
                anchor = datetime.fromisoformat(anchor.replace("Z", "+00:00"))
            except ValueError:
                anchor = None
        if anchor and (datetime.now(timezone.utc) - anchor) > timedelta(minutes=POLLING_MAX_MINUTES):
            logger.warning(
                f"[polling] {audit_id}: deadline {POLLING_MAX_MINUTES}m hit, "
                f"sweeping {active_pending} active rows as polling_timeout"
            )
            phase = "deadline_fetch_active"
            all_active = await db.get_active_pending_responses(
                audit_id, min_interval_seconds=0, limit=10000
            )
            phase = "deadline_mark_terminal"
            if all_active:
                await db.mark_polling_terminal(
                    [str(r["id"]) for r in all_active], "polling_timeout"
                )
            phase = "deadline_log"
            try:
                await db.update_audit(audit_id, {
                    "error_message": (
                        f"Polling: deadline {POLLING_MAX_MINUTES}m hit, "
                        f"{len(all_active)} rows swept as polling_timeout"
                    )
                })
            except Exception:
                pass
            # Next tick will see active_pending == 0 and transition.
            return

        # ── Branch 3: fetch a bounded slice of "due" rows ───────────────
        phase = "fetch_due_slice"
        due = await db.get_active_pending_responses(
            audit_id,
            min_interval_seconds=MIN_POLL_INTERVAL_SECONDS,
            limit=200,
        )
        if not due:
            # Nothing due yet (polled within the last MIN_POLL_INTERVAL).
            return

        # Bump attempts up-front so even fetch failures count toward exhaustion.
        phase = "mark_polling_attempt"
        await db.mark_polling_attempt([str(r["id"]) for r in due])

        # ── Group: orphans / legacy / job_groups ────────────────────────
        phase = "group_rows"
        orphans: list[dict] = []
        legacy_responses: list[dict] = []
        job_groups: dict[str, list[dict]] = {}
        for r in due:
            has_job = bool(r.get("job_id"))
            has_snap = bool(r.get("snapshot_id"))
            if has_snap and not has_job:
                legacy_responses.append(r)
            elif has_job:
                job_groups.setdefault(r["job_id"], []).append(r)
            else:
                orphans.append(r)

        if orphans:
            phase = "mark_orphans_terminal"
            logger.warning(
                f"[polling] {audit_id}: {len(orphans)} orphan rows "
                "(no job_id and no snapshot_id) — marking orphan_no_job_id"
            )
            await db.mark_polling_terminal(
                [str(r["id"]) for r in orphans], "orphan_no_job_id"
            )
            try:
                await db.update_audit(audit_id, {
                    "error_message": f"Polling: {len(orphans)} orphan rows marked orphan_no_job_id"
                })
            except Exception:
                pass

        results: list[dict] = []
        error_terminal_ids: list[str] = []   # provider_error
        dropped_terminal_ids: list[str] = [] # provider_dropped

        # Process legacy BrightData responses
        if legacy_responses:
            phase = "fetch_brightdata"
            brightdata_api_key = settings.brightdata_api_key
            for resp in legacy_responses:
                try:
                    result = await _fetch_brightdata_result(
                        resp["llm"], resp["snapshot_id"], brightdata_api_key
                    )
                    if result:
                        is_google = resp["llm"] in ("google-ai-overview", "google-ai-mode")
                        answer_text = result.get("aio_text") if is_google else result.get("answer_text")
                        answer_md = result.get("aio_text") if is_google else result.get("answer_text_markdown")
                        cleaned = {k: v for k, v in result.items()
                                   if k not in ("answer_html", "response_raw", "source_html", "page_html")}
                        results.append({
                            "success": True, "response": resp, "result": result,
                            "update": {
                                "id": str(resp["id"]),
                                "response_url": result.get("url"),
                                "answer_text": answer_text,
                                "answer_text_markdown": answer_md,
                                "response_timestamp": result.get("timestamp"),
                                "raw_response_data": cleaned,
                                "web_search_query": result.get("web_search_query"),
                            },
                        })
                    else:
                        # not_ready: do NOT write any update — attempts++ already counted.
                        results.append({"success": False, "response": resp, "reason": "not_ready"})
                except Exception as e:
                    logger.error(f"[polling] BrightData fetch error for {resp['llm']}: {e}")
                    error_terminal_ids.append(str(resp["id"]))

        # Process OneSearch job-based responses
        if job_groups:
            phase = "fetch_onesearch"
            all_prompt_ids = [
                str(r["prompt_id"])
                for responses in job_groups.values()
                for r in responses
                if r.get("prompt_id")
            ]
            prompts_map = await db.get_prompt_texts(all_prompt_ids)

            for job_id, responses in job_groups.items():
                try:
                    onesearch_results = await fetch_onesearch_results(job_id)
                    if onesearch_results:
                        matched_count = 0
                        for resp in responses:
                            prompt_text = prompts_map.get(str(resp["prompt_id"]), "")
                            matched = next(
                                (r for r in onesearch_results if r.get("prompt") == prompt_text),
                                None,
                            )
                            if matched:
                                matched_count += 1
                                results.append({
                                    "success": True, "response": resp, "result": matched,
                                    "update": {
                                        "id": str(resp["id"]),
                                        "response_url": matched.get("url"),
                                        "answer_text": matched.get("answer_text"),
                                        "answer_text_markdown": matched.get("answer_text_markdown"),
                                        "response_timestamp": datetime.now(timezone.utc),
                                        "raw_response_data": matched,
                                        "web_search_query": matched.get("web_search_query"),
                                        "citations": json.dumps(matched["citations"]) if matched.get("citations") else None,
                                        "all_sources": json.dumps(matched["all_sources"]) if matched.get("all_sources") else None,
                                        "links_attached": json.dumps(matched["links_attached"]) if matched.get("links_attached") else None,
                                    },
                                })
                            else:
                                # Provider returned the snapshot but dropped this prompt → terminal.
                                dropped_terminal_ids.append(str(resp["id"]))
                        if matched_count < len(responses):
                            logger.warning(
                                f"[polling] {audit_id}: provider drop on job {job_id}: "
                                f"submitted={len(responses)}, returned={matched_count}, "
                                f"dropped={len(responses) - matched_count}"
                            )
                    else:
                        # not_ready for the whole job
                        for resp in responses:
                            results.append({"success": False, "response": resp, "reason": "not_ready"})
                except Exception as e:
                    logger.error(f"[polling] OneSearch error for job {job_id}: {e}")
                    for resp in responses:
                        error_terminal_ids.append(str(resp["id"]))

        # ── Persist: success updates first, then terminals ──────────────
        phase = "persist_updates"
        updates = [r["update"] for r in results if r.get("update")]
        # Capture successful_ids BEFORE the upsert so the exhaustion sweep
        # below cannot trip on a downstream helper that mutates the list.
        # Defense in depth — `upsert_llm_responses` no longer pops `id` in
        # place, but the sweep is correctness-critical (one missing id
        # there means a row gets marked provider_no_response by mistake).
        successful_ids: set[str] = {u["id"] for u in updates if u.get("id")}
        if updates:
            await db.upsert_llm_responses(updates)

        # Citations for the freshly successful rows
        phase = "persist_citations"
        successful = [r for r in results if r.get("success") and r.get("result")]
        if successful:
            all_citations = []
            delete_keys = []
            for r in successful:
                resp = r["response"]
                delete_keys.append({
                    "audit_id": str(resp["audit_id"]),
                    "prompt_id": str(resp["prompt_id"]),
                    "llm": resp["llm"],
                })
                all_citations.extend(collect_citations(r["result"], resp))
            await db.delete_citations_batch(delete_keys)
            if all_citations:
                await db.insert_citations_batch(all_citations)

        phase = "mark_dropped"
        if dropped_terminal_ids:
            await db.mark_polling_terminal(dropped_terminal_ids, "provider_dropped")
        phase = "mark_errors"
        if error_terminal_ids:
            await db.mark_polling_terminal(error_terminal_ids, "provider_error")

        # ── Per-row exhaustion sweep ────────────────────────────────────
        phase = "exhaustion_sweep"
        exhausted_ids: list[str] = []
        # `successful_ids` was captured above before `upsert_llm_responses`.
        handled_terminal = set(dropped_terminal_ids) | set(error_terminal_ids)
        for r in due:
            rid = str(r["id"])
            if rid in successful_ids or rid in handled_terminal:
                continue
            # `poll_attempts` was the value BEFORE we bumped — compare against cap-1.
            prev_attempts = int(r.get("poll_attempts") or 0)
            if prev_attempts + 1 >= MAX_POLL_ATTEMPTS_PER_ROW:
                exhausted_ids.append(rid)
        if exhausted_ids:
            logger.warning(
                f"[polling] {audit_id}: {len(exhausted_ids)} rows exhausted "
                f"after {MAX_POLL_ATTEMPTS_PER_ROW} attempts → provider_no_response"
            )
            await db.mark_polling_terminal(exhausted_ids, "provider_no_response")
            try:
                await db.update_audit(audit_id, {
                    "error_message": (
                        f"Polling: {len(exhausted_ids)} rows marked provider_no_response "
                        f"(exhausted {MAX_POLL_ATTEMPTS_PER_ROW} attempts)"
                    )
                })
            except Exception:
                pass

        # Re-read counters after persisting so the UI reflects reality
        # immediately instead of lagging by one tick (~15s).
        phase = "post_fetch_counters"
        post_status = await db.get_polling_status(audit_id)
        post_received = post_status["received"]
        post_pending = post_status["active_pending"]
        post_pct = min(round((post_received / total) * 60) if total else 0, 60)
        await update_progress_counters(
            audit_id,
            responses_expected=total,
            responses_received=post_received,
            progress=post_pct,
        )

        # Heartbeat at exit so long fetches don't look stale to auto-fail.
        phase = "heartbeat_out"
        await _heartbeat(audit_id)

        phase = "exit_log"
        ok = len(updates) - len(dropped_terminal_ids)  # successes only
        not_ready = sum(1 for r in results if r.get("reason") == "not_ready")
        logger.info(
            f"[polling] {audit_id}: tick done due={len(due)} ok={ok} "
            f"dropped={len(dropped_terminal_ids)} errors={len(error_terminal_ids)} "
            f"exhausted={len(exhausted_ids)} not_ready={not_ready} "
            f"orphans={len(orphans)}"
        )

        # Try to refresh metrics (non-fatal)
        phase = "refresh_metrics"
        try:
            await db.refresh_audit_metrics(audit_id)
        except Exception as e:
            logger.warning(f"[pipeline] Metrics refresh warning: {e}")

    except Exception as e:
        # Crash record goes to THREE places, none of which can mask the
        # other: stdout log (container), audits.error_message (modal/api),
        # audit_pipeline_log (permanent journal queryable for the lifetime
        # of the audit). The exception is then re-raised so process_step
        # sees it and the scheduler's lock-release path runs.
        crash_msg = (
            f"polling crash @ {phase}: {type(e).__name__}: {str(e)[:300]}"
        )
        logger.error(f"[polling] {audit_id} {crash_msg}", exc_info=True)
        await db.insert_pipeline_log(
            audit_id, "polling", phase,
            f"{type(e).__name__}: {e}",
            level="error",
        )
        try:
            await db.update_audit(audit_id, {"error_message": crash_msg[:500]})
        except Exception:
            pass
        raise


async def _get_audit_run_by(audit_id: str) -> Optional[str]:
    """Look up the user who triggered the audit (audits.run_by)."""
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    try:
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("SELECT run_by FROM audits WHERE id = :aid"),
                {"aid": audit_id},
            )).mappings().first()
            return str(row["run_by"]) if row and row.get("run_by") else None
    except Exception:
        return None


async def handle_competitors(audit_id: str, worker_id: str) -> None:
    """Extract competitors with per-batch checkpointing.

    Bounded + resumable: each invocation processes at most
    `MAX_BATCHES_PER_INVOCATION` outer batches, then yields back to the
    scheduler. State only transitions to `analyzing_sentiment` once
    `get_responses_for_competitors` returns 0 rows — the SQL filter excludes
    rows whose `answer_competitors` is non-NULL and not the {brands:[]} or
    {error:...} sentinels, so subsequent invocations resume where we left off.
    """
    pending = await db.get_responses_for_competitors(audit_id)

    # Single transition path: only here, only when there's nothing left.
    if not pending:
        await db.update_audit_step(audit_id, "competitors", {
            "status": "done", "message": "Competitors extracted"
        })
        transitioned = await transition_state(
            audit_id, "extracting_competitors", "analyzing_sentiment", worker_id
        )
        if transitioned:
            logger.info(
                f"[pipeline] {audit_id}: extracting_competitors → analyzing_sentiment"
            )
        else:
            # CAS failed — likely stale lock from previous worker/deploy.
            current = await db.get_audit(audit_id)
            logger.warning(
                f"[pipeline] {audit_id}: competitors CAS failed "
                f"(state={current.get('pipeline_state')}, locked_by={current.get('locked_by')}, "
                f"worker={worker_id}) — clearing lock and retrying"
            )
            if current.get("pipeline_state") == "extracting_competitors":
                await db.update_audit(audit_id, {"locked_by": None, "locked_at": None})
                transitioned = await transition_state(
                    audit_id, "extracting_competitors", "analyzing_sentiment", worker_id
                )
                if transitioned:
                    logger.info(f"[pipeline] {audit_id}: extracting_competitors → analyzing_sentiment (after lock clear)")
        return

    pending_count = len(pending)

    # ── Force-skip guard ───────────────────────────────────────────────
    # If competitors_processed >= competitors_total but SQL still returns
    # pending rows, those rows are stuck in a retry loop (e.g. error-dict
    # without _retry, or DB write failures). Force-mark them and move on.
    audit_row_check = await db.get_audit(audit_id) or {}
    _proc = audit_row_check.get("competitors_processed") or 0
    _total = audit_row_check.get("competitors_total") or 0
    if pending_count > 0 and _total > 0 and _proc >= _total:
        logger.warning(
            f"[pipeline] {audit_id}: all {_total} competitors processed but "
            f"{pending_count} rows still pending — force-skipping stuck rows"
        )
        try:
            force_updates = [{
                "id": r["id"],
                "competitors": json.dumps({
                    "brands": [], "error": "force_skipped_stuck", "_retry": 999,
                }),
            } for r in pending]
            await db.update_competitors_batch(force_updates)
        except Exception as e:
            logger.error(f"[pipeline] {audit_id}: force-skip write failed: {e}")
        # Re-check pending — should now be empty, transition fires on next tick
        return

    # Discover total once and cache it on the audit row so the modal can show
    # cumulative X/Y progress across multiple invocations. We re-derive total
    # from the audit if it's already set, otherwise treat the first batch as
    # establishing the baseline.
    audit_row = await db.get_audit(audit_id) or {}
    total = audit_row.get("competitors_total") or 0
    processed_so_far = audit_row.get("competitors_processed") or 0
    if total <= 0:
        # First invocation — total = pending now (this is the full set).
        total = pending_count
        processed_so_far = 0

    await db.update_audit_step(audit_id, "competitors", {
        "status": "running",
        "message": f"Extracting competitors: {processed_so_far}/{total}",
    })
    await update_progress_counters(
        audit_id,
        competitors_total=total,
        competitors_processed=processed_so_far,
        progress=60 + round((processed_so_far / total) * 15) if total else 60,
    )

    # Fetch project context
    own_brands, project_id, _ = await db.get_own_brands(audit_id)
    competitor_brands = await db.get_competitor_brands(audit_id)
    project_name = await db.get_project_name(audit_id)
    user_id = await _get_audit_run_by(audit_id)
    cost_ctx = {"audit_id": audit_id, "project_id": project_id, "user_id": user_id}

    # Bounded slice — make some progress, then yield. The next scheduler tick
    # picks the audit up again because the SQL filter still finds remaining work.
    batch_size = 20  # up from 10 — 20 concurrent OpenAI calls per batch via gather
    work = pending[: MAX_BATCHES_PER_INVOCATION * batch_size]
    logger.info(
        f"[pipeline] {audit_id}: competitors invocation — {len(work)}/{pending_count} "
        f"this tick (cumulative {processed_so_far}/{total})"
    )

    processed_this_invocation = 0
    for i in range(0, len(work), batch_size):
        batch = work[i:i + batch_size]
        try:
            batch_updates = await openai_client.extract_competitors_batch(
                batch, batch_size=batch_size, delay=0.2,
                industry=project_name or "",
                known_brands=own_brands,
                known_competitors=competitor_brands,
                _ctx=cost_ctx,
            )
            if batch_updates:
                await db.update_competitors_batch(batch_updates)
        except Exception as e:
            # Don't let one poison batch lock the whole audit. Mark every row
            # in this batch with an error sentinel — the SQL filter
            # `answer_competitors ? 'error'` keeps them eligible for retry on
            # the next tick, but they no longer block forward progress.
            logger.error(
                f"[pipeline] {audit_id}: competitors batch failed: {e}",
                exc_info=True,
            )
            try:
                error_updates = []
                for r in batch:
                    prev = r.get("answer_competitors")
                    prev_retry = 0
                    if isinstance(prev, dict):
                        prev_retry = prev.get("_retry", 0)
                    elif isinstance(prev, str):
                        try:
                            prev_retry = json.loads(prev).get("_retry", 0)
                        except Exception:
                            pass
                    error_updates.append({
                        "id": r["id"],
                        "competitors": json.dumps({
                            "brands": [], "error": str(e)[:200],
                            "_retry": prev_retry + 1,
                        }),
                    })
                await db.update_competitors_batch(error_updates)
            except Exception as save_err:
                logger.error(
                    f"[pipeline] {audit_id}: failed to write error sentinels: {save_err}"
                )

        processed_this_invocation = min(i + batch_size, len(work))
        cumulative = min(processed_so_far + processed_this_invocation, total)
        progress = 60 + (round((cumulative / total) * 15) if total else 0)

        # Combined heartbeat + progress + step in ONE db session (was 3 separate).
        # Reduces connection pool pressure from 3 sessions to 1 per batch.
        await db.heartbeat_progress_step(
            audit_id,
            progress_data={"competitors_processed": cumulative, "progress": progress},
            step="competitors",
            step_data={
                "status": "running",
                "message": f"Extracting competitors: {cumulative}/{total}",
                "processed_count": cumulative,
                "total_count": total,
            },
        )

    # NB: no transition_state here. The next scheduler tick will call us again;
    # if `get_responses_for_competitors` is now empty we hit the early-return
    # branch above and transition there. Single transition path → easier to
    # reason about + impossible to get stuck mid-loop.


def _sentiment_cache_key(answer_text: str, brands: list[str], model: str, version: str) -> str:
    """Stable cache key: sha256 of answer_text + sorted brand list + model + prompt version."""
    payload = json.dumps({
        "a": answer_text, "b": sorted(brands), "m": model, "v": version,
    }, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _legacy_summary_label(rows: list[dict]) -> tuple[float, str]:
    """
    Derive a legacy single-row summary from a list of per-brand sentiments.
    Used to keep llm_responses.sentiment_score / sentiment_label populated for
    backwards-compat dashboards. Picks the most-extreme signal: any negative
    wins; else any positive; else neutral.
    """
    if not rows:
        return 0.0, "neutral"
    has_neg = any(r["label"] == "negative" for r in rows)
    has_pos = any(r["label"] == "positive" for r in rows)
    if has_neg:
        avg = sum(r["score"] for r in rows if r["label"] == "negative") / sum(
            1 for r in rows if r["label"] == "negative"
        )
        return avg, "negative"
    if has_pos:
        avg = sum(r["score"] for r in rows if r["label"] == "positive") / sum(
            1 for r in rows if r["label"] == "positive"
        )
        return avg, "positive"
    return 0.0, "neutral"


async def handle_sentiment(audit_id: str, worker_id: str) -> None:
    """
    Run sentiment analysis V2 with per-batch checkpointing.

    Per-brand-per-response: detects all known brands (own + competitors) in
    each answer using word-boundary matching, then asks gpt-5-mini in a single
    structured-output call to score every detected brand at once.

    Bounded + resumable like `handle_competitors`: each invocation processes
    at most `MAX_BATCHES_PER_INVOCATION` outer batches and only transitions
    to `finalizing` once `get_responses_for_sentiment_v2` returns 0 rows.
    """
    audit = await db.get_audit(audit_id)
    sentiment_enabled = audit.get("sentiment", False)

    async def _skip(reason: str) -> None:
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "done", "message": reason,
        })
        transitioned = await transition_state(audit_id, "analyzing_sentiment", "finalizing", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: analyzing_sentiment → finalizing ({reason})")
        else:
            # CAS failed — likely stale lock from a previous worker/deploy.
            # Force-clear the lock and retry once.
            current = await db.get_audit(audit_id)
            logger.warning(
                f"[pipeline] {audit_id}: sentiment _skip CAS failed "
                f"(state={current.get('pipeline_state')}, locked_by={current.get('locked_by')}, "
                f"worker={worker_id}) — clearing lock and retrying"
            )
            if current.get("pipeline_state") == "analyzing_sentiment":
                await db.update_audit(audit_id, {"locked_by": None, "locked_at": None})
                transitioned = await transition_state(audit_id, "analyzing_sentiment", "finalizing", worker_id)
                if transitioned:
                    logger.info(f"[pipeline] {audit_id}: analyzing_sentiment → finalizing (after lock clear)")

    if not sentiment_enabled:
        await _skip("Sentiment analysis disabled")
        return

    own_specs, comp_specs = await db.get_brand_specs(audit_id)
    if not own_specs and not comp_specs:
        await _skip("No brands for sentiment analysis")
        return

    own_set = {s["name"] for s in own_specs}
    all_specs = [BrandSpec(name=s["name"], aliases=s["aliases"]) for s in (own_specs + comp_specs)]

    pending = await db.get_responses_for_sentiment_v2(audit_id)
    if not pending:
        await _skip("Sentiment analyzed")
        return

    pending_count = len(pending)

    # ── Force-skip guard ───────────────────────────────────────────────
    # Same pattern as handle_competitors: if all rows were processed but
    # SQL still returns pending rows, force-mark them to unblock transition.
    _s_proc = audit.get("sentiment_processed") or 0
    _s_total = audit.get("sentiment_total") or 0
    if pending_count > 0 and _s_total > 0 and _s_proc >= _s_total:
        logger.warning(
            f"[pipeline] {audit_id}: all {_s_total} sentiment processed but "
            f"{pending_count} rows still pending — force-skipping stuck rows"
        )
        try:
            sentinel_rows = [{
                "response_id": str(r["id"]),
                "audit_id": audit_id,
                "brand": "__stuck__",
                # CHECK constraint requires IN ('own','competitor'); the sentinel
                # is filtered downstream by brand='__stuck__' / is_fallback=True,
                # so the kind value is arbitrary — pick 'own' to satisfy the check.
                "brand_kind": "own",
                "label": "mention_only",
                "score": 0.0,
                "confidence": 0.0,
                "reasoning": "Force-skipped: stuck in retry loop",
                "is_fallback": True,
                "model": openai_client.MODEL_SENTIMENT,
                "prompt_version": openai_client.SENTIMENT_PROMPT_VERSION,
            } for r in pending]
            await db.upsert_response_brand_sentiment(sentinel_rows)
            legacy = [{"id": str(r["id"]), "score": 0.0, "label": "neutral"} for r in pending]
            await db.update_sentiment_batch(legacy)
        except Exception as e:
            logger.error(f"[pipeline] {audit_id}: sentiment force-skip write failed: {e}")
        return

    project_name = await db.get_project_name(audit_id) or ""
    _, project_id, _ = await db.get_own_brands(audit_id)
    user_id = await _get_audit_run_by(audit_id)
    cost_ctx = {"audit_id": audit_id, "project_id": project_id, "user_id": user_id}

    # Cumulative total/processed across invocations (mirrors handle_competitors).
    total = audit.get("sentiment_total") or 0
    processed_so_far = audit.get("sentiment_processed") or 0
    if total <= 0:
        total = pending_count
        processed_so_far = 0

    await db.update_audit_step(audit_id, "sentiment", {
        "status": "running",
        "message": f"Analyzing sentiment: {processed_so_far}/{total}",
    })
    await update_progress_counters(
        audit_id,
        sentiment_total=total,
        sentiment_processed=processed_so_far,
        progress=75 + (round((processed_so_far / total) * 15) if total else 0),
    )

    # Bounded slice — yield to scheduler after MAX_BATCHES_PER_INVOCATION batches.
    batch_size = 20  # up from 10 — 20 concurrent OpenAI calls per batch via gather
    work = pending[: MAX_BATCHES_PER_INVOCATION * batch_size]

    logger.info(
        f"[pipeline] {audit_id}: sentiment v2 invocation — {len(work)}/{pending_count} "
        f"this tick (cumulative {processed_so_far}/{total}); "
        f"own={len(own_specs)} competitors={len(comp_specs)}"
    )

    processed_this_invocation = 0
    for i in range(0, len(work), batch_size):
        batch = work[i:i + batch_size]

        async def process(resp: dict) -> tuple[list[dict], list[dict]]:
            """Returns (rbs_rows, legacy_updates) for one response."""
            answer_text = resp.get("answer_text") or ""
            detected = detect_brands_in_text(answer_text, all_specs)
            if not detected:
                # No brands found — insert a sentinel row into response_brand_sentiment
                # so the NOT EXISTS filter skips this response on the next tick.
                # Without this, responses with no brands loop forever.
                sentinel = [{
                    "response_id": str(resp["id"]),
                    "audit_id": audit_id,
                    "brand": "__none__",
                    "brand_kind": "none",
                    "label": "mention_only",
                    "score": 0.0,
                    "confidence": 1.0,
                    "reasoning": "No brands detected in response text",
                    "is_fallback": True,
                    "model": openai_client.MODEL_SENTIMENT,
                    "prompt_version": openai_client.SENTIMENT_PROMPT_VERSION,
                }]
                legacy = [{"id": str(resp["id"]), "score": 0.0, "label": "neutral"}]
                return sentinel, legacy

            cache_key = _sentiment_cache_key(
                answer_text, detected, openai_client.MODEL, openai_client.SENTIMENT_PROMPT_VERSION,
            )
            cached = await db.get_sentiment_cache(cache_key)
            if cached and isinstance(cached, dict) and "brands" in cached:
                result = cached
            else:
                result = await openai_client.analyze_response_sentiment(
                    prompt_text=resp.get("prompt_text") or "",
                    answer_text=answer_text,
                    brands_to_score=detected,
                    industry=project_name,
                    _ctx=cost_ctx,
                )
                if not result.get("_fallback"):
                    await db.put_sentiment_cache(cache_key, result)

            is_fallback = bool(result.get("_fallback"))
            rbs_rows = []
            for b in result.get("brands", []):
                rbs_rows.append({
                    "response_id": str(resp["id"]),
                    "audit_id": audit_id,
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

            # Legacy summary for backwards compat on llm_responses
            score, label = _legacy_summary_label(rbs_rows)
            legacy = [{"id": str(resp["id"]), "score": score, "label": label}]
            return rbs_rows, legacy

        try:
            results = await asyncio.gather(*(process(r) for r in batch), return_exceptions=True)

            flat_rbs: list[dict] = []
            flat_legacy: list[dict] = []
            for idx, r in enumerate(results):
                if isinstance(r, Exception):
                    logger.error(f"[pipeline] sentiment batch item failed: {r}")
                    # Insert __error__ sentinel so NOT EXISTS skips this row
                    # on the next tick — prevents infinite retry loop.
                    resp = batch[idx]
                    flat_rbs.append({
                        "response_id": str(resp["id"]),
                        "audit_id": audit_id,
                        "brand": "__error__",
                        "brand_kind": "none",
                        "label": "mention_only",
                        "score": 0.0,
                        "confidence": 0.0,
                        "reasoning": f"Error: {str(r)[:200]}",
                        "is_fallback": True,
                        "model": openai_client.MODEL_SENTIMENT,
                        "prompt_version": openai_client.SENTIMENT_PROMPT_VERSION,
                    })
                    flat_legacy.append({"id": str(resp["id"]), "score": 0.0, "label": "neutral"})
                    continue
                rbs, legacy = r
                flat_rbs.extend(rbs)
                flat_legacy.extend(legacy)

            if flat_rbs:
                await db.upsert_response_brand_sentiment(flat_rbs)
            if flat_legacy:
                await db.update_sentiment_batch(flat_legacy)
        except Exception as e:
            # Don't let one poison batch lock the whole audit. Mark every row
            # in this batch with a neutral fallback so the SQL filter no longer
            # picks them up — they will not block forward progress.
            logger.error(
                f"[pipeline] {audit_id}: sentiment batch failed: {e}",
                exc_info=True,
            )
            try:
                await db.update_sentiment_batch([
                    {"id": str(r["id"]), "score": 0.0, "label": "neutral"}
                    for r in batch
                ])
            except Exception as save_err:
                logger.error(
                    f"[pipeline] {audit_id}: failed to write sentiment fallback: {save_err}"
                )

        processed_this_invocation = min(i + batch_size, len(work))
        cumulative = min(processed_so_far + processed_this_invocation, total)
        progress = 75 + (round((cumulative / total) * 15) if total else 0)

        # Combined heartbeat + progress + step in ONE db session (was 3 separate).
        await db.heartbeat_progress_step(
            audit_id,
            progress_data={"sentiment_processed": cumulative, "progress": progress},
            step="sentiment",
            step_data={
                "status": "running",
                "message": f"Analyzing sentiment: {cumulative}/{total}",
                "processed_count": cumulative,
                "total_count": total,
            },
        )

    # NB: no transition_state here. Next tick will call us again; when
    # `get_responses_for_sentiment_v2` returns 0 the early-return at the top
    # transitions to `finalizing`. Single transition path.


async def handle_finalize(audit_id: str, worker_id: str) -> None:
    """Compute metrics, refresh materialized views, mark completed."""
    # Heartbeat first — keeps last_activity_at fresh so the 60-min auto-fail
    # sweep doesn't kill a finalizing audit that's retrying after an error.
    await _heartbeat(audit_id)
    await db.update_audit_step(audit_id, "persist", {
        "status": "running", "message": "Computing metrics..."
    })
    await update_progress_counters(audit_id, progress=90)

    # Coverage check — surface silent extraction collapse before the user notices.
    # If many responses have answer_text but very few have answer_competitors,
    # something upstream skipped extraction and the dashboards will look empty.
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text
        async with AsyncSessionLocal() as s:
            row = (await s.execute(text("""
                SELECT COUNT(*) FILTER (WHERE answer_text IS NOT NULL) AS with_text,
                       COUNT(*) FILTER (WHERE answer_competitors IS NOT NULL) AS with_comp
                FROM llm_responses WHERE audit_id = :aid
            """), {"aid": audit_id})).mappings().first()
        with_text = (row or {}).get("with_text") or 0
        with_comp = (row or {}).get("with_comp") or 0
        if with_text >= 5 and with_comp < with_text * 0.8:
            logger.error(
                f"[pipeline] {audit_id}: LOW competitor extraction coverage "
                f"({with_comp}/{with_text}) — Brand Leadership will look empty. "
                "Investigate handle_competitors / extract_competitors path."
            )
    except Exception as e:
        logger.warning(f"[pipeline] {audit_id}: coverage check failed: {e}")

    try:
        await db.calculate_project_metrics(audit_id)
    except Exception as e:
        logger.warning(f"[pipeline] {audit_id}: metrics calculation warning: {e}")

    try:
        await db.refresh_audit_metrics(audit_id)
    except Exception as e:
        logger.warning(f"[pipeline] {audit_id}: audit metrics refresh warning: {e}")

    try:
        await db.update_audit_step(audit_id, "persist", {
            "status": "done", "message": "Results saved"
        })

        now = datetime.now(timezone.utc)
        await db.update_audit(audit_id, {
            "status": "completed",
            "progress": 100,
            "current_step": None,
            "pipeline_state": "completed",
            "finished_at": now,
            "locked_by": None,
            "locked_at": None,
        })
        logger.info(f"[pipeline] Audit {audit_id} COMPLETED")
    except Exception as e:
        logger.error(
            f"[pipeline] {audit_id}: finalize update failed: {e}, will retry next tick"
        )


# ── Main dispatcher ──────────────────────────────────────────────────

HANDLERS = {
    "fetching": handle_fetching,
    "created": handle_created,
    "polling": handle_polling,
    "extracting_competitors": handle_competitors,
    "analyzing_sentiment": handle_sentiment,
    "finalizing": handle_finalize,
}


async def process_step(audit: dict, worker_id: str) -> None:
    """Process the current step for an audit. Called by scheduler."""
    audit_id = str(audit["id"])
    state = audit.get("pipeline_state")

    handler = HANDLERS.get(state)
    if not handler:
        logger.warning(f"[pipeline] {audit_id}: no handler for state '{state}'")
        return

    try:
        await asyncio.wait_for(handler(audit_id, worker_id), timeout=PER_STEP_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.error(
            f"[pipeline] {audit_id} step '{state}' timed out after "
            f"{PER_STEP_TIMEOUT_SECONDS}s — releasing slot, will retry next tick"
        )
        # Don't fail the audit — the next tick will retry. The 60-min auto-fail
        # sweep in the scheduler will eventually catch genuinely dead audits.
        await db.insert_pipeline_log(
            audit_id, state or "unknown", "process_step_timeout",
            f"Step timed out after {PER_STEP_TIMEOUT_SECONDS}s",
            level="warning",
        )
        try:
            await db.update_audit(audit_id, {
                "error_message": f"Step '{state}' timed out after {PER_STEP_TIMEOUT_SECONDS}s (retrying)"
            })
        except Exception:
            pass
    except Exception as e:
        logger.error(f"[pipeline] {audit_id} error in {state}: {e}", exc_info=True)
        # Don't fail immediately — allow retries on next tick. Permanent
        # journal entry first (insert-only, can't mask itself), then a
        # best-effort `error_message` write for the modal.
        await db.insert_pipeline_log(
            audit_id, state or "unknown", "process_step_error",
            f"{type(e).__name__}: {e}",
            level="error",
        )
        try:
            await db.update_audit(audit_id, {
                "error_message": f"Step '{state}' error: {type(e).__name__}: {str(e)[:200]} (retrying)"
            })
        except Exception:
            pass


async def get_active_audits() -> list[dict]:
    """Get audits that need processing.

    Includes 'created' so the recovery handler can pick up audits inserted
    by paths that didn't set pipeline_state (e.g. legacy edge functions or
    direct DB inserts). Without this, such audits silently rot forever.
    Only picks up 'created' audits older than 2 minutes to avoid racing
    the run_audit endpoint, which sets 'fetching' itself before transitioning.
    """
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        result = await s.execute(text("""
            SELECT id, pipeline_state, locked_by, locked_at, started_at, status, sentiment
            FROM audits
            WHERE pipeline_state IN ('polling', 'extracting_competitors', 'analyzing_sentiment', 'finalizing')
               OR (pipeline_state = 'created'
                   AND status IN ('running', 'pending')
                   AND created_at < now() - interval '2 minutes')
               OR (pipeline_state = 'fetching'
                   AND status = 'running'
                   AND started_at < now() - interval '2 minutes')
            -- Order by least-recently-touched so zombies drift to the bottom
            -- and audits making progress get fair round-robin treatment.
            ORDER BY COALESCE(last_activity_at, started_at) ASC NULLS FIRST
            LIMIT 50
        """))
        return [dict(r._mapping) for r in result.fetchall()]
