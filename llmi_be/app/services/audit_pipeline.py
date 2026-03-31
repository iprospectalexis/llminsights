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

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.config import get_settings
from app.services.supabase_db import db
from app.services import openai_client

logger = logging.getLogger(__name__)
settings = get_settings()

# Unique worker ID for this server instance (prevents multi-instance conflicts)
WORKER_ID = str(uuid.uuid4())[:8]

# ── State transitions ────────────────────────────────────────────────

VALID_TRANSITIONS = {
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


# ── Step handlers ────────────────────────────────────────────────────

async def handle_polling(audit_id: str, worker_id: str) -> None:
    """Fetch results from OneSearch/BrightData jobs. Idempotent — skips already-fetched."""
    from app.api.v1.endpoints.audits import (
        fetch_onesearch_results, _fetch_brightdata_result, collect_citations
    )

    await db.update_audit_step(audit_id, "parse", {
        "status": "running", "message": "Polling for LLM results..."
    }, status_filter="pending")

    # Count expected vs received for progress
    all_responses = await db.get_all_responses_for_audit(audit_id)
    total = len(all_responses)
    received = sum(1 for r in all_responses if r.get("answer_text") or (
        r.get("raw_response_data") and isinstance(r.get("raw_response_data"), dict) and r["raw_response_data"]
    ))
    await update_progress_counters(audit_id,
        responses_expected=total, responses_received=received,
        progress=min(round((received / total) * 60) if total else 0, 60),  # 0-60% for polling phase
    )

    # Get pending responses
    pending = await db.get_pending_responses(audit_id, limit=500)
    if not pending:
        # All done — transition to competitors
        await db.update_audit_step(audit_id, "parse", {
            "status": "done", "message": f"All {total} responses received"
        })
        await db.update_audit_step(audit_id, "fetch", {"status": "done"})
        transitioned = await transition_state(audit_id, "polling", "extracting_competitors", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: polling → extracting_competitors")
        return

    logger.info(f"[pipeline] {audit_id}: {len(pending)} pending responses")

    # Group by job_id
    job_groups: dict[str, list[dict]] = {}
    legacy_responses = []
    for r in pending:
        if r.get("snapshot_id") and not r.get("job_id"):
            legacy_responses.append(r)
        elif r.get("job_id"):
            job_groups.setdefault(r["job_id"], []).append(r)

    results = []

    # Process legacy BrightData responses
    if legacy_responses:
        brightdata_api_key = settings.brightdata_api_key
        for resp in legacy_responses:
            try:
                result = await _fetch_brightdata_result(resp["llm"], resp["snapshot_id"], brightdata_api_key)
                if result:
                    is_google = resp["llm"] in ("google-ai-overview", "google-ai-mode")
                    answer_text = result.get("aio_text") if is_google else result.get("answer_text")
                    answer_md = result.get("aio_text") if is_google else result.get("answer_text_markdown")
                    cleaned = {k: v for k, v in result.items() if k not in ("answer_html", "response_raw", "source_html", "page_html")}
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
                    results.append({"success": False, "response": resp, "reason": "not_ready"})
            except Exception as e:
                logger.error(f"BrightData fetch error for {resp['llm']}: {e}")
                results.append({
                    "success": False, "response": resp,
                    "update": {
                        "id": str(resp["id"]),
                        "raw_response_data": {"error": str(e), "failed_at": datetime.now(timezone.utc).isoformat()},
                    },
                })

    # Process OneSearch job-based responses
    if job_groups:
        all_prompt_ids = [str(r["prompt_id"]) for responses in job_groups.values() for r in responses if r.get("prompt_id")]
        prompts_map = await db.get_prompt_texts(all_prompt_ids)

        for job_id, responses in job_groups.items():
            try:
                onesearch_results = await fetch_onesearch_results(job_id)
                if onesearch_results:
                    for resp in responses:
                        prompt_text = prompts_map.get(str(resp["prompt_id"]), "")
                        matched = next((r for r in onesearch_results if r.get("prompt") == prompt_text), None)
                        if matched:
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
                            results.append({"success": False, "response": resp, "reason": "no_match"})
                else:
                    for resp in responses:
                        results.append({"success": False, "response": resp, "reason": "not_ready"})
            except Exception as e:
                logger.error(f"OneSearch error for job {job_id}: {e}")
                for resp in responses:
                    results.append({
                        "success": False, "response": resp,
                        "update": {
                            "id": str(resp["id"]),
                            "raw_response_data": {"error": str(e), "failed_at": datetime.now(timezone.utc).isoformat()},
                        },
                    })

    # Batch update responses
    updates = [r["update"] for r in results if r.get("update")]
    if updates:
        await db.upsert_llm_responses(updates)

    # Batch process citations
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

    # Summary
    ok = sum(1 for r in results if r.get("success"))
    failed = sum(1 for r in results if not r.get("success") and r.get("update"))
    not_ready = sum(1 for r in results if r.get("reason") == "not_ready")
    logger.info(f"[pipeline] Poll {audit_id}: {ok} ok, {failed} failed, {not_ready} not ready")

    # Update received count
    new_received = received + ok + failed
    await update_progress_counters(audit_id,
        responses_received=new_received,
        progress=min(round((new_received / total) * 60) if total else 0, 60),
    )

    # Try to refresh metrics (non-fatal)
    try:
        await db.refresh_audit_metrics(audit_id)
    except Exception as e:
        logger.warning(f"[pipeline] Metrics refresh warning: {e}")


async def handle_competitors(audit_id: str, worker_id: str) -> None:
    """Extract competitors with per-batch checkpointing."""
    responses = await db.get_responses_for_competitors(audit_id)

    if not responses:
        await db.update_audit_step(audit_id, "competitors", {
            "status": "done", "message": "No responses to process"
        })
        transitioned = await transition_state(audit_id, "extracting_competitors", "analyzing_sentiment", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: extracting_competitors → analyzing_sentiment (0 responses)")
        return

    total = len(responses)
    await db.update_audit_step(audit_id, "competitors", {
        "status": "running", "message": f"Extracting competitors: 0/{total}"
    })
    await update_progress_counters(audit_id, competitors_total=total, competitors_processed=0, progress=60)

    # Fetch project context
    own_brands, project_id, _ = await db.get_own_brands(audit_id)
    competitor_brands = await db.get_competitor_brands(audit_id)
    project_name = await db.get_project_name(audit_id)

    logger.info(f"[pipeline] {audit_id}: extracting competitors from {total} responses")

    # Process in batches of 10, save after each batch (checkpoint)
    batch_size = 10
    processed = 0
    for i in range(0, total, batch_size):
        batch = responses[i:i + batch_size]
        batch_updates = await openai_client.extract_competitors_batch(
            batch, batch_size=batch_size, delay=0.2,
            industry=project_name or "",
            known_brands=own_brands,
            known_competitors=competitor_brands,
        )
        # Save immediately — crash after this batch loses nothing
        if batch_updates:
            await db.update_competitors_batch(batch_updates)

        processed = min(i + batch_size, total)
        progress = 60 + round((processed / total) * 15)  # 60-75% for competitors
        await update_progress_counters(audit_id, competitors_processed=processed, progress=progress)
        await db.update_audit_step(audit_id, "competitors", {
            "status": "running",
            "message": f"Extracting competitors: {processed}/{total}",
            "processed_count": processed,
            "total_count": total,
        })

    await db.update_audit_step(audit_id, "competitors", {
        "status": "done",
        "message": f"Competitors extracted for {processed} responses",
        "processed_count": processed,
        "total_count": total,
    })

    transitioned = await transition_state(audit_id, "extracting_competitors", "analyzing_sentiment", worker_id)
    if transitioned:
        logger.info(f"[pipeline] {audit_id}: extracting_competitors → analyzing_sentiment")


async def handle_sentiment(audit_id: str, worker_id: str) -> None:
    """Run sentiment analysis with per-batch checkpointing."""
    audit = await db.get_audit(audit_id)
    sentiment_enabled = audit.get("sentiment", False)

    if not sentiment_enabled:
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "done", "message": "Sentiment analysis disabled"
        })
        transitioned = await transition_state(audit_id, "analyzing_sentiment", "finalizing", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: analyzing_sentiment → finalizing (disabled)")
        return

    brands, project_id, created_by = await db.get_own_brands(audit_id)
    if not brands:
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "done", "message": "No brands for sentiment analysis"
        })
        transitioned = await transition_state(audit_id, "analyzing_sentiment", "finalizing", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: analyzing_sentiment → finalizing (no brands)")
        return

    responses = await db.get_responses_for_sentiment(audit_id)
    if not responses:
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "done", "message": "No responses for sentiment analysis"
        })
        transitioned = await transition_state(audit_id, "analyzing_sentiment", "finalizing", worker_id)
        if transitioned:
            logger.info(f"[pipeline] {audit_id}: analyzing_sentiment → finalizing (0 responses)")
        return

    total = len(responses)
    await db.update_audit_step(audit_id, "sentiment", {
        "status": "running", "message": f"Analyzing sentiment: 0/{total}"
    })
    await update_progress_counters(audit_id, sentiment_total=total, sentiment_processed=0, progress=75)

    logger.info(f"[pipeline] {audit_id}: sentiment analysis on {total} responses for brands: {brands}")

    # Process in batches of 15, save after each batch (checkpoint)
    batch_size = 15
    processed = 0
    for i in range(0, total, batch_size):
        batch = [dict(r) for r in responses[i:i + batch_size]]
        batch_updates = await openai_client.analyze_sentiment_batch(batch, brands, batch_size=batch_size)
        if batch_updates:
            await db.update_sentiment_batch(batch_updates)

        processed = min(i + batch_size, total)
        progress = 75 + round((processed / total) * 15)  # 75-90% for sentiment
        await update_progress_counters(audit_id, sentiment_processed=processed, progress=progress)
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "running",
            "message": f"Analyzing sentiment: {processed}/{total}",
            "processed_count": processed,
            "total_count": total,
        })

    await db.update_audit_step(audit_id, "sentiment", {
        "status": "done",
        "message": f"Sentiment analyzed for {processed} responses",
        "processed_count": processed,
        "total_count": total,
    })

    transitioned = await transition_state(audit_id, "analyzing_sentiment", "finalizing", worker_id)
    if transitioned:
        logger.info(f"[pipeline] {audit_id}: analyzing_sentiment → finalizing")


