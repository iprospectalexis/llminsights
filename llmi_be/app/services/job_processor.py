import logging
import asyncio
from datetime import datetime
from typing import Dict, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import Job, JobStatus, Provider
from app.services.serp_client import SerpClient
from app.services.brightdata_client import BrightDataClient
from app.services.webhook import webhook_service
from app.services.results_processor import results_processor
from app.config import get_settings
from app.services.geo_utils import extract_country_code

logger = logging.getLogger(__name__)
settings = get_settings()


class JobProcessor:
    """
    Background job processor that runs jobs asynchronously.
    Uses asyncio tasks instead of Celery.
    """
    
    def __init__(self):
        self.active_jobs: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
    
    async def start_job(self, job_id: str):
        """Start processing a job in the background."""
        async with self._lock:
            if job_id in self.active_jobs:
                logger.warning(f"Job {job_id} is already running")
                return
            
            task = asyncio.create_task(self._process_job(job_id))
            self.active_jobs[job_id] = task
            
            # Clean up when done
            task.add_done_callback(
                lambda t: asyncio.create_task(self._cleanup_job(job_id))
            )
    
    async def _cleanup_job(self, job_id: str):
        """Remove job from active jobs after completion."""
        async with self._lock:
            self.active_jobs.pop(job_id, None)
    
    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a running job."""
        async with self._lock:
            task = self.active_jobs.get(job_id)
            if task and not task.done():
                task.cancel()
                return True
            return False
    
    def get_active_job_ids(self) -> Set[str]:
        """Get set of currently active job IDs."""
        return set(self.active_jobs.keys())
    
    async def _process_job(self, job_id: str):
        """Main job processing logic."""
        logger.info(f"Starting job processing: {job_id}")
        
        async with AsyncSessionLocal() as session:
            try:
                # Fetch job
                result = await session.execute(
                    select(Job).filter(Job.id == job_id)
                )
                job = result.scalar_one_or_none()
                
                if not job:
                    logger.error(f"Job not found: {job_id}")
                    return
                
                # Update status to getting_results (making API requests)
                job.status = JobStatus.GETTING_RESULTS.value
                job.started_at = datetime.utcnow()
                await session.commit()

                # Extract country code from geo_targeting
                geo_targeting = job.geo_targeting or "Paris,Paris,Ile-de-France,France"
                country_code = extract_country_code(geo_targeting)

                # Select client based on provider
                provider = job.provider or Provider.SERP.value
                is_brightdata = provider == Provider.BRIGHTDATA.value

                if is_brightdata:
                    client = BrightDataClient()
                    logger.info(f"Job {job_id}: Using BrightData provider")
                else:
                    client = SerpClient()
                    logger.info(f"Job {job_id}: Using SERP provider")

                prompts = job.prompts
                total_prompts = len(prompts)

                # Progress callback - tracks last progress to avoid duplicate logs
                last_logged_progress = [0]

                async def update_progress(processed: int, total: int, results_so_far: list):
                    try:
                        job.processed_prompts = processed
                        job.progress = int((processed / total) * 100)
                        # Don't update results during progress for BrightData (too much data)
                        if not is_brightdata and results_so_far:
                            job.results = results_so_far
                        await session.commit()

                        # Only log on significant progress changes (every 5%)
                        if job.progress >= last_logged_progress[0] + 5 or job.progress == 100:
                            logger.info(f"Job {job_id} progress: {job.progress}% ({processed}/{total})")
                            last_logged_progress[0] = job.progress
                    except Exception as e:
                        logger.warning(f"Failed to update progress: {e}")
                        await session.rollback()

                # Process all prompts
                # Build kwargs - only pass search for SERP provider
                process_kwargs = {
                    "prompts": prompts,
                    "geo_targeting": job.geo_targeting or "Paris,Paris,Ile-de-France,France",
                    "source": job.source or "chatgpt",
                    "max_retries": settings.max_retries,
                    "progress_callback": update_progress,
                }
                if not is_brightdata:
                    # Pass web_search parameter only for SERP (default True if not set)
                    process_kwargs["search"] = job.web_search if job.web_search is not None else True

                # Memory-bounded streaming for large BrightData jobs (>100 prompts)
                stream_file = None
                if is_brightdata and total_prompts > 100:
                    from pathlib import Path
                    results_dir = Path("results")
                    results_dir.mkdir(exist_ok=True)
                    stream_file = str(results_dir / f"{job_id}_stream.jsonl")
                    process_kwargs["output_file"] = stream_file
                    logger.info(f"Job {job_id}: Using memory-bounded streaming to {stream_file}")

                logger.info(f"Job {job_id}: Starting process_all_prompts with {len(prompts)} prompts")
                logger.debug(f"Job {job_id}: First 3 prompts: {prompts[:3]}")
                results, failed_queries = await client.process_all_prompts(**process_kwargs)

                # If streaming was used, load results from file for post-processing
                if stream_file and not results:
                    import json as _json
                    from pathlib import Path
                    stream_path = Path(stream_file)
                    if stream_path.exists():
                        results = []
                        with open(stream_path, 'r', encoding='utf-8') as f:
                            for line in f:
                                line = line.strip()
                                if line:
                                    results.append(_json.loads(line))
                        logger.info(f"Job {job_id}: Loaded {len(results)} results from stream file")

                logger.info(f"Job {job_id}: process_all_prompts returned {len(results)} results, {len(failed_queries)} failed")

                # Update status to processing_results (file operations)
                job.status = JobStatus.PROCESSING_RESULTS.value
                await session.commit()
                logger.info(f"Job {job_id}: status updated to processing_results")

                # Update final status and commit IMMEDIATELY before file processing
                job.status = JobStatus.COMPLETED.value
                job.progress = 100
                job.processed_prompts = total_prompts - len(failed_queries)
                job.failed_prompts = len(failed_queries)
                job.failed_queries = failed_queries if failed_queries else None
                job.completed_at = datetime.utcnow()

                # Mark as failed if no results
                if not results and failed_queries:
                    job.status = JobStatus.FAILED.value
                    job.error_message = f"All {len(failed_queries)} prompts failed"

                # CRITICAL: Commit status NOW before file processing
                # This ensures status is persisted even if file operations fail
                logger.info(f"Job {job_id}: Committing status={job.status} to database (before file processing)...")
                await session.commit()
                logger.info(f"Job {job_id}: Status committed successfully")

                # Now handle file processing (failures here won't affect job status)
                if is_brightdata:
                    # BrightData returns data directly - save to file
                    if results:
                        try:
                            logger.info(f"Saving BrightData results for job {job_id}...")
                            result_info = await results_processor.save_brightdata_results(
                                results=results,
                                job_id=job_id,
                                source=job.source or "",
                                country=country_code,
                            )
                            job.merged_results_file = result_info.get("merged_file")
                            job.merged_results_count = result_info.get("total_items", 0)
                            job.converted_results_file = result_info.get("converted_file")
                            job.results = None  # Don't store raw data in DB
                            logger.info(f"Job {job_id}: saved {job.merged_results_count} items")
                            # Commit file paths update
                            await session.commit()
                        except Exception as save_error:
                            logger.error(f"Failed to save results for job {job_id}: {save_error}")
                            await session.rollback()
                            # Re-fetch job to update with fallback
                            result = await session.execute(select(Job).filter(Job.id == job_id))
                            job = result.scalar_one_or_none()
                            if job:
                                job.results = results  # Fallback: store in DB
                                await session.commit()
                else:
                    # SERP returns download links - process them
                    job.results = results if results else None
                    if results:
                        try:
                            logger.info(f"Processing SERP results for job {job_id}: {len(results)} result links")
                            for i, link in enumerate(results):
                                logger.info(f"  Link {i+1}: {link[:80]}...")
                            result_info = await results_processor.process_job_results(
                                result_links=results,
                                job_id=job_id,
                                country=country_code,
                            )
                            job.merged_results_file = result_info.get("merged_file")
                            job.merged_results_count = result_info.get("total_items", 0)
                            job.converted_results_file = result_info.get("converted_file")
                            logger.info(f"Job {job_id}: merged {job.merged_results_count} items")
                            # Commit file paths update
                            await session.commit()
                        except Exception as merge_error:
                            logger.error(f"Failed to process results for job {job_id}: {merge_error}")
                            await session.rollback()
                    else:
                        # No results to process, just commit the results field
                        await session.commit()


                logger.info(f"Job {job_id} completed: status={job.status}, {len(results)} results, {len(failed_queries)} failures")
                
                # Send webhook if configured
                if job.webhook_url:
                    # CRITICAL: Re-fetch job to get latest data (file paths, etc.) after multiple commits
                    logger.info(f"Re-fetching job {job_id} for webhook with latest data...")
                    result = await session.execute(select(Job).filter(Job.id == job_id))
                    job = result.scalar_one_or_none()
                    
                    if job:
                        logger.info(f"Sending webhook for job {job_id} to {job.webhook_url}")
                        webhook_sent = await webhook_service.send(
                            url=job.webhook_url,
                            job_id=job.id,
                            status=job.status,
                            progress=job.progress,
                            total_prompts=job.total_prompts,
                            processed_prompts=job.processed_prompts,
                            failed_prompts=job.failed_prompts,
                            results=job.results,
                            failed_queries=job.failed_queries,
                            error_message=job.error_message,
                            duration_seconds=job.duration_seconds,
                            merged_results_file=job.merged_results_file,
                            merged_results_count=job.merged_results_count,
                            converted_results_file=job.converted_results_file,
                        )
                        if webhook_sent:
                            logger.info(f"Webhook sent successfully for job {job_id}")
                            job.webhook_sent = datetime.utcnow()
                            await session.commit()
                        else:
                            logger.error(f"Webhook failed for job {job_id}")
                    else:
                        logger.error(f"Could not re-fetch job {job_id} for webhook")

                
            except asyncio.CancelledError:
                logger.info(f"Job {job_id} was cancelled")
                try:
                    result = await session.execute(
                        select(Job).filter(Job.id == job_id)
                    )
                    job = result.scalar_one_or_none()
                    if job:
                        job.status = JobStatus.CANCELLED.value
                        job.completed_at = datetime.utcnow()
                        await session.commit()
                except Exception:
                    pass
                raise
                
            except Exception as e:
                logger.exception(f"Job {job_id} failed with error: {e}")
                
                try:
                    result = await session.execute(
                        select(Job).filter(Job.id == job_id)
                    )
                    job = result.scalar_one_or_none()
                    if job:
                        job.status = JobStatus.FAILED.value
                        job.error_message = str(e)
                        job.completed_at = datetime.utcnow()
                        await session.commit()
                        
                        # Send webhook for failure
                        if job.webhook_url:
                            await webhook_service.send(
                                url=job.webhook_url,
                                job_id=job.id,
                                status=job.status,
                                progress=job.progress,
                                total_prompts=job.total_prompts,
                                processed_prompts=job.processed_prompts,
                                failed_prompts=job.failed_prompts,
                                results=job.results,
                                failed_queries=job.failed_queries,
                                error_message=job.error_message,
                                duration_seconds=job.duration_seconds,
                                merged_results_file=job.merged_results_file,
                                merged_results_count=job.merged_results_count,
                                converted_results_file=job.converted_results_file,
                            )
                except Exception as db_error:
                    logger.error(f"Failed to update job status: {db_error}")


# Global job processor instance
job_processor = JobProcessor()
