import httpx
import asyncio
import logging
from typing import Optional, Callable
from dataclasses import dataclass

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class BatchProgress:
    """Progress update during batch processing."""
    batch_index: int
    batch_total: int
    batch_processed: int
    batch_size: int
    message: str = "Processing"


@dataclass
class BatchResult:
    """Result of a batch processing."""
    results_link: Optional[str] = None
    failed_queries: list[str] = None
    error: Optional[str] = None

    def __post_init__(self):
        if self.failed_queries is None:
            self.failed_queries = []


class SerpClient:
    """
    Async client for interacting with the SERP API.
    """
    
    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        batch_size: int = None,
        max_concurrent_batches: int = None,
        polling_interval: int = None,
        polling_timeout: int = None,
    ):
        self.api_key = api_key or settings.serp_api_key
        self.base_url = base_url or settings.serp_api_base_url
        self.batch_size = batch_size or settings.batch_size
        self.max_concurrent_batches = max_concurrent_batches or settings.max_concurrent_batches
        self.polling_interval = polling_interval or settings.polling_interval
        self.polling_timeout = polling_timeout or settings.polling_timeout
        
        self.headers = {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
        }
    
    async def submit_batch(
        self,
        prompts: list[str],
        geo_targeting: str = "Paris,Paris,Ile-de-France,France",
        source: str = "chatgpt",
        search: bool = True,
    ) -> str:
        """Submit a batch of prompts for processing."""
        if len(prompts) > self.batch_size:
            raise ValueError(f"Batch size cannot exceed {self.batch_size}")

        payload = {
            "source": source,
            "geo_targeting": geo_targeting,
            "search": search,
            "prompt": prompts,
        }
        
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.base_url}/chatgpt/batch",
                json=payload,
                headers=self.headers,
            )
            response.raise_for_status()
            data = response.json()
            
            request_id = data.get("request_id")
            if not request_id:
                raise ValueError("No request_id in response")
            
            logger.info(f"Batch submitted: {request_id} ({len(prompts)} prompts)")
            return request_id
    
    async def poll_status(
        self,
        request_id: str,
        batch_size: int = 0,
        progress_callback: Callable[[int, str], None] = None,
    ) -> BatchResult:
        """Poll for batch completion status."""
        import time
        start_time = time.time()
        first_poll = True

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                elapsed = time.time() - start_time
                if elapsed > self.polling_timeout:
                    return BatchResult(error=f"Polling timeout after {self.polling_timeout}s")

                try:
                    response = await client.get(
                        f"{self.base_url}/{request_id}/status",
                        headers=self.headers,
                    )
                    response.raise_for_status()
                    data = response.json()

                    # Log full response on first poll to debug API format
                    if first_poll:
                        logger.info(f"First poll response for {request_id}: {data}")
                        first_poll = False

                    status = data.get("status", "unknown")
                    results_obj = data.get("results", {})

                    # Check for completion - support multiple response formats
                    results_link = results_obj.get("results_link") or data.get("results_link")

                    # Also check if status indicates completion
                    is_complete = (
                        results_link or
                        status in ("complete", "completed", "done", "finished") or
                        data.get("state") in ("complete", "completed", "done", "finished")
                    )

                    if is_complete:
                        logger.info(f"Batch {request_id} completed! Status: {status}, Results link: {results_link}")
                        # Report 100% progress for this batch before returning
                        if progress_callback:
                            await progress_callback(batch_size, "Completed")
                        return BatchResult(
                            results_link=results_link,
                            failed_queries=results_obj.get("failed_queries", []),
                        )

                    # Parse progress like "45/100" or just a number
                    progress_str = results_obj.get("progress", "0")
                    message = data.get("message", "Processing")

                    batch_processed = 0
                    if isinstance(progress_str, str) and "/" in progress_str:
                        try:
                            batch_processed = int(progress_str.split("/")[0])
                        except ValueError:
                            pass
                    elif isinstance(progress_str, (int, float)):
                        batch_processed = int(progress_str)

                    # Call progress callback with current batch progress
                    if progress_callback and batch_processed > 0:
                        await progress_callback(batch_processed, message)

                    logger.info(f"Polling {request_id}: status={status} | {message} | Progress: {progress_str}")

                except httpx.HTTPError as e:
                    logger.warning(f"Polling error for {request_id}: {e}")

                await asyncio.sleep(self.polling_interval)
    
    async def process_batch_with_retries(
        self,
        prompts: list[str],
        geo_targeting: str = "Paris,Paris,Ile-de-France,France",
        source: str = "chatgpt",
        search: bool = True,
        max_retries: int = 3,
        progress_callback: Callable[[int, str], None] = None,
    ) -> tuple[list[str], list[str]]:
        """Process a batch with retry logic for failed queries."""
        collected_links = []
        current_prompts = prompts

        for attempt in range(max_retries + 1):
            if not current_prompts:
                break

            try:
                request_id = await self.submit_batch(
                    current_prompts,
                    geo_targeting=geo_targeting,
                    source=source,
                    search=search,
                )

                result = await self.poll_status(
                    request_id,
                    batch_size=len(current_prompts),
                    progress_callback=progress_callback,
                )
                logger.info(f"Batch {request_id} poll_status returned: results_link={result.results_link}, error={result.error}, failed_queries={len(result.failed_queries) if result.failed_queries else 0}")

                if result.error:
                    logger.error(f"Batch error: {result.error}")
                    if attempt == max_retries:
                        return collected_links, current_prompts
                    await asyncio.sleep(5)
                    continue

                if result.results_link:
                    collected_links.append(result.results_link)

                if not result.failed_queries:
                    logger.info(f"Batch completed successfully")
                    return collected_links, []

                logger.warning(f"Batch had {len(result.failed_queries)} failures")
                current_prompts = result.failed_queries

                if attempt < max_retries:
                    await asyncio.sleep(3)

            except Exception as e:
                logger.error(f"Batch processing error: {e}")
                if attempt == max_retries:
                    return collected_links, current_prompts
                await asyncio.sleep(5)

        return collected_links, current_prompts
    
    async def process_all_prompts(
        self,
        prompts: list[str],
        geo_targeting: str = "Paris,Paris,Ile-de-France,France",
        source: str = "chatgpt",
        search: bool = True,
        max_retries: int = 3,
        progress_callback: Callable[[int, int, list], None] = None,
    ) -> tuple[list[str], list[str]]:
        """Process all prompts in parallel batches."""
        total_prompts = len(prompts)

        chunks = [
            prompts[i:i + self.batch_size]
            for i in range(0, len(prompts), self.batch_size)
        ]

        logger.info(f"Processing {total_prompts} prompts in {len(chunks)} batches (max {self.max_concurrent_batches} concurrent)")

        # Shared state for progress tracking
        results_lock = asyncio.Lock()
        all_links = []
        all_failed = []

        # Track progress per batch: {batch_idx: current_progress}
        batch_progress: dict[int, int] = {i: 0 for i in range(len(chunks))}

        # Semaphore to limit concurrent batches
        semaphore = asyncio.Semaphore(self.max_concurrent_batches)

        async def process_chunk(chunk_idx: int, chunk: list[str]):
            chunk_start_offset = chunk_idx * self.batch_size

            async def batch_progress_callback(batch_processed: int, message: str):
                """Called during polling with current batch progress."""
                async with results_lock:
                    batch_progress[chunk_idx] = batch_processed

                    # Calculate total processed across all batches
                    total_processed = sum(batch_progress.values())

                    if progress_callback:
                        await progress_callback(total_processed, total_prompts, list(all_links))

            async with semaphore:
                logger.info(f"Processing batch {chunk_idx + 1}/{len(chunks)} ({len(chunk)} prompts)")

                links, failed = await self.process_batch_with_retries(
                    chunk,
                    geo_targeting=geo_targeting,
                    source=source,
                    search=search,
                    max_retries=max_retries,
                    progress_callback=batch_progress_callback,
                )

                async with results_lock:
                    all_links.extend(links)
                    all_failed.extend(failed)
                    # Update final count for this batch (successful prompts)
                    batch_progress[chunk_idx] = len(chunk) - len(failed)

                    if progress_callback:
                        total_processed = sum(batch_progress.values())
                        await progress_callback(total_processed, total_prompts, list(all_links))

                logger.info(f"Batch {chunk_idx + 1}/{len(chunks)} completed: {len(links)} links, {len(failed)} failed")
                if links:
                    for link in links:
                        logger.info(f"  Batch {chunk_idx + 1} link: {link[:80]}...")
                logger.info(f"Total links collected so far: {len(all_links)}")

        # Process all chunks in parallel (limited by semaphore)
        tasks = [
            process_chunk(idx, chunk)
            for idx, chunk in enumerate(chunks)
        ]
        await asyncio.gather(*tasks)

        logger.info(f"Completed: {len(all_links)} result files, {len(all_failed)} failed")
        return all_links, all_failed


# Singleton instance
serp_client = SerpClient()
