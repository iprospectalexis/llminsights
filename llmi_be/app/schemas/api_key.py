from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# Request Schemas

class ApiKeyCreate(BaseModel):
    """Schema for creating a new API key."""
    name: str = Field(..., min_length=1, max_length=100, description="Name for the API key (e.g., partner name)")
    description: Optional[str] = Field(None, max_length=500, description="Optional description")
    rate_limit: int = Field(default=100, ge=1, le=1000, description="Requests per minute limit")
    daily_limit: int = Field(default=10000, ge=100, le=100000, description="Requests per day limit")
    max_prompts_per_job: int = Field(default=1000, ge=1, le=10000, description="Max prompts per job")
    expires_in_days: Optional[int] = Field(None, ge=1, le=365, description="Days until expiration (None = never)")


# Response Schemas

class ApiKeyResponse(BaseModel):
    """Schema for API key response (without the actual key)."""
    id: str
    key_prefix: str
    name: str
    description: Optional[str] = None
    is_active: bool
    rate_limit: int
    daily_limit: int
    max_prompts_per_job: int
    total_requests: int
    total_jobs: int
    total_prompts: int
    last_used_at: Optional[datetime] = None
    created_at: datetime
    expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ApiKeyCreateResponse(BaseModel):
    """Response when creating a new API key (includes the actual key, shown only once)."""
    id: str
    key: str  # The actual API key - only shown at creation time!
    key_prefix: str
    name: str
    description: Optional[str] = None
    rate_limit: int
    daily_limit: int
    max_prompts_per_job: int
    created_at: datetime
    expires_at: Optional[datetime] = None
    message: str = "Store this key securely - it will not be shown again!"


class ApiKeyListResponse(BaseModel):
    """Response for listing API keys."""
    keys: list[ApiKeyResponse]
    total: int


class ApiKeyUsageResponse(BaseModel):
    """Response for API key usage statistics."""
    id: str
    name: str
    total_requests: int
    total_jobs: int
    total_prompts: int
    last_used_at: Optional[datetime] = None
    created_at: datetime
    # Today's usage
    requests_today: int = 0
    jobs_today: int = 0
    prompts_today: int = 0
