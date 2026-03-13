# OneSearch Webhook Setup Guide

## Overview

The application now uses **webhooks** to receive audit results from the OneSearch API automatically. This eliminates the need for polling and ensures results are processed even if the user closes their browser.

## How It Works

```
1. User starts audit
   ↓
2. run-audit creates job with webhook_url
   ↓
3. OneSearch API processes prompts (30+ minutes)
   ↓ USER CAN CLOSE BROWSER
4. When complete → OneSearch calls webhook
   ↓
5. onesearch-webhook Edge Function saves results
   ↓
6. Audit completes automatically
   ↓
7. User opens page → sees completed audit ✅
```

## Configuration Steps

### 1. Generate Webhook Secret

Generate a secure random string for webhook authentication:

```bash
# Using OpenSSL
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Add to Environment Variables

Add the following to your `.env` file:

```env
ONESEARCH_WEBHOOK_SECRET=your_generated_secret_here
```

**IMPORTANT:** Use the same secret that you provide to the OneSearch API.

### 3. Configure OneSearch API (Backend)

Your OneSearch API needs to send the webhook secret in the request headers when calling the webhook URL.

The webhook expects this header:
```
X-Webhook-Secret: your_generated_secret_here
```

If the OneSearch API doesn't send this header, or sends an incorrect value, the webhook will reject the request with a 401 Unauthorized error.

### 4. Webhook URL Format

The webhook URL is automatically generated and sent to OneSearch API when creating jobs:

```
https://your-project.supabase.co/functions/v1/onesearch-webhook
```

This URL is configured in `run-audit/index.ts` and sent in the `webhook_url` parameter.

## Webhook Payload

When a job completes, OneSearch API sends a POST request to the webhook URL with this payload:

```json
{
  "event": "job.completed",
  "job_id": "uuid-here",
  "status": "completed",
  "progress": 100,
  "total_prompts": 165,
  "processed_prompts": 165,
  "failed_prompts": 0,
  "results": ["url1", "url2"],
  "failed_queries": [],
  "error_message": null,
  "duration_seconds": 1800,
  "completed_at": "2025-02-02T12:00:00Z"
}
```

## Security Features

1. **Webhook Secret Validation**: Every webhook request is validated using the `X-Webhook-Secret` header
2. **Job ID Verification**: The webhook verifies that the job_id exists in the database
3. **Audit Ownership**: Results are only saved for valid audit IDs
4. **No JWT Required**: The webhook endpoint has `verify_jwt: false` to allow external API calls

## Testing the Webhook

### Manual Test

You can test the webhook manually using curl:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/onesearch-webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your_secret_here" \
  -d '{
    "event": "job.completed",
    "job_id": "test-job-id",
    "status": "completed",
    "progress": 100,
    "total_prompts": 2,
    "processed_prompts": 2,
    "failed_prompts": 0,
    "completed_at": "2025-02-02T12:00:00Z"
  }'
```

### Expected Response

Success (200):
```json
{
  "success": true,
  "message": "Processed 2 results for job test-job-id",
  "audit_id": "audit-uuid"
}
```

Unauthorized (401):
```json
{
  "error": "Unauthorized"
}
```

Not Found (404):
```json
{
  "error": "No responses found for this job_id",
  "job_id": "test-job-id"
}
```

## Troubleshooting

### Webhook not receiving requests

1. Check that OneSearch API is sending requests to the correct URL
2. Verify the webhook URL format: `https://your-project.supabase.co/functions/v1/onesearch-webhook`
3. Check OneSearch API logs for webhook delivery failures

### 401 Unauthorized errors

1. Verify `ONESEARCH_WEBHOOK_SECRET` is set correctly in `.env`
2. Confirm OneSearch API is sending the same secret in `X-Webhook-Secret` header
3. Check Edge Function logs in Supabase Dashboard

### Results not being saved

1. Check that the job_id exists in `llm_responses` table
2. Verify OneSearch API is returning results in the correct format
3. Check Edge Function logs for parsing errors

## Architecture Benefits

### Before (Polling)
- ❌ Required frontend to be open
- ❌ Browser polling every few seconds
- ❌ Results lost if page closed
- ❌ High resource usage

### After (Webhook)
- ✅ Works with browser closed
- ✅ No polling required
- ✅ Instant processing when ready
- ✅ Low resource usage
- ✅ Automatic audit completion

## Edge Functions

### run-audit
- Creates audit and llm_responses records
- Sends job to OneSearch API with webhook_url
- Returns immediately to frontend

### onesearch-webhook
- Receives completion notification from OneSearch API
- Fetches results from OneSearch API
- Updates llm_responses with results
- Parses citations
- Triggers audit completion (competitors, sentiment, metrics)

## Database Flow

```sql
-- 1. run-audit creates records
INSERT INTO audits (status = 'running')
INSERT INTO llm_responses (job_id = 'xxx', answer_text = null)

-- 2. OneSearch processes (user can close browser)
-- ... 30 minutes later ...

-- 3. Webhook receives notification
SELECT * FROM llm_responses WHERE job_id = 'xxx'

-- 4. Webhook updates records
UPDATE llm_responses SET answer_text = '...', citations = '...'
INSERT INTO citations (...)

-- 5. Webhook completes audit
UPDATE audits SET status = 'completed', progress = 100
```

## Next Steps

After setting up the webhook, you can:

1. Remove or simplify the `poll-audit-results` Edge Function (kept for backwards compatibility)
2. Remove frontend polling code (optional - can keep as backup)
3. Monitor webhook logs in Supabase Dashboard → Edge Functions → onesearch-webhook
4. Test with a real audit to verify end-to-end flow
