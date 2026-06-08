"""
DataForSEO client — Google AI Overview + organic results.

Uses the SERP "live/advanced" endpoint with `load_async_ai_overview` so a
single synchronous request returns both the AI Overview block and the
organic results for each keyword (up to 100 keywords per request).

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
        }

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

        async with httpx.AsyncClient(timeout=timeout) as client:
            async def run_batch(batch: list[str]) -> None:
                nonlocal processed
                async with sem:
                    batch_results: list[dict] = []
                    batch_failed: list[str] = []
                    try:
                        data = await self._post_batch(
                            client, batch, location_code, language_code, max_retries
                        )
                        tasks = data.get("tasks") or []
                        seen = set()
                        for task in tasks:
                            self.total_cost += float(task.get("cost") or 0)
                            record = self._convert_task(task, country)
                            if record and (record.get("answer_text") or record.get("organic")):
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
                        processed += len(batch)
                        if progress_callback:
                            try:
                                await progress_callback(processed, total, results)
                            except Exception:
                                pass

            await asyncio.gather(*[run_batch(b) for b in batches])

        logger.info(
            f"DataForSEO: done — {len(results)} ok, {len(failed)} failed, "
            f"cost=${self.total_cost:.4f}"
        )
        return results, failed
