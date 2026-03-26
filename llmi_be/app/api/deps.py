from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime

from app.database import get_async_session
from app.config import get_settings
from app.models import ApiKey, hash_api_key

settings = get_settings()

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def get_db() -> AsyncSession:
    """Dependency for getting async database session."""
    async for session in get_async_session():
        yield session


async def verify_api_key(
    api_key: Optional[str] = Security(api_key_header),
    db: AsyncSession = Depends(get_db),
) -> Optional[ApiKey]:
    """
    Dependency for API key verification.
    Returns ApiKey object if valid, None if no auth required.
    """
    # If no API key provided
    if not api_key:
        # Check if legacy single API key is configured
        if settings.api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing API key",
                headers={"WWW-Authenticate": "ApiKey"},
            )
        # No auth required
        return None

    # Check legacy single API key first (for backwards compatibility)
    if settings.api_key and api_key == settings.api_key:
        return None  # Legacy auth, no ApiKey object

    # Look up API key in database
    key_hash = hash_api_key(api_key)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == key_hash)
    )
    api_key_obj = result.scalar_one_or_none()

    if not api_key_obj:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )

    if not api_key_obj.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key is deactivated",
        )

    if api_key_obj.is_expired:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key has expired",
        )

    # Update usage statistics
    api_key_obj.total_requests += 1
    api_key_obj.last_used_at = datetime.utcnow()
    await db.commit()

    return api_key_obj


async def get_current_api_key(
    api_key: Optional[ApiKey] = Depends(verify_api_key),
) -> Optional[ApiKey]:
    """
    Get the current API key object.
    This is a convenience dependency for endpoints that need the ApiKey object.
    """
    return api_key


async def verify_admin_key(
    api_key: Optional[str] = Security(api_key_header),
) -> str:
    """
    Dependency for admin API key verification.
    Only the master API key from settings can access admin endpoints.
    """
    if not settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access requires API_KEY to be configured in settings",
        )

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    if api_key != settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin API key",
        )

    return api_key
