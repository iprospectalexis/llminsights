import logging
import sys
import os

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.brightdata_client import BrightDataClient

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def test_build_payload():
    """Test _build_payload method."""
    client = BrightDataClient()
    
    prompts = [f"Prompt {i}" for i in range(10)]
    source = "perplexity"
    geo_targeting = "Paris,Paris,Ile-de-France,France"
    
    print(f"Testing with {len(prompts)} prompts and geo_targeting='{geo_targeting}'")
    
    payload = client._build_payload(prompts, source, geo_targeting)
    
    print(f"Payload length: {len(payload)}")
    
    # Verify count
    if len(payload) != 10:
        print(f"FAILED: Expected 10 items, got {len(payload)}")
        return
    
    # Verify unique prompts
    payload_prompts = [item["prompt"] for item in payload]
    unique_prompts = set(payload_prompts)
    if len(unique_prompts) != 10:
        print(f"FAILED: Expected 10 unique prompts, got {len(unique_prompts)}")
        print(f"Prompts: {payload_prompts}")
        return
    
    # Verify country
    countries = [item["country"] for item in payload]
    if not all(c == "FR" for c in countries):
        print(f"FAILED: Expected country 'FR', got {countries}")
        return
        
    print("SUCCESS: Payload constructed correctly with unique prompts and country code.")

if __name__ == "__main__":
    test_build_payload()
