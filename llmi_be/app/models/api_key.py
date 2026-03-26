import uuid
import secrets
import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Integer, DateTime, Boolean
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

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Key identification
    key_hash = Column(String(64), unique=True, nullable=False, index=True)
    key_prefix = Column(String(12), nullable=False)  # First 12 chars for identification
    name = Column(String(100), nullable=False)  # Partner/key name

    # Access control
    is_active = Column(Boolean, default=True, nullable=False)
    rate_limit = Column(Integer, default=100)  # Requests per minute
    daily_limit = Column(Integer, default=10000)  # Requests per day
    max_prompts_per_job = Column(Integer, default=1000)  # Max prompts per single job

    # Usage tracking
    total_requests = Column(Integer, default=0)
    total_jobs = Column(Integer, default=0)
    total_prompts = Column(Integer, default=0)
    last_used_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)  # None = never expires

    def __repr__(self):
        return f"<ApiKey(id={self.id}, name={self.name}, active={self.is_active})>"

    @property
    def is_expired(self) -> bool:
        """Check if the key has expired."""
        if self.expires_at is None:
            return False
        return datetime.utcnow() > self.expires_at

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
