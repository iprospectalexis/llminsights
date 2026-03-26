import httpx
import logging
from datetime import datetime
from typing import Optional

from app.config import get_settings
from app.schemas import WebhookPayload, JobStatusEnum

logger = logging.getLogger(__name__)
settings = get_settings()


class WebhookService:
    """Service for sending webhook notifications."""
    
    def __init__(self, timeout: int = None, max_retries: int = None):
        self.timeout = timeout or settings.webhook_timeout
        self.max_retries = max_retries or settings.webhook_max_retries
    
    async def send(
        self,
        url: str,
        job_id: str,
        status: str,
        progress: int,
        total_prompts: int,
        processed_prompts: int,
        failed_prompts: int,
        results: Optional[list[str]] = None,
        failed_queries: Optional[list[str]] = None,
        error_message: Optional[str] = None,
        duration_seconds: Optional[int] = None,
        merged_results_file: Optional[str] = None,
        merged_results_count: Optional[int] = None,
        converted_results_file: Optional[str] = None,
    ) -> bool:
        """Send webhook notification."""
        if not url:
            logger.warning(f"No webhook URL for job {job_id}")
            return False
        
        # Determine event type
        if status == JobStatusEnum.COMPLETED.value:
            event = "job.completed"
        elif status == JobStatusEnum.FAILED.value:
            event = "job.failed"
        else:
            event = "job.updated"
        
        payload = WebhookPayload(
            event=event,
            job_id=job_id,
            status=JobStatusEnum(status),
            progress=progress,
            total_prompts=total_prompts,
            processed_prompts=processed_prompts,
            failed_prompts=failed_prompts,
            results=results,
            failed_queries=failed_queries,
            error_message=error_message,
            duration_seconds=duration_seconds,
            completed_at=datetime.utcnow(),
            merged_results_file=merged_results_file,
            merged_results_count=merged_results_count,
            converted_results_file=converted_results_file,
        )
        
        for attempt in range(self.max_retries):
            try:
                logger.info(f"Sending webhook for job {job_id} to {url} (attempt {attempt + 1})")
                
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(
                        url,
                        json=payload.model_dump(mode='json'),
                        headers={
                            "Content-Type": "application/json",
                            "User-Agent": "SERP-SaaS-API/1.0",
                            "X-Webhook-Secret": settings.webhook_secret,
                        },
                    )
                    response.raise_for_status()
                
                logger.info(f"Webhook sent successfully for job {job_id}")
                return True
                
            except Exception as e:
                logger.warning(f"Webhook attempt {attempt + 1} failed: {e}")
                if attempt == self.max_retries - 1:
                    logger.error(f"Failed to send webhook for job {job_id}: {e}")
                    return False
        
        return False


webhook_service = WebhookService()
