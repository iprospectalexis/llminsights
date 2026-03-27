import httpx
import asyncio
import logging
import time
from typing import Optional, Callable
from dataclasses import dataclass, field

from app.config import get_settings
from app.services.geo_utils import extract_country_code

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class SnapshotResult:
    """Result of a BrightData snapshot."""
    snapshot_id: str = ""
    prompts: list[str] = field(default_factory=list)
    data: list[dict] = field(default_factory=list)
    failed_queries: list[str] = field(default_factory=list)
    error: Optional[str] = None
    status: str = "pending"


class BrightDataClient:
    """
    Async client for interacting with the BrightData Web Scraper API.

    Uses high-concurrency small-batch strategy:
    - Chunks of ≤20 prompts per request (allows 1,500 concurrent requests)
    - Parallel trigger + poll + download for each chunk
    - Aggregates all results at the end
    """

    DATASET_IDS = {
        "chatgpt": "gd_m7aof0k82r803d5bjm",
        "perplexity": "gd_m7dhdot1vw9a7gc1n",
        "gemini": "gd_mbz66arm2mf9cu856y",
        "copilot": "gd_m7di5jy6s9geokz8w",
        "grok": "gd_m8ve0u141icu75ae74",
        "google_ai_mode": "gd_mcswdt6z2elth3zqr2",
        "google_ai_overview": "gd_mfz5x93lmsjjjylob",
    }

    SOURCE_CONFIGS = {
        "chatgpt": {
            "url": "https://chatgpt.com/",
            "supports_additional_prompt": True,
            "supports_web_search": True,
            "use_sync_mode": False,
        },
        "perplexity": {
            "url": "https://www.perplexity.ai/",
            "supports_additional_prompt": False,
            "supports_web_search": False,
            "use_sync_mode": False,
        },
        "gemini": {
            "url": "https://gemini.google.com/",
            "supports_additional_prompt": False,
            "supports_web_search": False,
            "use_sync_mode": False,
        },
        "copilot": {
            "url": "https://copilot.microsoft.com/",
            "supports_additional_prompt": False,
            "supports_web_search": False,
            "use_sync_mode": False,
        },
        "grok": {
            "url": "https://grok.com/",
            "supports_additional_prompt": False,
            "supports_web_search": False,
            "use_sync_mode": False,
        },
        "google_ai_mode": {
            "url": "https://google.com/aimode",
            "supports_additional_prompt": False,
            "supports_web_search": False,
            "use_sync_mode": False,
        },
        "google_ai_overview": {
            "url": "https://www.google.com/",
            "supports_additional_prompt": False,
            "supports_web_search": False,
            "use_sync_mode": False,
            "uses_keyword_field": True,
            "answer_field": "aio_text",
            "require_answer_field": False,  # aio_text can be null when no AI Overview exists for a query
            "custom_output_fields": "url,keyword,language,country,aio_citations,aio_text,page_html,organic,timestamp",
        },
    }

    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        chunk_size: int = None,
        max_concurrent_requests: int = None,
        polling_interval: int = None,
        polling_timeout: int = None,
    ):
        self.api_key = api_key or settings.brightdata_api_key
        self.base_url = base_url or settings.brightdata_base_url

        # Small chunks for high concurrency (≤20 prompts = 1,500 concurrent limit)
        self.chunk_size = chunk_size or getattr(settings, 'brightdata_chunk_size', 10)

        # High concurrency for parallel processing
        self.max_concurrent_requests = max_concurrent_requests or getattr(settings, 'brightdata_max_concurrent', 100)

        self.polling_interval = polling_interval or settings.brightdata_polling_interval
        self.polling_timeout = polling_timeout or getattr(settings, 'polling_timeout', 600)

        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def get_dataset_id(self, source: str) -> str:
        """Get the dataset ID for the specified AI source."""
        return self.DATASET_IDS.get(source.lower(), self.DATASET_IDS["chatgpt"])

    # Country-specific Google TLDs
    GOOGLE_COUNTRY_TLDS = {
        "FR": "google.fr", "DE": "google.de", "ES": "google.es", "IT": "google.it",
        "PT": "google.pt", "NL": "google.nl", "BE": "google.be", "CH": "google.ch",
        "AT": "google.at", "UK": "google.co.uk", "GB": "google.co.uk",
        "IE": "google.ie", "PL": "google.pl", "CZ": "google.cz", "RO": "google.ro",
        "SE": "google.se", "NO": "google.no", "DK": "google.dk", "FI": "google.fi",
        "US": "google.com", "CA": "google.ca", "MX": "google.com.mx",
        "BR": "google.com.br", "AR": "google.com.ar", "CO": "google.com.co",
        "JP": "google.co.jp", "KR": "google.co.kr", "AU": "google.com.au",
        "NZ": "google.co.nz", "IN": "google.co.in", "RU": "google.ru",
        "TR": "google.com.tr", "ZA": "google.co.za", "IL": "google.co.il",
        "AE": "google.ae", "SA": "google.com.sa", "EG": "google.com.eg",
    }

    def _get_google_url(self, base_path: str, country: str) -> str:
        """Get country-specific Google URL for Google AI sources."""
        tld = self.GOOGLE_COUNTRY_TLDS.get(country.upper(), "google.com") if country else "google.com"
        return f"https://www.{tld}{base_path}"

    def _build_payload(self, prompts: list[str], source: str, country: str = "") -> list[dict]:
        """Build request payload for given prompts."""
        source_lower = source.lower()
        config = self.SOURCE_CONFIGS.get(source_lower, self.SOURCE_CONFIGS["chatgpt"])

        # For Google sources, use country-specific URL
        url = config["url"]
        if source_lower == "google_ai_overview":
            url = self._get_google_url("/", country)
        elif source_lower == "google_ai_mode":
            url = self._get_google_url("/aimode", country)

        payload = []
        for prompt in prompts:
            if config.get("uses_keyword_field"):
                item = {
                    "url": url,
                    "keyword": prompt,
                    "country": country,
                }
            else:
                item = {
                    "url": url,
                    "prompt": prompt,
                    "country": country,
                }
            if config.get("supports_additional_prompt"):
                item["additional_prompt"] = ""
            if config.get("supports_web_search"):
                item["web_search"] = True
            payload.append(item)

        return payload

    async def _trigger_snapshot(
        self,
        client: httpx.AsyncClient,
        prompts: list[str],
        source: str,
        country: str = "",
    ) -> tuple[str, list[str]]:
        """
        Trigger a single snapshot for a small batch of prompts.
        Returns (snapshot_id, prompts) or raises exception.
        """
        dataset_id = self.get_dataset_id(source)
        payload = self._build_payload(prompts, source, country=country)
        config = self.SOURCE_CONFIGS.get(source.lower(), {})

        params = {"dataset_id": dataset_id, "format": "json"}
        if config.get("custom_output_fields"):
            params["custom_output_fields"] = config["custom_output_fields"]

        response = await client.post(
            f"{self.base_url}/trigger",
            params=params,
            json=payload,
            headers=self.headers,
        )

        if response.status_code == 429:
            raise Exception("Rate limited (429) - too many concurrent requests")

        if response.status_code != 200:
            raise Exception(f"Trigger failed: {response.status_code} - {response.text[:200]}")

        data = response.json()
        snapshot_id = data.get("snapshot_id")

        if not snapshot_id:
            raise Exception(f"No snapshot_id in response: {data}")

        return snapshot_id, prompts

    async def _poll_snapshot(
        self,
        client: httpx.AsyncClient,
        snapshot_id: str,
    ) -> str:
        """
        Poll snapshot until ready/failed/timeout.
        Returns status: 'ready', 'failed', 'timeout'.
        """
        start_time = time.time()

        while True:
            elapsed = time.time() - start_time
            if elapsed > self.polling_timeout:
                return "timeout"

            try:
                response = await client.get(
                    f"{self.base_url}/progress/{snapshot_id}",
                    headers=self.headers,
                )

                if response.status_code == 200:
                    data = response.json()
                    status = data.get("status", "unknown")

                    if status == "ready":
                        return "ready"
                    if status == "failed":
                        return "failed"

                    # Still running, continue polling
                    logger.debug(f"Snapshot {snapshot_id[:8]}: {status}")

            except httpx.HTTPError as e:
                logger.warning(f"Poll error for {snapshot_id[:8]}: {e}")

            await asyncio.sleep(self.polling_interval)

    async def _download_snapshot(
        self,
        client: httpx.AsyncClient,
        snapshot_id: str,
    ) -> list[dict]:
        """Download snapshot results."""
        response = await client.get(
            f"{self.base_url}/snapshot/{snapshot_id}",
            params={"format": "json"},
            headers=self.headers,
        )

        if response.status_code in (202, 409):
            raise Exception("Snapshot not ready for download")

        response.raise_for_status()

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        else:
            # Parse NDJSON
            import json
            results = []
            for line in response.text.strip().split("\n"):
                if line:
                    results.append(json.loads(line))
            return results

    async def _scrape_sync(
        self,
        client: httpx.AsyncClient,
        prompts: list[str],
        source: str,
        country: str = "",
    ) -> list[dict]:
        """
        Sync scrape - sends request and waits for results directly.
        Uses /scrape endpoint instead of /trigger.
        Faster for sources like Perplexity where async queue is slow.
        """
        dataset_id = self.get_dataset_id(source)
        payload = self._build_payload(prompts, source, country=country)
        config = self.SOURCE_CONFIGS.get(source.lower(), {})

        params = {"dataset_id": dataset_id, "notify": "false", "include_errors": "true"}
        if config.get("custom_output_fields"):
            params["custom_output_fields"] = config["custom_output_fields"]

        response = await client.post(
            f"{self.base_url}/scrape",
            params=params,
            json=payload,
            headers=self.headers,
            timeout=300,  # 5 min timeout for sync requests
        )

        if response.status_code == 429:
            raise Exception("Rate limited (429) - too many concurrent requests")

        if response.status_code != 200:
            raise Exception(f"Scrape failed: {response.status_code} - {response.text[:200]}")

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        else:
            # Parse NDJSON
            import json
            results = []
            for line in response.text.strip().split("\n"):
                if line:
                    results.append(json.loads(line))
            return results

    async def _process_single_chunk_sync(
        self,
        client: httpx.AsyncClient,
        chunk_idx: int,
        prompts: list[str],
        source: str,
        semaphore: asyncio.Semaphore,
        progress_state: dict,
        progress_callback: Callable,
        country: str = "",
    ) -> SnapshotResult:
        """
        Process a single chunk using sync mode (/scrape endpoint).
        """
        result = SnapshotResult(prompts=prompts)

        async with semaphore:
            try:
                logger.debug(f"Chunk {chunk_idx}: sync scrape ({len(prompts)} prompts)")

                data = await self._scrape_sync(client, prompts, source, country=country)

                # Determine which field contains the answer for this source
                source_config = self.SOURCE_CONFIGS.get(source.lower(), {})
                answer_field = source_config.get("answer_field", "answer_text")
                require_answer = source_config.get("require_answer_field", True)

                # Parse results
                for item in data:
                    has_error = item.get("error") or item.get("error_code")
                    missing_answer = require_answer and not item.get(answer_field)
                    if has_error or missing_answer:
                        inp = item.get("input", {}) or {}
                        failed_prompt = (
                            inp.get("keyword") or inp.get("prompt") or
                            item.get("keyword") or item.get("prompt")
                        )
                        if failed_prompt:
                            result.failed_queries.append(failed_prompt)
                    else:
                        result.data.append(item)

                result.status = "completed"
                logger.debug(f"Chunk {chunk_idx}: {len(result.data)} ok, {len(result.failed_queries)} failed")

            except Exception as e:
                result.error = str(e)
                result.failed_queries = prompts
                result.status = "error"
                logger.warning(f"Chunk {chunk_idx} sync error: {e}")

            # Update progress
            progress_state["completed"] += len(result.data)
            progress_state["failed"] += len(result.failed_queries)

            if progress_callback:
                try:
                    await progress_callback(
                        progress_state["completed"],
                        progress_state["total"],
                        []
                    )
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")

            return result

    async def _process_single_chunk(
        self,
        client: httpx.AsyncClient,
        chunk_idx: int,
        prompts: list[str],
        source: str,
        semaphore: asyncio.Semaphore,
        results_collector: dict,
        progress_state: dict,
        progress_callback: Callable,
        country: str = "",
    ) -> SnapshotResult:
        """
        Process a single chunk: trigger → poll → download.
        Uses semaphore for concurrency control.
        """
        result = SnapshotResult(prompts=prompts)

        async with semaphore:
            try:
                # 1. Trigger
                snapshot_id, _ = await self._trigger_snapshot(client, prompts, source, country=country)
                result.snapshot_id = snapshot_id
                result.status = "triggered"
                logger.debug(f"Chunk {chunk_idx}: triggered {snapshot_id[:8]} ({len(prompts)} prompts)")

                # 2. Poll
                status = await self._poll_snapshot(client, snapshot_id)
                result.status = status

                if status == "timeout":
                    result.error = f"Timeout waiting for snapshot {snapshot_id[:8]}"
                    result.failed_queries = prompts
                    return result

                if status == "failed":
                    result.error = f"Snapshot {snapshot_id[:8]} failed"
                    result.failed_queries = prompts
                    return result

                # 3. Download
                data = await self._download_snapshot(client, snapshot_id)

                # Determine which field contains the answer for this source
                source_config = self.SOURCE_CONFIGS.get(source.lower(), {})
                answer_field = source_config.get("answer_field", "answer_text")
                require_answer = source_config.get("require_answer_field", True)

                # Parse results
                for item in data:
                    has_error = item.get("error") or item.get("error_code")
                    missing_answer = require_answer and not item.get(answer_field)
                    if has_error or missing_answer:
                        inp = item.get("input", {}) or {}
                        failed_prompt = (
                            inp.get("keyword") or inp.get("prompt") or
                            item.get("keyword") or item.get("prompt")
                        )
                        if failed_prompt:
                            result.failed_queries.append(failed_prompt)
                    else:
                        result.data.append(item)

                result.status = "completed"
                logger.debug(f"Chunk {chunk_idx}: {len(result.data)} ok, {len(result.failed_queries)} failed")

            except Exception as e:
                result.error = str(e)
                result.failed_queries = prompts
                result.status = "error"
                logger.warning(f"Chunk {chunk_idx} error: {e}")

            # Update progress
            progress_state["completed"] += len(result.data)
            progress_state["failed"] += len(result.failed_queries)

            if progress_callback:
                try:
                    await progress_callback(
                        progress_state["completed"],
                        progress_state["total"],
                        []
                    )
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")

            return result

    def _use_sync_mode(self, source: str) -> bool:
        """Check if source should use sync mode."""
        config = self.SOURCE_CONFIGS.get(source.lower(), {})
        return config.get("use_sync_mode", False)

    async def process_all_prompts(
        self,
        prompts: list[str],
        geo_targeting: str = "",
        source: str = "chatgpt",
        max_retries: int = 1,
        progress_callback: Callable[[int, int, list], None] = None,
        output_file: str = None,
    ) -> tuple[list[dict], list[str]]:
        """
        Process all prompts using high-concurrency parallel strategy.

        Strategy:
        - Split into small chunks (≤20 prompts each)
        - Process up to 100+ chunks in parallel
        - Each chunk: trigger → poll → download (async) or scrape (sync)
        - Retry failed prompts

        If output_file is set, results are streamed to JSONL file incrementally
        to avoid unbounded memory growth. Returns ([], failed_queries) in that case —
        results must be read from the file.

        Returns (all_results, failed_queries).
        """
        import json as _json
        from pathlib import Path

        total_prompts = len(prompts)
        use_sync = self._use_sync_mode(source)

        # Extract country code from geo_targeting
        country = extract_country_code(geo_targeting)
        if country:
            logger.info(f"BrightData: Using country code '{country}' from geo_targeting '{geo_targeting}'")

        # Split into small chunks for high concurrency
        chunks = [
            prompts[i:i + self.chunk_size]
            for i in range(0, len(prompts), self.chunk_size)
        ]

        mode_str = "SYNC" if use_sync else "ASYNC"
        logger.info(
            f"BrightData [{mode_str}]: Processing {total_prompts} prompts in {len(chunks)} chunks "
            f"({self.chunk_size}/chunk, {self.max_concurrent_requests} concurrent)"
        )

        # Memory-bounded: stream to file if output_file is set
        stream_to_file = output_file is not None
        jsonl_file = None
        result_count = 0
        write_lock = asyncio.Lock()

        if stream_to_file:
            Path(output_file).parent.mkdir(parents=True, exist_ok=True)
            jsonl_file = open(output_file, 'w', encoding='utf-8')
            logger.info(f"BrightData: Streaming results to {output_file}")

        # Shared state (only used when not streaming to file)
        all_results: list[dict] = []
        all_failed: list[str] = []

        # Progress tracking
        progress_state = {
            "completed": 0,
            "failed": 0,
            "total": total_prompts,
        }

        # Process with retries
        current_prompts = prompts

        try:
            for attempt in range(max_retries + 1):
                if not current_prompts:
                    break

                if attempt > 0:
                    logger.info(f"Retry attempt {attempt}: {len(current_prompts)} prompts remaining")
                    await asyncio.sleep(3)  # Brief pause before retry

                # Split current prompts into chunks
                chunks = [
                    current_prompts[i:i + self.chunk_size]
                    for i in range(0, len(current_prompts), self.chunk_size)
                ]

                # Semaphore for concurrency control
                semaphore = asyncio.Semaphore(self.max_concurrent_requests)
                results_collector = {}

                # Use single client for connection pooling (longer timeout for sync mode)
                client_timeout = 300 if use_sync else 120
                async with httpx.AsyncClient(timeout=client_timeout) as client:
                    if use_sync:
                        # Sync mode: use /scrape endpoint
                        tasks = [
                            self._process_single_chunk_sync(
                                client=client,
                                chunk_idx=idx,
                                prompts=chunk,
                                source=source,
                                semaphore=semaphore,
                                progress_state=progress_state,
                                progress_callback=progress_callback,
                                country=country,
                            )
                            for idx, chunk in enumerate(chunks)
                        ]
                    else:
                        # Async mode: use /trigger + poll + download
                        tasks = [
                            self._process_single_chunk(
                                client=client,
                                chunk_idx=idx,
                                prompts=chunk,
                                source=source,
                                semaphore=semaphore,
                                results_collector=results_collector,
                                progress_state=progress_state,
                                progress_callback=progress_callback,
                                country=country,
                            )
                            for idx, chunk in enumerate(chunks)
                        ]

                    # Process all chunks in parallel
                    chunk_results = await asyncio.gather(*tasks, return_exceptions=True)

                # Collect results from this attempt
                attempt_failed = []

                for result in chunk_results:
                    if isinstance(result, Exception):
                        logger.error(f"Chunk exception: {result}")
                        continue

                    if isinstance(result, SnapshotResult):
                        if stream_to_file and result.data:
                            # Write to JSONL file incrementally (thread-safe)
                            async with write_lock:
                                for item in result.data:
                                    jsonl_file.write(_json.dumps(item, ensure_ascii=False) + '\n')
                                result_count += len(result.data)
                        else:
                            all_results.extend(result.data)
                        attempt_failed.extend(result.failed_queries)

                # Prepare for retry with failed prompts
                current_prompts = attempt_failed

                if not current_prompts:
                    break

                count = result_count if stream_to_file else len(all_results)
                logger.info(f"Attempt {attempt + 1}: {count} succeeded, {len(current_prompts)} to retry")

        finally:
            if jsonl_file:
                jsonl_file.close()

        # Final failed list
        all_failed = current_prompts

        if stream_to_file:
            logger.info(f"BrightData completed: {result_count} results written to {output_file}, {len(all_failed)} failed")
            return [], all_failed
        else:
            logger.info(f"BrightData completed: {len(all_results)} results, {len(all_failed)} failed")
            return all_results, all_failed


# Singleton instance
brightdata_client = BrightDataClient()
