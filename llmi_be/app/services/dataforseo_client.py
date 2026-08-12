"""
DataForSEO client — Google AI Overview + organic results, and Gemini.

Two source families, routed by `source` in process_all_prompts():
  • google_ai_overview → SERP "live/advanced" with load_async_ai_overview
    (AI Overview block + organic results).
  • gemini → ai_optimization/gemini/llm_responses/live (answer + fan-out
    queries + grounding annotations, whose redirect URLs are resolved to
    their final destinations).

The client maps each DataForSEO task result into the SAME canonical
"converted" record shape produced by
`json_converter.convert_google_aio_record` (answer_text = AI Overview
markdown, citations / all_sources = AI Overview references, organic =
organic items). That lets the existing OneSearch polling path
(`audit_pipeline.handle_polling`) consume DataForSEO results with no
special-casing.

Interface mirrors BrightDataClient / SerpClient so job_processor can
call it the same way:
    results, failed_queries = await client.process_all_prompts(
        prompts=..., geo_targeting=..., source=..., progress_callback=...)
`results` is the list of canonical converted dicts; `failed_queries` is
the list of keywords that returned no AI Overview / errored.

Device is always "mobile" (per product requirement).
"""

import asyncio
import base64
import logging
from datetime import datetime
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


# country (ISO-2) → (DataForSEO location_code, language_code)
# location codes from DataForSEO's locations list. Fallback: US/English.
COUNTRY_LOCATION_LANG = {
    "ES": (2724, "es"),
    "FR": (2250, "fr"),
    "DE": (2276, "de"),
    "IT": (2380, "it"),
    "PT": (2620, "pt"),
    "NL": (2528, "nl"),
    "BE": (2056, "fr"),
    "GB": (2826, "en"),
    "UK": (2826, "en"),
    "IE": (2372, "en"),
    "US": (2840, "en"),
    "CA": (2124, "en"),
    "MX": (2484, "es"),
    "BR": (2076, "pt"),
    "AR": (2032, "es"),
    "PL": (2616, "pl"),
    "SE": (2752, "sv"),
    "CH": (2756, "de"),
    "AT": (2040, "de"),
}
DEFAULT_LOCATION_LANG = (2840, "en")


def _clean_domain(raw: Optional[str], url: Optional[str]) -> str:
    """DataForSEO sometimes returns domain as a markdown link, e.g.
    '[www.x.com](https://www.x.com)'. Prefer deriving from the URL;
    otherwise strip markdown wrapping from the raw domain string."""
    if url:
        try:
            host = urlparse(url).hostname
            if host:
                return host.lower().replace("www.", "", 1) if host.lower().startswith("www.") else host.lower()
        except Exception:
            pass
    if not raw:
        return ""
    # strip a leading "[text](url)" markdown wrapper → keep the text
    if raw.startswith("[") and "](" in raw:
        raw = raw[1:raw.index("](")]
    return raw.strip().lower().replace("www.", "", 1) if raw.lower().startswith("www.") else raw.strip().lower()


