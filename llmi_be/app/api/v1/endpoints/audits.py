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
