"""
Audit endpoints — trigger-only design, all processing handled by audit_pipeline.

POST /audits/run          — trigger a new audit (background job creation)
POST /audits/{id}/poll    — manual poll trigger (compatibility)
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
    pipeline_state: Optional[str] = None
    current_step: Optional[str] = None
    progress: int = 0
    responses_expected: int = 0
    responses_received: int = 0
    competitors_processed: int = 0
    competitors_total: int = 0
    sentiment_processed: int = 0
    sentiment_total: int = 0
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
    *,
    audit_id: Optional[str] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    max_retries: int = 3,
) -> str:
    """Trigger a job on the OneSearch backend API (self — local).

    Retries up to `max_retries` times with exponential backoff (1s, 3s, 9s)
    to handle transient network / OneSearch outages.
    """
    provider = (provider_config or {}).get("provider", "brightdata")
    payload = {
        "prompts": prompts,
        "provider": provider,
        "geo_targeting": country or "FR",
        "source": SOURCE_MAP.get(llm, "chatgpt"),
    }
    if llm == "searchgpt":
        payload["web_search"] = force_web_search

    onesearch_url = settings.onesearch_api_url
    onesearch_key = settings.onesearch_api_key

    headers = {"Content-Type": "application/json"}
    if onesearch_key:
        headers["X-API-Key"] = onesearch_key

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{onesearch_url}/api/v1/jobs", headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                if attempt > 1:
                    logger.info(f"[run-audit] {llm}: job {data['id']} created on attempt {attempt}")
                else:
                    logger.info(f"[run-audit] {llm}: job {data['id']} created ({len(prompts)} prompts)")
                break  # success
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                delay = 3 ** (attempt - 1)  # 1s, 3s, 9s
                logger.warning(
                    f"[run-audit] {llm}: trigger attempt {attempt}/{max_retries} failed: {e} "
                    f"— retrying in {delay}s"
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    f"[run-audit] {llm}: all {max_retries} trigger attempts failed: {e}"
                )
                raise last_err

    # Best-effort cost capture (Brightdata / OneSearch — 1 job × N prompts).
    if audit_id:
        try:
            from app.services import cost_tracker
            await cost_tracker.record_scrape_call(
                audit_id=audit_id,
                project_id=project_id,
                user_id=user_id,
                provider=provider,
                llm=llm,
                prompt_count=len(prompts),
                metadata={"job_id": data.get("id"), "country": country or "FR"},
            )
        except Exception as ce:
            logger.warning(f"cost_tracker: scrape event not recorded: {ce}")

    return data["id"]


async def fetch_onesearch_results(job_id: str) -> Optional[list[dict]]:
    """Check job status and fetch converted results if completed.

    Paginates through all pages (per_page=500, API max) so jobs with
    >100 prompts return every result instead of only the first page.
    """
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

        # Fetch first page with max per_page to minimise round-trips.
        all_results: list[dict] = []
        page = 1
        while True:
            results_resp = await client.get(
                f"{onesearch_url}/api/v1/jobs/{job_id}/results"
                f"?format=converted&per_page=500&page={page}",
                headers=headers,
            )
            results_resp.raise_for_status()
            data = results_resp.json()

            if isinstance(data, list):
                # No pagination wrapper — raw list (legacy format)
                all_results.extend(data)
                break

            page_results = data.get("results", [])
            all_results.extend(page_results)

            pagination = data.get("pagination", {})
            total_pages = pagination.get("pages", 1)
            if page >= total_pages:
                break
            page += 1

        return all_results


# ── GET /audits/scheduler-health ─────────────────────────────────────
# Must be defined BEFORE parameterized routes (/{audit_id}/...) to avoid
# FastAPI matching "scheduler-health" as an audit_id.

@router.get("/scheduler-health")
async def scheduler_health():
    """Check if the background scheduler is alive and ticking."""
    from app.services.audit_scheduler import get_scheduler_health
    health = get_scheduler_health()
    if not health["alive"] or (health["stale_seconds"] or 0) >= 120:
        raise HTTPException(status_code=503, detail={**health, "error": "Scheduler is not responding"})
    return health


# ── POST /audits/run ──────────────────────────────────────────────────

@router.post("/run")
async def run_audit(req: RunAuditRequest, background_tasks: BackgroundTasks):
    """Trigger a new audit — returns immediately, scheduler handles all processing."""
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

    # Create audit with pipeline_state
    now = datetime.now(timezone.utc)
    total_responses = len(project["prompts"]) * len(audit_llms)
    audit = await db.create_audit({
        "project_id": req.projectId,
        "llms": audit_llms,
        "sentiment": enable_sentiment,
        "status": "running",
        "current_step": "getting_results",
        "pipeline_state": "fetching",
        "progress": 0,
        "started_at": now,
        "data_provider": provider_map.get(audit_llms[0], "BrightData"),
        "responses_expected": total_responses,
    })
    audit_id = str(audit["id"])

    # Create audit steps
    steps = ["fetch", "parse", "competitors", "sentiment", "persist"]
    await db.insert_audit_steps([
        {"audit_id": audit_id, "step": s, "status": "running" if s == "fetch" else "pending"}
        for s in steps
    ])

    # Background: trigger jobs → insert responses → hand off to scheduler
    async def _trigger_jobs():
        try:
            prompts = project["prompts"]
            prompt_texts = [p["prompt_text"] for p in prompts]
            llm_responses = []

            async def _trigger_llm(llm):
                try:
                    job_id = await trigger_onesearch_job(
                        llm, prompt_texts, project.get("country", "FR"),
                        force_web_search, provider_config_map.get(llm),
                        audit_id=audit_id,
                        project_id=req.projectId,
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

            # Insert in chunks
            await db.insert_llm_responses_chunked(llm_responses, chunk_size=50)

            successful = sum(1 for r in llm_responses if r.get("job_id"))
            total = len(llm_responses)

            # ── Guard: fail audit if zero jobs were triggered ──────────
            if total > 0 and successful == 0:
                logger.error(
                    f"[run-audit] {audit_id}: 0/{total} jobs triggered — "
                    f"failing audit (OneSearch unreachable after retries)"
                )
                await db.update_audit(audit_id, {
                    "status": "failed",
                    "pipeline_state": "failed",
                    "progress": 0,
                    "responses_expected": total,
                    "error_message": (
                        f"All {len(audit_llms)} LLM job triggers failed after retries. "
                        f"OneSearch API may be unreachable."
                    ),
                })
                await db.update_audit_step(audit_id, "fetch", {
                    "status": "error",
                    "message": f"0/{total} LLM jobs triggered — all providers failed",
                })
                return  # Don't transition to polling

            progress = round((successful / total) * 10) if total else 0

            await db.update_audit(audit_id, {
                "progress": progress,
                "pipeline_state": "polling",  # Hand off to scheduler
                "responses_expected": total,
            })
            await db.update_audit_step(audit_id, "fetch", {
                "status": "done", "message": f"{successful}/{total} LLM jobs triggered"
            })
            logger.info(f"[run-audit] {audit_id}: {successful}/{total} jobs triggered → polling")
            # Note: no inline warm-start. The scheduler picks the audit up on
            # its next tick (≤15s) and `handle_polling` heartbeats + pushes
            # counters from the very first iteration, so the modal flips to
            # "Receiving answers" without a hidden coupling between this
            # request handler and the pipeline module.

        except Exception as e:
            logger.error(f"[run-audit] Background error: {e}", exc_info=True)
            await db.update_audit(audit_id, {
                "status": "failed",
                "pipeline_state": "failed",
                "current_step": None,
            })

    background_tasks.add_task(_trigger_jobs)

    return {"success": True, "auditId": audit_id, "message": "Audit started"}


# ── POST /audits/{audit_id}/poll ──────────────────────────────────────

@router.post("/{audit_id}/poll")
async def poll_audit(audit_id: str):
    """Manual poll trigger — delegates to pipeline."""
    audit = await db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    from app.services.audit_pipeline import WORKER_ID, process_step
    await process_step(audit, WORKER_ID)
    return {"success": True, "message": "Poll completed"}


# ── GET /audits/{audit_id}/status ─────────────────────────────────────

@router.get("/{audit_id}/status", response_model=AuditStatusResponse)
async def get_audit_status(audit_id: str):
    """Lightweight status check with pipeline progress counters."""
    audit = await db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        steps = (await s.execute(
            text("""SELECT step, status, message, processed_count, total_count
                    FROM audit_steps WHERE audit_id = :aid ORDER BY created_at"""),
            {"aid": audit_id},
        )).mappings().all()

    return AuditStatusResponse(
        audit_id=audit_id,
        status=audit.get("status", "unknown"),
        pipeline_state=audit.get("pipeline_state"),
        current_step=audit.get("current_step"),
        progress=audit.get("progress", 0),
        responses_expected=audit.get("responses_expected", 0),
        responses_received=audit.get("responses_received", 0),
        competitors_processed=audit.get("competitors_processed", 0),
        competitors_total=audit.get("competitors_total", 0),
        sentiment_processed=audit.get("sentiment_processed", 0),
        sentiment_total=audit.get("sentiment_total", 0),
        steps=[dict(s) for s in steps],
    )


# ── POST /audits/{audit_id}/resume ────────────────────────────────────

@router.post("/{audit_id}/resume")
async def resume_audit(audit_id: str):
    """Manually un-stick a stalled audit so the scheduler picks it up.

    Clears the CAS lock, bumps ``last_activity_at`` to now(), and resets
    ``error_message`` — the next scheduler tick will claim the audit and
    continue from its current ``pipeline_state``.
    """
    audit = await db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    state = audit.get("pipeline_state", "")
    status = audit.get("status", "")

    if status not in ("running", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume audit with status '{status}' — only running/pending audits",
        )

    resumable = {
        "polling", "extracting_competitors", "analyzing_sentiment",
        "finalizing", "created", "fetching",
    }
    if state not in resumable:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume audit in pipeline_state '{state}'",
        )

    await db.update_audit(audit_id, {
        "locked_by": None,
        "locked_at": None,
        "last_activity_at": datetime.now(timezone.utc).isoformat(),
        "error_message": None,
    })

    logger.info(f"[resume] Audit {audit_id} manually resumed (state={state})")
    return {
        "success": True,
        "message": f"Audit resumed — scheduler will pick it up within 15s",
        "audit_id": audit_id,
        "pipeline_state": state,
    }


# ── POST /audits/{audit_id}/reprocess ──────────────────────────────

REPROCESS_STAGES = {"extracting_competitors", "analyzing_sentiment", "finalizing"}

# Legacy step names for backward-compat with the frontend status modal.
_LEGACY_STEP = {
    "extracting_competitors": "processing_results",
    "analyzing_sentiment": "sentiment_analysis",
    "finalizing": "completing",
}

# Starting progress values that match what each handler expects.
_STAGE_PROGRESS = {
    "extracting_competitors": 60,
    "analyzing_sentiment": 75,
    "finalizing": 90,
}


@router.post("/{audit_id}/reprocess")
async def reprocess_audit(audit_id: str, from_stage: str = "extracting_competitors"):
    """Re-enter the pipeline for a completed or failed audit.

    Use after a backfill that restored ``answer_text`` for rows that missed
    competitor extraction or sentiment analysis in the original pipeline run.

    Resets the relevant progress counters to 0 so the force-skip guards in
    ``handle_competitors`` / ``handle_sentiment`` don't poison the new rows.
    The scheduler picks the audit up within 15 seconds.
    """
    if from_stage not in REPROCESS_STAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid from_stage '{from_stage}'. "
                   f"Must be one of: {', '.join(sorted(REPROCESS_STAGES))}",
        )

    audit = await db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    status = audit.get("status", "")
    if status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reprocess audit with status '{status}' — "
                   f"only completed or failed audits",
        )

    update: dict = {
        "pipeline_state": from_stage,
        "status": "running",
        "progress": _STAGE_PROGRESS[from_stage],
        "current_step": _LEGACY_STEP[from_stage],
        "locked_by": None,
        "locked_at": None,
        "last_activity_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "error_message": None,
    }

    # Reset counters that the re-entered stages will recalculate.
    if from_stage in ("extracting_competitors", "analyzing_sentiment"):
        update["sentiment_processed"] = 0
        update["sentiment_total"] = 0
    if from_stage == "extracting_competitors":
        update["competitors_processed"] = 0
        update["competitors_total"] = 0

    await db.update_audit(audit_id, update)

    logger.info(
        f"[reprocess] Audit {audit_id} re-entered pipeline at '{from_stage}' "
        f"(was status={status})"
    )
    return {
        "success": True,
        "message": f"Audit pipeline reset to '{from_stage}' — "
                   f"scheduler will pick it up within 15s",
        "audit_id": audit_id,
        "pipeline_state": from_stage,
    }


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
