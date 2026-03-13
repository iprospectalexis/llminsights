# OneSearch API Required Changes for Webhook Support

## Overview

Your OneSearch API already supports webhooks! You just need to make a small modification to send the webhook secret in the request headers for security.

## Current Implementation (From Your Code)

Your API already has webhook support in `job_processor.py`:

```python
# Send webhook if configured
if job.webhook_url:
    webhook_sent = await webhook_service.send(
        url=job.webhook_url,
        job_id=job.id,
        status=job.status,
        ...
    )
```

## Required Change

You need to add the `X-Webhook-Secret` header when sending webhook requests.

### Location: `webhook_service.py` (or wherever you send webhook requests)

**Before:**
```python
async def send(
    self,
    url: str,
    job_id: str,
    status: JobStatusEnum,
    ...
):
    payload = WebhookPayload(
        event="job.completed",
        job_id=job_id,
        status=status,
        ...
    )

    response = await httpx.AsyncClient().post(
        url=url,
        json=payload.dict(),
        headers={
            "Content-Type": "application/json"
        }
    )
```

**After:**
```python
import os

async def send(
    self,
    url: str,
    job_id: str,
    status: JobStatusEnum,
    ...
):
    payload = WebhookPayload(
        event="job.completed",
        job_id=job_id,
        status=status,
        ...
    )

    # Get webhook secret from environment
    webhook_secret = os.getenv("WEBHOOK_SECRET", "")

    headers = {
        "Content-Type": "application/json"
    }

    # Add webhook secret if configured
    if webhook_secret:
        headers["X-Webhook-Secret"] = webhook_secret

    response = await httpx.AsyncClient().post(
        url=url,
        json=payload.dict(),
        headers=headers
    )
```

## Environment Variable

Add to your OneSearch API `.env` file:

```env
WEBHOOK_SECRET=your_webhook_secret_here
```

**IMPORTANT:** Use the same secret that you configured in the Supabase application's `.env` file under `ONESEARCH_WEBHOOK_SECRET`.

## Example: Complete Webhook Service

```python
# webhook_service.py
import os
import httpx
import logging
from typing import Optional
from models.job import WebhookPayload, JobStatusEnum

logger = logging.getLogger(__name__)

class WebhookService:
    def __init__(self):
        self.webhook_secret = os.getenv("WEBHOOK_SECRET", "")

    async def send(
        self,
        url: str,
        job_id: str,
        status: JobStatusEnum,
        progress: int,
        total_prompts: int,
        processed_prompts: int,
        failed_prompts: int,
        results: Optional[list] = None,
        failed_queries: Optional[list] = None,
        error_message: Optional[str] = None,
        duration_seconds: Optional[int] = None,
        completed_at: datetime = None
    ) -> bool:
        """Send webhook notification when job completes"""

        try:
            payload = WebhookPayload(
                event="job.completed",
                job_id=job_id,
                status=status,
                progress=progress,
                total_prompts=total_prompts,
                processed_prompts=processed_prompts,
                failed_prompts=failed_prompts,
                results=results,
                failed_queries=failed_queries,
                error_message=error_message,
                duration_seconds=duration_seconds,
                completed_at=completed_at or datetime.utcnow()
            )

            headers = {
                "Content-Type": "application/json"
            }

            # Add webhook secret for authentication
            if self.webhook_secret:
                headers["X-Webhook-Secret"] = self.webhook_secret
                logger.info(f"Sending webhook with secret authentication to {url}")
            else:
                logger.warning(f"Sending webhook WITHOUT secret authentication to {url}")

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    url=url,
                    json=payload.dict(),
                    headers=headers
                )

                if response.status_code == 200:
                    logger.info(f"Webhook sent successfully for job {job_id}")
                    return True
                elif response.status_code == 401:
                    logger.error(f"Webhook authentication failed for job {job_id}: Invalid secret")
                    return False
                else:
                    logger.error(f"Webhook failed for job {job_id}: {response.status_code} - {response.text}")
                    return False

        except httpx.TimeoutException:
            logger.error(f"Webhook timeout for job {job_id} to {url}")
            return False
        except Exception as e:
            logger.error(f"Webhook error for job {job_id}: {str(e)}")
            return False

# Singleton instance
webhook_service = WebhookService()
```

## Testing

### 1. Local Testing

Test your webhook service locally:

```python
# test_webhook.py
import asyncio
from webhook_service import webhook_service
from datetime import datetime
from models.job import JobStatusEnum

async def test():
    result = await webhook_service.send(
        url="https://your-project.supabase.co/functions/v1/onesearch-webhook",
        job_id="test-job-123",
        status=JobStatusEnum.COMPLETED,
        progress=100,
        total_prompts=2,
        processed_prompts=2,
        failed_prompts=0,
        results=["result1", "result2"],
        duration_seconds=120,
        completed_at=datetime.utcnow()
    )

    print(f"Webhook sent: {result}")

asyncio.run(test())
```

### 2. Expected Response

**Success (200):**
```json
{
  "success": true,
  "message": "Processed 2 results for job test-job-123",
  "audit_id": "audit-uuid"
}
```

**Unauthorized (401):**
```json
{
  "error": "Unauthorized"
}
```

## Security Considerations

1. **Secret Storage**: Store the webhook secret in environment variables, never hardcode it
2. **HTTPS Only**: Always use HTTPS URLs for webhooks in production
3. **Timeout**: Set reasonable timeout (30 seconds recommended)
4. **Retry Logic**: Consider adding retry logic for failed webhook deliveries
5. **Logging**: Log webhook attempts for debugging (but don't log the secret!)

## Verification Checklist

- [ ] Added `WEBHOOK_SECRET` to OneSearch API environment variables
- [ ] Modified webhook service to send `X-Webhook-Secret` header
- [ ] Same secret configured in both OneSearch API and Supabase application
- [ ] Tested webhook locally with test job
- [ ] Verified webhook receives 200 response
- [ ] Verified unauthorized requests receive 401 response
- [ ] Tested end-to-end: create job → wait for completion → webhook triggered → results saved

## Troubleshooting

### Webhook returns 401 Unauthorized

**Cause:** Webhook secrets don't match

**Solution:**
1. Check OneSearch API `.env`: `WEBHOOK_SECRET=xxx`
2. Check Supabase `.env`: `ONESEARCH_WEBHOOK_SECRET=xxx`
3. Ensure both values are identical
4. Restart both services after changing environment variables

### Webhook times out

**Cause:** Network issues or Supabase Edge Function is slow

**Solution:**
1. Increase timeout to 30-60 seconds
2. Check Supabase Edge Function logs for errors
3. Verify webhook URL is correct and accessible

### Webhook not being called

**Cause:** Job completion not triggering webhook

**Solution:**
1. Check job_processor.py to ensure webhook is called on completion
2. Verify `job.webhook_url` is set correctly when job is created
3. Check OneSearch API logs for webhook send attempts

## Next Steps

After implementing these changes:

1. Deploy the updated webhook service to your OneSearch API
2. Configure the webhook secret in both applications
3. Test with a real audit
4. Monitor webhook logs in both systems
5. Verify results are saved correctly in Supabase
