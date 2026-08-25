import uuid
import secrets
import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Integer, DateTime, Boolean, Uuid
from app.database import Base


def generate_api_key() -> str:
    """Generate a secure API key with prefix."""
    return f"llmi_{secrets.token_urlsafe(32)}"


def hash_api_key(key: str) -> str:
    """Hash API key for secure storage."""
    return hashlib.sha256(key.encode()).hexdigest()


class ApiKey(Base):
    """API Key model for partner access management."""
    __tablename__ = "api_keys"

    # Native uuid in prod Postgres (the table is shared with the frontend
    # key-management flow). as_uuid=False keeps ids as str in Python, which
    # the rest of the codebase (jobs.owner_id varchar joins, responses)
    # expects. String(36) here made asyncpg cast $n::VARCHAR against uuid
    # and 500 every DB-key request ("operator does not exist: uuid = varchar").
    id = Column(Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Key identification
    key_hash = Column(String(64), unique=True, nullable=False, index=True)
    key_prefix = Column(String(12), nullable=False)  # First 12 chars for identification
    name = Column(String(100), nullable=False)  # Partner/key name
    description = Column(String(500), nullable=True)  # Optional free-text note

    # Access control
    is_active = Column(Boolean, default=True, nullable=False)
    rate_limit = Column(Integer, default=100)  # Requests per minute
    daily_limit = Column(Integer, default=10000)  # Requests per day
    max_prompts_per_job = Column(Integer, default=1000)  # Max prompts per single job

    # Usage tracking
    total_requests = Column(Integer, default=0)
    total_jobs = Column(Integer, default=0)
    total_prompts = Column(Integer, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # None = never expires

    def __repr__(self):
        return f"<ApiKey(id={self.id}, name={self.name}, active={self.is_active})>"

    @property
    def is_expired(self) -> bool:
        """Check if the key has expired (tz-safe: the column is timestamptz)."""
        if self.expires_at is None:
            return False
        from datetime import timezone
        exp = self.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > exp

    @property
    def is_valid(self) -> bool:
        """Check if the key is valid (active and not expired)."""
        return self.is_active and not self.is_expired

    @classmethod
    def create_key(cls, name: str, **kwargs) -> tuple["ApiKey", str]:
        """
        Create a new API key.
        Returns (ApiKey instance, plain text key).
        The plain text key is only available at creation time.
        """
        plain_key = generate_api_key()
        key_hash = hash_api_key(plain_key)
        key_prefix = plain_key[:12]

        api_key = cls(
            key_hash=key_hash,
            key_prefix=key_prefix,
            name=name,
            **kwargs
        )

        return api_key, plain_key
