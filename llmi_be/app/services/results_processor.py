import httpx
import asyncio
import logging
import json
import zipfile
import io
import os
from datetime import datetime
from typing import Optional
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from app.config import get_settings
from app.services.json_converter import json_converter

logger = logging.getLogger(__name__)
settings = get_settings()

# Results directory
RESULTS_DIR = Path(__file__).parent.parent.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

# Thread pool for CPU-bound operations (ZIP extraction)
_executor = ThreadPoolExecutor(max_workers=4)


class ResultsProcessor:
    """
    Downloads zip files from SERP API results, extracts and merges into single JSON.
    Optimized for performance with parallel downloads and extraction.
    """

    def __init__(self, timeout: int = 60):
        self.timeout = timeout

    async def download_zip(self, client: httpx.AsyncClient, url: str) -> Optional[bytes]:
        """Download a zip file from URL using shared client."""
        try:
            response = await client.get(url)
            response.raise_for_status()
            logger.info(f"Downloaded zip from {url[:50]}... ({len(response.content)} bytes)")
            return response.content
        except Exception as e:
            logger.error(f"Failed to download {url}: {e}")
            return None

    def _extract_json_from_zip_sync(self, zip_content: bytes) -> list[dict]:
        """Synchronous ZIP extraction (runs in thread pool)."""
        results = []
        try:
            with zipfile.ZipFile(io.BytesIO(zip_content)) as zf:
                json_files = [f for f in zf.namelist() if f.endswith('.json')]

                for filename in json_files:
                    with zf.open(filename) as f:
                        data = json.load(f)
                        if isinstance(data, list):
                            results.extend(data)
                        else:
                            results.append(data)
        except Exception as e:
            logger.error(f"Failed to extract zip: {e}")
        return results

    async def extract_json_from_zip(self, zip_content: bytes) -> list[dict]:
        """Extract JSON from zip asynchronously using thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, self._extract_json_from_zip_sync, zip_content)

    async def download_and_merge(
        self,
        result_links: list[str],
        job_id: str,
    ) -> tuple[Optional[str], list[dict]]:
        """
        Download all zip files, extract and merge into single JSON file.
        Returns (merged_file_path, merged_data).

        Optimizations:
        - Single HTTP client with connection pooling
        - Parallel ZIP extraction using thread pool
        - No redundant file reads
        """
        if not result_links:
            logger.warning(f"No result links provided for job {job_id}")
            return None, []

        # Deduplicate links (retries might add duplicates)
        unique_links = list(dict.fromkeys(result_links))
        if len(unique_links) != len(result_links):
            logger.warning(f"Removed {len(result_links) - len(unique_links)} duplicate links")
        result_links = unique_links

        logger.info(f"Processing {len(result_links)} result files for job {job_id}")

        # Use single HTTP client with connection pooling for all downloads
        async with httpx.AsyncClient(timeout=self.timeout, limits=httpx.Limits(max_connections=10)) as client:
            # Download all zips in parallel
            download_tasks = [self.download_zip(client, url) for url in result_links]
            zip_contents = await asyncio.gather(*download_tasks)

        # Log download results
        successful_contents = [c for c in zip_contents if c is not None]
        failed_downloads = len(zip_contents) - len(successful_contents)
        logger.info(f"Download results: {len(successful_contents)} successful, {failed_downloads} failed")

        if not successful_contents:
            logger.warning(f"No zips downloaded for job {job_id}")
            return None, []

        # Extract all ZIPs in parallel using thread pool
        extract_tasks = [self.extract_json_from_zip(content) for content in successful_contents]
        extracted_results = await asyncio.gather(*extract_tasks)

        # Merge all extracted data
        all_results = []
        for i, extracted in enumerate(extracted_results):
            all_results.extend(extracted)
            logger.debug(f"Zip {i+1}: extracted {len(extracted)} items")

        logger.info(f"Total extracted: {len(all_results)} items from {len(successful_contents)} zips")

        if not all_results:
            logger.warning(f"No results extracted for job {job_id}")
            return None, []

        # Save merged JSON (compact format for speed)
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"{job_id}_{timestamp}.json"
        filepath = RESULTS_DIR / filename

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(all_results, f, ensure_ascii=False)

        logger.info(f"Merged {len(all_results)} results into {filepath}")

        return str(filepath), all_results

    async def process_job_results(
        self,
        result_links: list[str],
        job_id: str,
        country: str = "",
    ) -> dict:
        """
        Process SERP job results: download, merge, and convert to target format.

        Optimized: converts directly from memory instead of re-reading from disk.
        """
        merged_path, merged_data = await self.download_and_merge(result_links, job_id)

        converted_path = None
        converted_count = 0

        # Convert directly from memory (no file read needed)
        if merged_data:
            try:
                output_path = merged_path.replace('.json', '_converted.json')
                converted_path, converted_count = json_converter.convert_data(merged_data, output_path, country=country)
                logger.info(f"Converted {converted_count} records to {converted_path}")
            except Exception as e:
                logger.error(f"Failed to convert JSON: {e}")

        return {
            "merged_file": merged_path,
            "converted_file": converted_path,
            "total_items": len(merged_data) if merged_data else 0,
            "converted_items": converted_count,
            "source_files": len(result_links),
        }

    async def save_brightdata_results(
        self,
        results: list[dict],
        job_id: str,
        source: str = "",
        country: str = "",
    ) -> dict:
        """
        Save BrightData results directly to file (no download needed).

        Optimized: converts directly from memory.
        """
        if not results:
            logger.warning(f"No results provided for job {job_id}")
            return {
                "merged_file": None,
                "converted_file": None,
                "total_items": 0,
                "converted_items": 0,
            }

        logger.info(f"Saving {len(results)} BrightData results for job {job_id}")

        # Save JSON file (compact format)
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"{job_id}_{timestamp}.json"
        filepath = RESULTS_DIR / filename

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False)

        logger.info(f"Saved {len(results)} results to {filepath}")

        # Convert directly from memory using BrightData-specific converter
        converted_path = None
        converted_count = 0

        try:
            output_path = str(filepath).replace('.json', '_converted.json')
            if source == "google_ai_overview":
                converted_path, converted_count = json_converter.convert_google_aio_data(results, output_path, country=country)
            else:
                converted_path, converted_count = json_converter.convert_brightdata_data(results, output_path, country=country)
            logger.info(f"Converted {converted_count} BrightData records to {converted_path}")
        except Exception as e:
            logger.error(f"Failed to convert BrightData JSON: {e}")

        return {
            "merged_file": str(filepath),
            "converted_file": converted_path,
            "total_items": len(results),
            "converted_items": converted_count,
        }


# Singleton instance
results_processor = ResultsProcessor()
