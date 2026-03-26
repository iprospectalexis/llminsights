import asyncio
import json
import logging
import sys
import os
from unittest.mock import MagicMock, AsyncMock, patch

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.brightdata_client import BrightDataClient

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

async def test_response_processing():
    """Test full flow with mocked API responses."""
    print("Testing BrightData response processing...")
    
    # Mock data
    prompts = [f"Prompt {i}" for i in range(10)]
    mock_results = [
        {
            "prompt": p,
            "answer_text": f"Answer for {p}",
            "input": {"prompt": p},
            "url": "http://example.com"
        } 
        for p in prompts
    ]
    
    # Create client
    client = BrightDataClient()
    
    # Mock httpx.AsyncClient
    mock_httpx_client = AsyncMock()
    
    # Setup mock responses
    # 1. Trigger response
    trigger_resp = MagicMock()
    trigger_resp.status_code = 200
    trigger_resp.json.return_value = {"snapshot_id": "snap_123"}
    
    # 2. Poll response
    poll_resp = MagicMock()
    poll_resp.status_code = 200
    poll_resp.json.return_value = {"status": "ready"}
    
    # 3. Download response
    download_resp = MagicMock()
    download_resp.status_code = 200
    download_resp.headers = {"content-type": "application/json"}
    download_resp.json.return_value = mock_results
    
    # Configure client.post and client.get side effects
    async def mock_post(url, *args, **kwargs):
        if "/trigger" in url:
            return trigger_resp
        return MagicMock(status_code=404)
        
    async def mock_get(url, *args, **kwargs):
        if "/progress" in url:
            return poll_resp
        if "/snapshot" in url:
            return download_resp
        return MagicMock(status_code=404)
        
    mock_httpx_client.post.side_effect = mock_post
    mock_httpx_client.get.side_effect = mock_get
    mock_httpx_client.__aenter__.return_value = mock_httpx_client
    mock_httpx_client.__aexit__.return_value = None
    
    # Patch httpx.AsyncClient to return our mock
    with patch("httpx.AsyncClient", return_value=mock_httpx_client):
        # Run process_all_prompts
        process_kwargs = {
            "prompts": prompts,
            "geo_targeting": "Paris,Paris,Ile-de-France,France",
            "source": "perplexity",
        }
        
        results, failed = await client.process_all_prompts(**process_kwargs)
        
        print(f"Processed: {len(results)}")
        print(f"Failed: {len(failed)}")
        
        # Verify results
        if len(results) != 10:
            print(f"FAILED: Expected 10 results, got {len(results)}")
            return
            
        # Check for duplicates in results
        result_prompts = [r.get("prompt") for r in results]
        unique_prompts = set(result_prompts)
        
        print("\nResult Prompts:")
        for i, p in enumerate(result_prompts):
            print(f"  {i}: {p}")
            
        if len(unique_prompts) != 10:
            print(f"FAILED: Duplicates found! Unique: {len(unique_prompts)}")
        else:
            print("SUCCESS: All results are unique.")

if __name__ == "__main__":
    asyncio.run(test_response_processing())