async def handle_finalize(audit_id: str, worker_id: str) -> None:
    """Compute metrics, refresh materialized views, mark completed."""
    await db.update_audit_step(audit_id, "persist", {
        "status": "running", "message": "Computing metrics..."
    })
    await update_progress_counters(audit_id, progress=90)

    try:
        await db.calculate_project_metrics(audit_id)
    except Exception as e:
        logger.warning(f"[pipeline] {audit_id}: metrics calculation warning: {e}")

    try:
        await db.refresh_audit_metrics(audit_id)
    except Exception as e:
        logger.warning(f"[pipeline] {audit_id}: audit metrics refresh warning: {e}")

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


# ── Main dispatcher ──────────────────────────────────────────────────

HANDLERS = {
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
        await handler(audit_id, worker_id)
    except Exception as e:
        logger.error(f"[pipeline] {audit_id} error in {state}: {e}", exc_info=True)
        # Don't fail immediately — allow retries on next tick
        # Only fail after sustained errors (timeout check in scheduler)


async def get_active_audits() -> list[dict]:
    """Get audits that need processing."""
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        result = await s.execute(text("""
            SELECT id, pipeline_state, locked_by, locked_at, started_at, status, sentiment
            FROM audits
            WHERE pipeline_state IN ('polling', 'extracting_competitors', 'analyzing_sentiment', 'finalizing')
            ORDER BY started_at ASC
            LIMIT 10
        """))
        return [dict(r._mapping) for r in result.fetchall()]