class DataForSeoClient:
    def __init__(
        self,
        login: str = None,
        password: str = None,
        base_url: str = None,
        batch_size: int = None,
        max_concurrent: int = None,
    ):
        self.login = login or settings.dataforseo_login
        self.password = password or settings.dataforseo_password
        self.base_url = (base_url or settings.dataforseo_base_url).rstrip("/")
        # NOTE: with load_async_ai_overview the synchronous live/advanced
        # endpoint processes keywords serially server-side (~12-20s each).
        # Batching many keywords into one request blows past DataForSEO's
        # live-request window and the server drops the connection
        # ("Server disconnected without sending a response"). So we send a
        # SMALL number of keywords per request (default 1) and parallelise
        # with bounded concurrency instead.
        self.batch_size = batch_size or getattr(settings, "dataforseo_batch_size", 1)
        self.max_concurrent = max_concurrent or getattr(settings, "dataforseo_max_concurrent", 10)
        # Gemini (ai_optimization) params.
        self.gemini_model = getattr(settings, "dataforseo_gemini_model", "gemini-3.5-flash")
        self.gemini_web_search = getattr(settings, "dataforseo_gemini_web_search", True)
        self.gemini_max_tokens = getattr(settings, "dataforseo_gemini_max_output_tokens", 2048)
        self.gemini_temperature = getattr(settings, "dataforseo_gemini_temperature", 1.3)
        self.gemini_top_p = getattr(settings, "dataforseo_gemini_top_p", 0.9)
        self.gemini_system_message = getattr(
            settings, "dataforseo_gemini_system_message",
            "You are a helpful assistant that provides accurate information.",
        )
        token = base64.b64encode(f"{self.login}:{self.password}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }
        self.total_cost = 0.0

    # ── location/language resolution ─────────────────────────────────
    @staticmethod
    def _resolve_location(geo_targeting: str) -> tuple[int, str]:
        if not geo_targeting:
            return DEFAULT_LOCATION_LANG
        key = geo_targeting.strip().upper()
        # audit path sends a 2-letter country code; if a full geo string
        # slipped in, take the last comma segment as a best effort.
        if key not in COUNTRY_LOCATION_LANG and "," in key:
            key = key.split(",")[-1].strip()
        return COUNTRY_LOCATION_LANG.get(key, DEFAULT_LOCATION_LANG)

    # ── response → canonical converted record ────────────────────────
    def _convert_task(self, task: dict, country: str) -> Optional[dict]:
        """Map one DataForSEO task → the canonical google_ai_overview
        converted record. Returns None if the task errored / has no
        usable result (caller treats that as a failed keyword)."""
        data = task.get("data") or {}
        results = task.get("result") or []
        if task.get("status_code") != 20000 or not results:
            return None
        res0 = results[0] or {}
        keyword = res0.get("keyword") or data.get("keyword") or ""
        items = res0.get("items") or []

        aio = next((it for it in items if it.get("type") == "ai_overview"), None)

        answer_text = ""
        all_sources: list[dict] = []
        citations: list[dict] = []
        links_attached: list[dict] = []

        if aio:
            answer_text = aio.get("markdown") or ""
            # Top-level references (right-rail source cards) → all_sources.
            for ref in (aio.get("references") or []):
                url = ref.get("url")
                if not url:
                    continue
                src = {
                    "url": url,
                    "title": ref.get("title"),
                    "source": ref.get("source"),
                    "text": ref.get("text"),
                    "domain": _clean_domain(ref.get("domain"), url),
                }
                all_sources.append(src)
                citations.append({"url": url, "title": ref.get("title"), "domain": src["domain"]})
            # Inline links inside AIO elements → links_attached + extra sources.
            for el in (aio.get("items") or []):
                for ln in (el.get("links") or []):
                    url = ln.get("url")
                    if not url:
                        continue
                    links_attached.append({
                        "url": url,
                        "title": ln.get("title"),
                        "domain": _clean_domain(ln.get("domain"), url),
                    })
                # element-level references also count as sources
                for ref in (el.get("references") or []):
                    url = ref.get("url")
                    if not url:
                        continue
                    if not any(s["url"] == url for s in all_sources):
                        dom = _clean_domain(ref.get("domain"), url)
                        all_sources.append({
                            "url": url, "title": ref.get("title"),
                            "source": ref.get("source"), "text": ref.get("text"),
                            "domain": dom,
                        })
                        citations.append({"url": url, "title": ref.get("title"), "domain": dom})

        # Empty ai_overview block: the SERP HAS an AI Overview, but it came
        # back without content — typically the asynchronously-rendered AIO
        # didn't finish inside DataForSEO's live window. Unlike "no AIO on
        # this SERP" (aio is None), this is retryable.
        aio_placeholder = False
        if aio and not answer_text and not all_sources and not links_attached:
            aio_placeholder = True
            logger.warning(
                f"DataForSEO: empty ai_overview block for '{keyword[:60]}' "
                f"(async={aio.get('asynchronous_ai_overview')!r}, "
                f"keys={list(aio.keys())[:8]})"
            )

        # Organic results → compact list (stored in organic_results column).
        organic: list[dict] = []
        for it in items:
            if it.get("type") != "organic":
                continue
            url = it.get("url")
            organic.append({
                "rank": it.get("rank_absolute") or it.get("rank_group"),
                "link": url,
                "url": url,
                "title": it.get("title"),
                "description": it.get("description"),
                "domain": _clean_domain(it.get("domain"), url),
            })

        timestamp = res0.get("datetime") or (datetime.utcnow().isoformat(timespec="milliseconds") + "Z")

        return {
            "map": None,
            "url": res0.get("check_url") or "https://www.google.com/",
            "index": None,
            "input": {"keyword": keyword, "country": country},
            "model": "google_ai_overview",
            "is_map": False,
            "prompt": keyword,
            "country": country,
            "shopping": [],
            "shopping_visible": False,
            "citations": citations,
            "timestamp": timestamp,
            "references": [],
            "answer_text": answer_text,
            "links_attached": links_attached,
            "answer_section_html": "",
            "answer_text_markdown": answer_text,
            "web_search_triggered": True,
            "web_search_query": keyword,
            "search_sources": [],
            "recommendations": [],
            "additional_prompt": "",
            "additional_answer_text": None,
            "all_sources": all_sources,
            "organic": organic,
            # Internal marker — popped by process_all_prompts, never persisted.
            "_aio_placeholder": aio_placeholder,
        }

    # ── Gemini (ai_optimization/gemini/llm_responses/live) ───────────
    async def _resolve_urls(
        self, client: httpx.AsyncClient, urls: list[str], cache: dict[str, str],
    ) -> dict[str, str]:
        """Resolve Vertex AI grounding-redirect URLs to their final
        destinations. Gemini annotation URLs are
        `vertexaisearch.cloud.google.com/grounding-api-redirect/...` — we
        follow the redirect (streamed, so we don't download the page body)
        and capture the final URL. Cached + concurrency-capped; on any
        failure we keep the original redirect URL.
        """
        sem = asyncio.Semaphore(5)  # be gentle with Google's redirector

        async def one(u: str) -> None:
            if u in cache:
                return
            final = u
            try:
                async with sem:
                    async with client.stream(
                        "GET", u, follow_redirects=True, timeout=15.0,
                    ) as resp:
                        final = str(resp.url)
            except Exception:
                final = u
            cache[u] = final

        await asyncio.gather(*[one(u) for u in urls])
        return {u: cache.get(u, u) for u in urls}

    async def _post_gemini_one(
        self, client: httpx.AsyncClient, prompt: str, max_retries: int,
    ) -> dict:
        """POST one prompt to the Gemini llm_responses live endpoint."""
        payload = [{
            "model_name": self.gemini_model,
            "user_prompt": prompt,
            "web_search": self.gemini_web_search,
            "max_output_tokens": self.gemini_max_tokens,
            "temperature": self.gemini_temperature,
            "top_p": self.gemini_top_p,
            "system_message": self.gemini_system_message,
        }]
        url = f"{self.base_url}/v3/ai_optimization/gemini/llm_responses/live"
        last_err = None
        for attempt in range(1, max_retries + 1):
            try:
                resp = await client.post(url, json=payload, headers=self.headers)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                last_err = e
                if attempt < max_retries:
                    await asyncio.sleep(3 ** (attempt - 1))
                else:
                    raise last_err

    async def _convert_gemini(
        self, client: httpx.AsyncClient, task: dict, prompt: str, url_cache: dict[str, str],
    ) -> Optional[dict]:
        """Map a Gemini llm_responses task → the canonical converted record.

        answer_text = the message text; citations / all_sources = the text
        annotations (with redirect URLs resolved to finals);
        web_search_query = fan_out_queries.
        """
        results = task.get("result") or []
        if task.get("status_code") != 20000 or not results:
            return None
        res0 = results[0] or {}

        text_parts: list[str] = []
        annotations: list[dict] = []
        for item in (res0.get("items") or []):
            if item.get("type") != "message":
                continue
            for sec in (item.get("sections") or []):
                if sec.get("type") != "text":
                    continue
                if sec.get("text"):
                    text_parts.append(sec["text"])
                for ann in (sec.get("annotations") or []):
                    if ann.get("url"):
                        annotations.append(ann)

        answer_text = "\n\n".join(text_parts).strip()
        fan_out = [str(q) for q in (res0.get("fan_out_queries") or []) if q]

        # Resolve grounding-redirect URLs → final URLs (deduped + cached).
        unique = list({a["url"] for a in annotations})
        resolved = await self._resolve_urls(client, unique, url_cache) if unique else {}

        citations: list[dict] = []
        all_sources: list[dict] = []
        seen: set[str] = set()
        for a in annotations:
            final = resolved.get(a["url"], a["url"])
            if final in seen:
                continue
            seen.add(final)
            dom = _clean_domain(None, final)
            title = a.get("title")
            citations.append({"url": final, "page_url": final, "title": title, "domain": dom, "cited": True})
            all_sources.append({"url": final, "title": title, "domain": dom})

        timestamp = res0.get("datetime") or (datetime.utcnow().isoformat(timespec="milliseconds") + "Z")
        return {
            "map": None,
            "url": "",
            "index": None,
            "input": {"user_prompt": prompt},
            "model": "gemini",
            "is_map": False,
            "prompt": prompt,
            "country": "",
            "shopping": [],
            "shopping_visible": False,
            "citations": citations,
            "timestamp": timestamp,
            "references": [],
            "answer_text": answer_text,
            "links_attached": [],
            "answer_section_html": "",
            "answer_text_markdown": answer_text,
            "web_search_triggered": bool(self.gemini_web_search),
            "web_search_query": fan_out,
            "search_sources": [],
            "recommendations": [],
            "additional_prompt": "",
            "additional_answer_text": None,
            "all_sources": all_sources,
            "organic": [],
        }

    async def _process_gemini(
        self,
        prompts: list[str],
        max_retries: int,
        progress_callback: Optional[Callable],
    ) -> tuple[list[dict], list[str]]:
        """One Gemini request per prompt, bounded concurrency. Each call is
        slow (~13s) and pricey (~$0.05), so per-prompt + parallel is the
        right model (the endpoint isn't a cheap batch)."""
        logger.info(
            f"DataForSEO Gemini: {len(prompts)} prompts, model={self.gemini_model}, "
            f"web_search={self.gemini_web_search}, max_concurrent={self.max_concurrent}"
        )
        results: list[dict] = []
        failed: list[str] = []
        total = len(prompts)
        processed = 0
        sem = asyncio.Semaphore(self.max_concurrent)
        lock = asyncio.Lock()
        url_cache: dict[str, str] = {}  # shared redirect→final cache across prompts
        timeout = httpx.Timeout(120.0, connect=30.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            async def run_one(prompt: str) -> None:
                nonlocal processed
                rec = None
                try:
                    async with sem:
                        data = await self._post_gemini_one(client, prompt, max_retries)
                    tasks = data.get("tasks") or ([data] if data.get("result") else [])
                    task = tasks[0] if tasks else None
                    if task:
                        self.total_cost += float(task.get("cost") or 0)
                        rec = await self._convert_gemini(client, task, prompt, url_cache)
                        if not rec:
                            logger.warning(
                                f"DataForSEO Gemini task not usable for '{prompt[:60]}': "
                                f"status={task.get('status_code')} msg={task.get('status_message')!r}"
                            )
                except Exception as e:
                    logger.error(
                        f"DataForSEO Gemini failed for '{prompt[:60]}': {type(e).__name__}: {e}"
                    )
                async with lock:
                    if rec and rec.get("answer_text"):
                        results.append(rec)
                    else:
                        failed.append(prompt)
                    processed += 1
                    if progress_callback:
                        try:
                            await progress_callback(processed, total, results)
                        except Exception:
                            pass

            await asyncio.gather(*[run_one(p) for p in prompts])

        logger.info(
            f"DataForSEO Gemini: done — {len(results)} ok, {len(failed)} failed, "
            f"cost=${self.total_cost:.4f}"
        )
        return results, failed

    async def _post_batch(
        self, client: httpx.AsyncClient, keywords: list[str],
        location_code: int, language_code: str, max_retries: int,
    ) -> dict:
        """POST one batch (≤100 keywords) to live/advanced. Returns the
        parsed JSON response (raises after retries on transport error)."""
        tasks_payload = [
            {
                "keyword": kw,
                "location_code": location_code,
                "language_code": language_code,
                "device": "mobile",      # always mobile (product requirement)
                "os": "android",
                "depth": 20,
                "calculate_rectangles": True,
                "load_async_ai_overview": True,
            }
            for kw in keywords
        ]
        url = f"{self.base_url}/v3/serp/google/organic/live/advanced"
        last_err = None
        for attempt in range(1, max_retries + 1):
            try:
                resp = await client.post(url, json=tasks_payload, headers=self.headers)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                last_err = e
                if attempt < max_retries:
                    await asyncio.sleep(3 ** (attempt - 1))  # 1s, 3s, 9s
                else:
                    raise last_err

    async def process_all_prompts(
        self,
        prompts: list[str],
        geo_targeting: str = "",
        source: str = "",
        max_retries: int = 3,
        progress_callback: Optional[Callable] = None,
        search: bool = True,          # accepted for interface parity (unused)
        **_kwargs,
    ) -> tuple[list[dict], list[str]]:
        """Process all prompts using small per-request batches sent with
        bounded concurrency. Returns (converted_results, failed_keywords).

        Why not one big batch: the live/advanced endpoint with
        load_async_ai_overview is slow per keyword, and large batches make
        the server drop the connection before responding. Small batches
        (default 1 keyword) + concurrency keep each request fast and the
        whole job reliable.
        """
        # Gemini uses a completely different endpoint/payload/response
        # (ai_optimization/gemini/llm_responses/live), so route it out.
        if (source or "").lower() == "gemini":
            return await self._process_gemini(prompts, max_retries, progress_callback)

        location_code, language_code = self._resolve_location(geo_targeting)
        country = (geo_targeting or "").strip().upper()[:2] or "US"
        logger.info(
            f"DataForSEO: {len(prompts)} prompts, location_code={location_code}, "
            f"language_code={language_code}, batch_size={self.batch_size}, "
            f"max_concurrent={self.max_concurrent}"
        )

        results: list[dict] = []
        failed: list[str] = []
        total = len(prompts)
        processed = 0
        sem = asyncio.Semaphore(self.max_concurrent)
        lock = asyncio.Lock()
        # Per single-keyword request: ~20-40s. 120s gives generous headroom
        # while staying under the server's connection window.
        timeout = httpx.Timeout(120.0, connect=30.0)

        batches = [prompts[i:i + self.batch_size] for i in range(0, len(prompts), self.batch_size)]

        # Keywords whose SERP returned an EMPTY ai_overview block (async AIO
        # didn't render inside the live window) — re-scraped once below.
        async_retry: list[str] = []

        async with httpx.AsyncClient(timeout=timeout) as client:
            async def run_batch(batch: list[str], allow_async_retry: bool) -> None:
                nonlocal processed
                async with sem:
                    batch_results: list[dict] = []
                    batch_failed: list[str] = []
                    batch_async: list[str] = []
                    try:
                        data = await self._post_batch(
                            client, batch, location_code, language_code, max_retries
                        )
                        tasks = data.get("tasks") or []
                        seen = set()
                        for task in tasks:
                            self.total_cost += float(task.get("cost") or 0)
                            record = self._convert_task(task, country)
                            placeholder = bool(record) and record.pop("_aio_placeholder", False)
                            if record and placeholder and allow_async_retry:
                                # AIO block present but empty — queue one retry
                                # instead of persisting a no-answer record.
                                batch_async.append(record["prompt"])
                                seen.add(record["prompt"])
                            elif record and (record.get("answer_text") or record.get("organic")):
                                batch_results.append(record)
                                seen.add(record["prompt"])
                            else:
                                kw = ((task.get("data") or {}).get("keyword")) or ""
                                # Surface the real reason instead of swallowing it.
                                logger.warning(
                                    f"DataForSEO task not usable for '{kw[:60]}': "
                                    f"status={task.get('status_code')} "
                                    f"msg={task.get('status_message')!r}"
                                )
                                if kw:
                                    batch_failed.append(kw)
                                    seen.add(kw)
                        for kw in batch:
                            if kw not in seen:
                                batch_failed.append(kw)
                    except Exception as e:
                        logger.error(
                            f"DataForSEO request failed for {batch[:1]}"
                            f"{'…' if len(batch) > 1 else ''}: {type(e).__name__}: {e}"
                        )
                        batch_failed.extend(batch)

                    async with lock:
                        results.extend(batch_results)
                        failed.extend(batch_failed)
                        async_retry.extend(batch_async)
                        # Async-queued keywords aren't final yet — they count
                        # toward progress when their retry round completes.
                        processed += len(batch) - len(batch_async)
                        if progress_callback:
                            try:
                                await progress_callback(processed, total, results)
                            except Exception:
                                pass

            await asyncio.gather(*[run_batch(b, True) for b in batches])

            if async_retry:
                logger.info(
                    f"DataForSEO: {len(async_retry)} keyword(s) returned an empty "
                    f"ai_overview block — retrying once after a short delay"
                )
                await asyncio.sleep(8)
                retry_batches = [
                    async_retry[i:i + self.batch_size]
                    for i in range(0, len(async_retry), self.batch_size)
                ]
                await asyncio.gather(*[run_batch(b, False) for b in retry_batches])

        logger.info(
            f"DataForSEO: done — {len(results)} ok, {len(failed)} failed, "
            f"cost=${self.total_cost:.4f}"
        )
        return results, failed
