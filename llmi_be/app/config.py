from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional
from pathlib import Path
import os

# Load .env file manually so it overrides system env vars
_env_file = Path(__file__).resolve().parent.parent / ".env"
if _env_file.exists():
    with open(_env_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ[key.strip()] = value.strip()


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Application
    app_name: str = "SERP SaaS API (Lite)"
    app_version: str = "1.0.0"
    debug: bool = False
    
    # Database
    database_path: str = "serp_jobs.db"  # SQLite fallback for local dev
    database_url_override: Optional[str] = None  # PostgreSQL URL (env: DATABASE_URL_OVERRIDE)
    
    # SERP API
    serp_api_key: str = ""
    serp_api_base_url: str = "https://onesearch-serp-api-v2-6u442cyz.uc.gateway.dev"

    # BrightData API
    brightdata_api_key: str = ""
    brightdata_base_url: str = "https://api.brightdata.com/datasets/v3"
    brightdata_dataset_chatgpt: str = "gd_m7aof0k82r803d5bjm"
    brightdata_dataset_perplexity: str = "gd_m7dhdot1vw9a7gc1n"
    brightdata_dataset_gemini: str = "gd_mbz66arm2mf9cu856y"
    brightdata_dataset_grok: str = "gd_m8ve0u141icu75ae74"
    brightdata_dataset_google_ai_mode: str = "gd_mcswdt6z2elth3zqr2"
    brightdata_dataset_google_ai_overview: str = "gd_mfz5x93lmsjjjylob"
    brightdata_batch_size: int = 500  # Deprecated: kept for .env compatibility
    brightdata_polling_interval: int = 5  # Reduced from 10 for faster completion detection

    # BrightData High-Concurrency Strategy
    # ≤20 inputs/request allows up to 1,500 concurrent requests
    brightdata_chunk_size: int = 10  # Prompts per request (keep ≤20 for high concurrency)
    brightdata_max_concurrent: int = 100  # Max parallel chunk requests

    # OpenAI API
    openai_api_key: str = ""

    # OneSearch API (self or remote backend)
    onesearch_api_url: str = "http://localhost:8000"
    onesearch_api_key: str = ""

    # Security
    api_key: Optional[str] = None
    
    # Job Configuration
    max_prompts_per_job: int = 5000  # Increased for audit scaling (was 1000)
    batch_size: int = 100
    max_concurrent_batches: int = 5  # Number of batches to process in parallel
    max_retries: int = 3
    polling_interval: int = 5
    polling_timeout: int = 600
    
    # Webhook
    webhook_timeout: int = 30
    webhook_max_retries: int = 3
    webhook_secret: Optional[str] = None
    
    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        return f"sqlite+aiosqlite:///{self.database_path}"

    @property
    def is_postgres(self) -> bool:
        return 'postgresql' in self.database_url
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        # .env file takes precedence over system environment variables
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
