from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
from enum import Enum


class JobStatusEnum(str, Enum):
    PENDING = "pending"
    GETTING_RESULTS = "getting_results"  # Making API requests and receiving results
    PROCESSING_RESULTS = "processing_results"  # Processing files to get final converted JSON
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProviderEnum(str, Enum):
    SERP = "serp"
    BRIGHTDATA = "brightdata"


# Request Schemas

class JobCreate(BaseModel):
    """Schema for creating a new job."""

    prompts: list[str] = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="List of prompts to process (max 1000)"
    )
    geo_targeting: str = Field(
        default="Paris,Paris,Ile-de-France,France",
        description="Geo targeting string"
    )
    source: str = Field(
        default="chatgpt",
        description="AI source: chatgpt, perplexity, gemini, copilot"
    )
    provider: ProviderEnum = Field(
        default=ProviderEnum.SERP,
        description="API provider: serp or brightdata"
    )
    web_search: bool = Field(
        default=True,
        description="Enable web search for prompts"
    )
    webhook_url: Optional[str] = Field(
        default=None,
        description="URL to send webhook notification when job completes"
    )
    
    @field_validator('prompts')
    @classmethod
    def validate_prompts(cls, v):
        if not v:
            raise ValueError('At least one prompt is required')
        v = [p.strip() for p in v if p.strip()]
        if not v:
            raise ValueError('At least one non-empty prompt is required')
        return v
    
    @field_validator('webhook_url')
    @classmethod
    def validate_webhook_url(cls, v):
        if v and not v.startswith(('http://', 'https://')):
            raise ValueError('Webhook URL must start with http:// or https://')
        return v


# Response Schemas

class JobResponse(BaseModel):
    """Schema for job response."""

    id: str
    status: JobStatusEnum
    provider: Optional[str] = "serp"
    source: Optional[str] = "chatgpt"
    web_search: Optional[bool] = True
    progress: int = Field(ge=0, le=100)
    total_prompts: int
    processed_prompts: int
    failed_prompts: int
    results: Optional[list] = None  # SERP: list of URLs, BrightData: list of result dicts
    merged_results_file: Optional[str] = None
    merged_results_count: Optional[int] = None
    converted_results_file: Optional[str] = None
    # Download URLs (constructed by the endpoint)
    download_url: Optional[str] = None
    converted_download_url: Optional[str] = None
    failed_queries: Optional[list[str]] = None
    error_message: Optional[str] = None
    webhook_url: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None

    class Config:
        from_attributes = True


class JobCreateResponse(BaseModel):
    """Response when creating a new job."""

    id: str
    status: JobStatusEnum
    provider: str
    message: str
    total_prompts: int
    estimated_batches: int


class JobListResponse(BaseModel):
    """Response for listing jobs."""
    
    jobs: list[JobResponse]
    total: int
    page: int
    per_page: int
    pages: int


class HealthResponse(BaseModel):
    """Health check response."""
    
    status: str
    version: str
    database: str
    active_jobs: int


class WebhookPayload(BaseModel):
    """Webhook payload sent when job completes."""
    
    event: str = "job.completed"
    job_id: str
    status: JobStatusEnum
    progress: int
    total_prompts: int
    processed_prompts: int
    failed_prompts: int
    results: Optional[list[str]] = None  # SERP: download links, BrightData: None (data in files)
    failed_queries: Optional[list[str]] = None
    error_message: Optional[str] = None
    duration_seconds: Optional[int] = None
    completed_at: datetime
    # File paths for processed results
    merged_results_file: Optional[str] = None
    merged_results_count: Optional[int] = None
    converted_results_file: Optional[str] = None

