import sqlite3
import json
import os
import sys

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

DB_PATH = "serp_jobs.db"

def inspect_latest_job():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get latest job
    cursor.execute("SELECT id, created_at, prompts, status FROM jobs ORDER BY created_at DESC LIMIT 1")
    row = cursor.fetchone()
    
    if not row:
        print("No jobs found in database")
        return

    job_id, created_at, prompts_json, status = row
    
    print(f"Latest Job ID: {job_id}")
    print(f"Created At: {created_at}")
    print(f"Status: {status}")
    
    try:
        prompts = json.loads(prompts_json)
        print(f"Prompts Count: {len(prompts)}")
        print("Prompts Content:")
        for i, p in enumerate(prompts):
            print(f"  {i}: {p}")
            
        # Check uniqueness
        unique_prompts = set(prompts)
        if len(unique_prompts) != len(prompts):
            print(f"WARNING: Found duplicates! Unique count: {len(unique_prompts)}")
        else:
            print("SUCCESS: All prompts are unique")
            
    except json.JSONDecodeError:
        print(f"Failed to decode prompts JSON: {prompts_json}")
        
    conn.close()

if __name__ == "__main__":
    inspect_latest_job()
