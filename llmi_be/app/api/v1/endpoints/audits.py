"""
Audit endpoints — replaces run-audit, poll-audit-results, and status edge functions.

POST /audits/run          — trigger a new audit (background processing)
POST /audits/{id}/poll    — poll for results (called by scheduler)
GET  /audits/{id}/status  — lightweight status check for frontend
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.services.supabase_db import db
from app.services import openai_client

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

LLM_NAME_MAP = {
    "searchgpt": "SearchGPT",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
    "google-ai-overview": "Google AI Overview",
    "google-ai-mode": "Google AI Mode",
    "bing-copilot": "Bing Copilot",
    "grok": "Grok",
}

SOURCE_MAP = {
    "searchgpt": "chatgpt",
    "perplexity": "perplexity",
    "gemini": "gemini",
    "google-ai-overview": "google_ai_overview",
    "google-ai-mode": "google_ai_mode",
    "bing-copilot": "copilot",
    "grok": "grok",
}


# ── Schemas ───────────────────────────────────────────────────────────

class RunAuditRequest(BaseModel):
    projectId: str
    llms: Optional[list[str]] = None
    enableSentiment: Optional[bool] = True
    forceWebSearch: Optional[bool] = True
    groupIds: Optional[list[str]] = None
    isScheduled: Optional[bool] = False


class AuditStatusResponse(BaseModel):
    audit_id: str
    status: str
    current_step: Optional[str] = None
    progress: int = 0
    steps: list[dict] = []


# ── Helpers ───────────────────────────────────────────────────────────

def extract_domain(url: str) -> str:
    try:
        return urlparse(url).hostname.replace("www.", "")
    except Exception:
        return url


def collect_citations(result: dict, response: dict) -> list[dict]:
    """Collect citations from an LLM result — pure function, no DB ops."""
    citations = []
    llm = response["llm"]
    base = {
        "audit_id": response["audit_id"],
        "prompt_id": response["prompt_id"],
        "llm": llm,
        "checked_at": datetime.now(timezone.utc),
    }

    def _add(url, text, position, cited=None):
        citations.append({
            **base,
            "page_url": url,
            "domain": extract_domain(url),
            "citation_text": text or "No description available",
            "position": position,
            **({"cited": cited} if cited is not None else {}),
        })

    # SearchGPT / ChatGPT
    if llm in ("searchgpt", "chatgpt") and result.get("links_attached"):
        for i, link in enumerate(result["links_attached"]):
            _add(link.get("url", ""), link.get("text") or link.get("title"), link.get("position", i + 1), link.get("cited"))
    elif llm == "perplexity" and result.get("sources"):
        for i, src in enumerate(result["sources"]):
            _add(src.get("url", ""), src.get("title") or src.get("description") or src.get("snippet"), i + 1)
    elif llm in ("google-ai-overview", "google-ai-mode") and result.get("aio_citations"):
        for i, cit in enumerate(result["aio_citations"]):
            _add(cit.get("url") or cit.get("link", ""), cit.get("title") or cit.get("text") or cit.get("snippet"), i + 1)
    elif llm in ("google-ai-overview", "google-ai-mode") and result.get("organic"):
        for i, item in enumerate(result["organic"]):
            _add(item.get("url") or item.get("link", ""), item.get("title") or item.get("description"), i + 1)
    elif llm == "gemini" and result.get("links_attached"):
        for i, link in enumerate(result["links_attached"]):
            _add(link.get("url", ""), link.get("text"), link.get("position", i + 1))
    elif llm in ("searchgpt", "chatgpt") and result.get("citations"):
        for i, cit in enumerate(result["citations"]):
            _add(cit.get("url", ""), cit.get("text") or cit.get("title"), i + 1, cit.get("cited"))

    # Generic fallback: any LLM with a "citations" field (covers Perplexity, Grok, etc.)
    if not citations and result.get("citations"):
        for i, cit in enumerate(result["citations"]):
            _add(
                cit.get("url", ""),
                cit.get("title") or cit.get("text") or cit.get("description"),
                i + 1,
                cit.get("cited"),
            )

    return citations


async def trigger_onesearch_job(
    llm: str, prompts: list[str], country: str, force_web_search: bool,
    provider_config: Optional[dict] = None,
) -> str:
    """Trigger a job on the OneSearch backend API (self — local)."""
    provider = (provider_config or {}).get("provider", "brightdata")
    payload = {
        "prompts": prompts,
        "provider": provider,
        "geo_targeting": country or "FR",
        "source": SOURCE_MAP.get(llm, "chatgpt"),
    }
    if llm == "searchgpt":
        payload["web_search"] = force_web_search

    # Call ourselves (the same FastAPI backend that hosts jobs)
    onesearch_url = settings.onesearch_api_url
    onesearch_key = settings.onesearch_api_key

    headers = {"Content-Type": "application/json"}
    if onesearch_key:
        headers["X-API-Key"] = onesearch_key

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(f"{onesearch_url}/api/v1/jobs", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        logger.info(f"[run-audit] {llm}: job {data['id']} created ({len(prompts)} prompts)")
        return data["id"]


async def fetch_onesearch_results(job_id: str) -> Optional[list[dict]]:
    """Check job status and fetch converted results if completed."""
    onesearch_url = settings.onesearch_api_url
    onesearch_key = settings.onesearch_api_key

    headers = {}
    if onesearch_key:
        headers["X-API-Key"] = onesearch_key

    async with httpx.AsyncClient(timeout=30.0) as client:
        status_resp = await client.get(f"{onesearch_url}/api/v1/jobs/{job_id}", headers=headers)
        if status_resp.status_code == 404:
            return None
        status_resp.raise_for_status()
        status_data = status_resp.json()

        if status_data.get("status") in ("failed", "Failed"):
            raise Exception(f"OneSearch job failed: {status_data}")

        if status_data.get("status") != "completed" or not status_data.get("converted_results_file"):
            return None

        results_resp = await client.get(
            f"{onesearch_url}/api/v1/jobs/{job_id}/results?format=converted", headers=headers
        )
        results_resp.raise_for_status()
        data = results_resp.json()
        return data.get("results", data) if isinstance(data, dict) else data


# ── POST /audits/run ──────────────────────────────────────────────────

@router.post("/run")
async def run_audit(req: RunAuditRequest, background_tasks: BackgroundTasks):
    """Trigger a new audit — returns immediately, processing in background."""
    audit_llms = req.llms or ["searchgpt", "perplexity"]
    enable_sentiment = req.enableSentiment if req.enableSentiment is not None else True
    force_web_search = req.forceWebSearch if req.forceWebSearch is not None else True

    # Get project
    try:
        project = await db.get_project_with_prompts(req.projectId)
    except Exception as e:
        logger.error(f"[run-audit] Error fetching project {req.projectId}: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid project ID: {req.projectId}")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get provider settings
    llm_display_names = [LLM_NAME_MAP.get(llm, llm) for llm in audit_llms]
    provider_settings = await db.get_llm_provider_settings(llm_display_names)
    provider_map = {}
    provider_config_map = {}
    for llm in audit_llms:
        display = LLM_NAME_MAP.get(llm, llm)
        setting = next((s for s in provider_settings if s["llm_name"] == display), None)
        provider_map[llm] = (setting or {}).get("data_provider", "BrightData")
        if setting and setting.get("provider_config"):
            provider_config_map[llm] = setting["provider_config"]

    # Create audit
    now = datetime.now(timezone.utc)
    audit = await db.create_audit({
        "project_id": req.projectId,
        "llms": audit_llms,
        "sentiment": enable_sentiment,
        "status": "running",
        "current_step": "getting_results",
        "progress": 0,
        "started_at": now,
        "data_provider": provider_map.get(audit_llms[0], "BrightData"),
    })
    audit_id = str(audit["id"])

    # Create audit steps
    steps = ["fetch", "parse", "competitors", "sentiment", "persist"]
    await db.insert_audit_steps([
        {"audit_id": audit_id, "step": s, "status": "running" if s == "fetch" else "pending"}
        for s in steps
    ])

    # Trigger LLM jobs in background
    async def _run_audit_background():
        try:
            prompts = project["prompts"]
            prompt_texts = [p["prompt_text"] for p in prompts]
            llm_responses = []

            # Trigger all LLMs in parallel
            async def _trigger_llm(llm):
                try:
                    job_id = await trigger_onesearch_job(
                        llm, prompt_texts, project.get("country", "FR"),
                        force_web_search, provider_config_map.get(llm),
                    )
                    for p in prompts:
                        llm_responses.append({
                            "audit_id": audit_id,
                            "prompt_id": str(p["id"]),
                            "llm": llm,
                            "job_id": job_id,
                            "country": project.get("country", "FR"),
                            "data_provider": provider_map.get(llm, "BrightData"),
                        })
                except Exception as e:
                    logger.error(f"[run-audit] Failed to trigger {llm}: {e}")
                    for p in prompts:
                        llm_responses.append({
                            "audit_id": audit_id,
                            "prompt_id": str(p["id"]),
                            "llm": llm,
                            "country": project.get("country", "FR"),
                            "data_provider": provider_map.get(llm, "BrightData"),
                            "raw_response_data": {"error": str(e)},
                        })

            await asyncio.gather(*[_trigger_llm(llm) for llm in audit_llms])

            # Insert in chunks (50 per batch)
            await db.insert_llm_responses_chunked(llm_responses, chunk_size=50)

            successful = sum(1 for r in llm_responses if r.get("job_id"))
            total = len(llm_responses)
            progress = round((successful / total) * 25) if total else 0

            await db.update_audit(audit_id, {"progress": progress})
            await db.update_audit_step(audit_id, "fetch", {
                "status": "done", "message": "All LLM queries triggered successfully"
            })
            logger.info(f"[run-audit] {audit_id}: {successful}/{total} jobs triggered")

            # Aggressive polling loop — don't wait for scheduler
            await asyncio.sleep(15)  # Let BrightData start processing
            for poll_round in range(30):  # Up to ~5 min (30 × 10s)
                try:
                    await _poll_for_results(audit_id)
                except Exception as poll_err:
                    logger.warning(f"[run-audit] Poll round {poll_round} error: {poll_err}")

                # Check if audit is done or no longer running
                audit_check = await db.get_audit(audit_id)
                if audit_check and audit_check.get("status") != "running":
                    logger.info(f"[run-audit] {audit_id}: audit no longer running, stopping poll loop")
                    break

                pending_check = await db.get_pending_responses(audit_id, limit=1)
                if not pending_check:
                    logger.info(f"[run-audit] {audit_id}: all responses received, stopping poll loop")
                    break

                await asyncio.sleep(10)

        except Exception as e:
            logger.error(f"[run-audit] Background error: {e}")
            await db.update_audit(audit_id, {"status": "failed", "current_step": None})

    background_tasks.add_task(_run_audit_background)

    return {"success": True, "auditId": audit_id, "message": "Audit started"}


# ── POST /audits/{audit_id}/poll ──────────────────────────────────────

@router.post("/{audit_id}/poll")
async def poll_audit(audit_id: str):
    """Poll for results, process citations, run competitors+sentiment if done."""
    audit = await db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    await _poll_for_results(audit_id)
    return {"success": True, "message": "Poll completed"}


async def _poll_for_results(audit_id: str):
    """Core polling logic — reused by endpoint and scheduler."""
    # Update parse step
    await db.update_audit_step(audit_id, "parse", {
        "status": "running", "message": "Polling for LLM results..."
    }, status_filter="pending")

    now = datetime.now(timezone.utc)
    await db.update_audit(audit_id, {"current_step": "getting_results", "last_activity_at": now}, filters={"status": "running"})

    # Get pending responses
    pending = await db.get_pending_responses(audit_id, limit=500)
    if not pending:
        await _check_and_complete(audit_id)
        return

    logger.info(f"Processing {len(pending)} pending responses for {audit_id}")

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
                                    "citations": matched.get("citations"),
                                    "all_sources": matched.get("all_sources"),
                                    "links_attached": matched.get("links_attached"),
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
        logger.info(f"Updated {len(updates)} llm_responses")

    # Batch process citations (single batch delete + insert, NOT N+1)
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
            logger.info(f"Inserted {len(all_citations)} citations")

    # Summary
    ok = sum(1 for r in results if r.get("success"))
    failed = sum(1 for r in results if not r.get("success") and r.get("update"))
    not_ready = sum(1 for r in results if r.get("reason") == "not_ready")
    logger.info(f"Poll {audit_id}: {ok} ok, {failed} failed, {not_ready} not ready")

    await _check_and_complete(audit_id)
    await db.refresh_audit_metrics(audit_id)


async def _check_and_complete(audit_id: str):
    """Check if all responses are processed and run completion tasks."""
    all_responses = await db.get_all_responses_for_audit(audit_id)
    if not all_responses:
        return

    unprocessed = [
        r for r in all_responses
        if not r.get("answer_text") and not (r.get("raw_response_data") and
            (isinstance(r["raw_response_data"], dict) and r["raw_response_data"]) or
            (isinstance(r["raw_response_data"], str) and r["raw_response_data"] != "{}"))
    ]

    logger.info(f"Audit {audit_id}: {len(unprocessed)}/{len(all_responses)} pending")

    if unprocessed:
        return

    # All done — run completion
    logger.info(f"All responses processed for {audit_id}, completing audit")
    await _complete_audit(audit_id)


async def _complete_audit(audit_id: str):
    """Run competitors extraction, sentiment analysis, and finalize."""
    audit = await db.get_audit(audit_id)
    if not audit:
        return
    # Guard against concurrent completion (scheduler + background loop)
    if audit.get("current_step") == "completing":
        logger.info(f"Audit {audit_id} already completing, skipping")
        return
    sentiment_enabled = audit.get("sentiment", False)

    # Record when processing starts (for duration tracking) and claim the lock
    now = datetime.now(timezone.utc)
    await db.update_audit(audit_id, {"processing_started_at": now, "current_step": "completing"})

    # Competitors extraction (inline — no edge function invocation!)
    try:
        await _run_competitors(audit_id)
    except Exception as e:
        logger.error(f"[competitors] {audit_id}: extraction failed: {e}", exc_info=True)

    # Sentiment analysis
    if sentiment_enabled:
        await _run_sentiment(audit_id)

    # Finalize
    now = datetime.now(timezone.utc)
    await db.update_audit_step(audit_id, "parse", {"status": "done", "message": "LLM results parsed"})
    await db.update_audit_step(audit_id, "sentiment", {"status": "done"})
    await db.update_audit_step(audit_id, "persist", {"status": "done"})
    await db.update_audit(audit_id, {
        "status": "completed", "progress": 100, "current_step": None, "finished_at": now,
    })
    await db.calculate_project_metrics(audit_id)
    logger.info(f"Audit {audit_id} completed")


async def _run_competitors(audit_id: str):
    """Run competitor extraction inline — replaces edge function invocations."""
    # NOTE: Don't skip based on step status — DB cron jobs may mark steps "done"
    # before competitors are actually extracted. We check actual data instead
    # (get_responses_for_competitors filters for answer_competitors IS NULL).

    try:
        await db.update_audit_step(audit_id, "competitors", {
            "status": "running", "message": "Extracting competitors..."
        })
    except Exception as e:
        logger.warning(f"Failed to update competitors step: {e}")
    await db.update_audit(audit_id, {"current_step": "processing_results"}, filters={"status": "running"})

    responses = await db.get_responses_for_competitors(audit_id)
    logger.info(f"[competitors] {audit_id}: {len(responses)} responses need extraction")
    if not responses:
        await db.update_audit_step(audit_id, "competitors", {
            "status": "done", "message": "No responses to process"
        })
        return

    # Fetch project context for better extraction
    own_brands, project_id, _ = await db.get_own_brands(audit_id)
    competitor_brands = await db.get_competitor_brands(audit_id)
    project_name = await db.get_project_name(audit_id)

    logger.info(f"Extracting competitors from {len(responses)} responses "
                f"(industry: {project_name}, own: {own_brands}, competitors: {competitor_brands})")

    # Batch process with concurrency control (max 5 parallel OpenAI calls via semaphore)
    updates = await openai_client.extract_competitors_batch(
        responses, batch_size=10, delay=0.2,
        industry=project_name or "",
        known_brands=own_brands,
        known_competitors=competitor_brands,
    )
    await db.update_competitors_batch(updates)

    await db.update_audit_step(audit_id, "competitors", {
        "status": "done", "message": f"Competitors extracted for {len(updates)} responses"
    })
    logger.info(f"Competitors done for {audit_id}: {len(updates)} responses")


async def _run_sentiment(audit_id: str):
    """Run sentiment analysis inline — replaces edge function invocations."""
    await db.update_audit_step(audit_id, "sentiment", {
        "status": "running", "message": "Running sentiment analysis..."
    })
    await db.update_audit(audit_id, {"current_step": "sentiment_analysis"}, filters={"status": "running"})

    brands, project_id, created_by = await db.get_own_brands(audit_id)
    if not brands:
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "done", "message": "No brands for sentiment analysis"
        })
        return

    responses = await db.get_responses_for_sentiment(audit_id)
    if not responses:
        await db.update_audit_step(audit_id, "sentiment", {
            "status": "done", "message": "No responses for sentiment analysis"
        })
        return

    logger.info(f"Sentiment analysis on {len(responses)} responses for brands: {brands}")

    updates = await openai_client.analyze_sentiment_batch(
        [dict(r) for r in responses], brands, batch_size=15
    )
    await db.update_sentiment_batch(updates)

    await db.update_audit_step(audit_id, "sentiment", {
        "status": "done", "message": f"Sentiment analyzed for {len(updates)} responses"
    })
    logger.info(f"Sentiment done for {audit_id}: {len(updates)} responses")


# ── GET /audits/{audit_id}/status ─────────────────────────────────────

@router.get("/{audit_id}/status", response_model=AuditStatusResponse)
async def get_audit_status(audit_id: str):
    """Lightweight status check — single SELECT."""
    audit = await db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        steps = (await s.execute(
            text("SELECT step, status, message FROM audit_steps WHERE audit_id = :aid ORDER BY created_at"),
            {"aid": audit_id},
        )).mappings().all()

    return AuditStatusResponse(
        audit_id=audit_id,
        status=audit.get("status", "unknown"),
        current_step=audit.get("current_step"),
        progress=audit.get("progress", 0),
        steps=[dict(s) for s in steps],
    )


# ── BrightData legacy fetch ──────────────────────────────────────────

async def _fetch_brightdata_result(llm: str, snapshot_id: str, api_key: str) -> Optional[dict]:
    """Fetch a BrightData snapshot result (legacy path)."""
    url = f"https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json"
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        return data[0] if isinstance(data, list) and data else data
