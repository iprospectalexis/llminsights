from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, Boolean
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from app.database import Base


class JobStatus(str, enum.Enum):
    """Job status enumeration."""
    PENDING = "pending"
    GETTING_RESULTS = "getting_results"  # Making API requests and receiving results
    PROCESSING_RESULTS = "processing_results"  # Processing files to get final converted JSON
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    # Legacy alias for backwards compatibility
    PROCESSING = "getting_results"


class Provider(str, enum.Enum):
    """API provider enumeration."""
    SERP = "serp"
    BRIGHTDATA = "brightdata"


class Job(Base):
    """Job model representing a batch processing request."""
    __tablename__ = "jobs"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Owner (API key that created this job)
    owner_id = Column(String(36), nullable=True, index=True)  # FK to api_keys.id

    # Job configuration (stored as JSON string for SQLite)
    prompts = Column(JSON, nullable=False)
    geo_targeting = Column(String(255), default="Paris,Paris,Ile-de-France,France")
    source = Column(String(50), default="chatgpt")
    provider = Column(String(20), default=Provider.SERP.value)  # serp | brightdata
    web_search = Column(Boolean, default=True)  # Enable web search for prompts
    
    # Status tracking
    status = Column(String(20), default=JobStatus.PENDING.value, nullable=False, index=True)
    progress = Column(Integer, default=0)
    total_prompts = Column(Integer, default=0)
    processed_prompts = Column(Integer, default=0)
    failed_prompts = Column(Integer, default=0)
    
    # Results
    results = Column(JSON, nullable=True)  # SERP: Links to zip files, BrightData: raw JSON results
    merged_results_file = Column(String(500), nullable=True)  # Path to merged JSON
    merged_results_count = Column(Integer, default=0)  # Number of items in merged file
    converted_results_file = Column(String(500), nullable=True)  # Path to converted JSON
    failed_queries = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Webhook
    webhook_url = Column(String(500), nullable=True)
    webhook_sent = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    def __repr__(self):
        return f"<Job(id={self.id}, status={self.status}, progress={self.progress}%)>"
    
    @property
    def duration_seconds(self) -> int | None:
        if self.started_at and self.completed_at:
            return int((self.completed_at - self.started_at).total_seconds())
        elif self.started_at:
            return int((datetime.utcnow() - self.started_at).total_seconds())
        return None
