"""
One-off script to re-run competitor extraction for Guy Hoquet audit.
Calls the extract-competitors edge function for each response in batches.
"""
import asyncio
import aiohttp
import json
import sys
import time

SUPABASE_URL = "https://gpjkhdsonsdbnvmicgqf.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwamtoZHNvbnNkYm52bWljZ3FmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjczNDY5NywiZXhwIjoyMDcyMzEwNjk3fQ.GfxbErN5-edgKufCZl6lrTNyvyUNPY6mAc_AOF_GjOg"
AUDIT_ID = "dce58a57-a041-402f-afc6-60e566c1c410"

BATCH_SIZE = 10
DELAY_BETWEEN_BATCHES = 1.0  # seconds


async def fetch_responses(session):
    """Fetch all responses needing competitor extraction."""
    url = (
        f"{SUPABASE_URL}/rest/v1/llm_responses"
        f"?select=id,answer_text,prompts(prompt_text)"
        f"&audit_id=eq.{AUDIT_ID}"
        f"&answer_text=not.is.null"
        f"&answer_competitors=is.null"
        f"&limit=1000"
    )
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    async with session.get(url, headers=headers) as resp:
        return await resp.json()


async def extract_competitors(session, response_data):
    """Call extract-competitors edge function for a single response."""
    url = f"{SUPABASE_URL}/functions/v1/extract-competitors"
    headers = {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "prompt": (response_data.get("prompts") or {}).get("prompt_text", ""),
        "answerText": response_data["answer_text"],
        "responseId": response_data["id"],
        "auditId": AUDIT_ID,
    }
    try:
        async with session.post(url, headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            result = await resp.json()
            if resp.status == 200 and result.get("success"):
                return True, response_data["id"], result.get("message", "ok")
            else:
                return False, response_data["id"], result.get("error", f"status {resp.status}")
    except Exception as e:
        return False, response_data["id"], str(e)


async def main():
    start = time.time()

    async with aiohttp.ClientSession() as session:
        # Fetch responses
        responses = await fetch_responses(session)
        total = len(responses)
        print(f"Found {total} responses to process")

        if total == 0:
            print("Nothing to do!")
            return

        success_count = 0
        fail_count = 0

        # Process in batches
        for i in range(0, total, BATCH_SIZE):
            batch = responses[i:i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

            tasks = [extract_competitors(session, r) for r in batch]
            results = await asyncio.gather(*tasks)

            for ok, rid, msg in results:
                if ok:
                    success_count += 1
                else:
                    fail_count += 1
                    print(f"  FAIL {rid}: {msg}")

            elapsed = time.time() - start
            print(f"Batch {batch_num}/{total_batches}: {success_count} ok, {fail_count} failed ({elapsed:.1f}s)")

            if i + BATCH_SIZE < total:
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        elapsed = time.time() - start
        print(f"\nDone! {success_count}/{total} successful, {fail_count} failed in {elapsed:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
