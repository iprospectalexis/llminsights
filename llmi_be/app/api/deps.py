from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime

from app.database import get_async_session
from app.config import get_settings
from app.models import ApiKey, hash_api_key

import logging

logger = logging.getLogger(__name__)

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


# ── Audits surface authentication ────────────────────────────────────────────
#
# The audits endpoints are called by the browser, which has no API key — it
# has the user's Supabase session. Rather than adding a JWT secret to this
# service, we ask Supabase Auth who a bearer token belongs to (`GET
# /auth/v1/user`). The project URL and anon key are already in the container's
# environment for the frontend build, so this needs no new secret.
#
# Positive results are cached briefly so a burst of polling requests during a
# running audit costs one introspection call, not one per request.

import hashlib
import time as _time

import httpx
from fastapi import Header

_TOKEN_CACHE: dict[str, tuple[float, str]] = {}   # sha256(token) -> (expires_at, user_id)
_TOKEN_CACHE_TTL = 60.0                            # seconds
_TOKEN_CACHE_MAX = 512


def _cache_get(key: str) -> Optional[str]:
    hit = _TOKEN_CACHE.get(key)
    if not hit:
        return None
    expires_at, user_id = hit
    if expires_at < _time.monotonic():
        _TOKEN_CACHE.pop(key, None)
        return None
    return user_id


def _cache_put(key: str, user_id: str) -> None:
    if len(_TOKEN_CACHE) >= _TOKEN_CACHE_MAX:
        # Cheap eviction: drop everything already expired, then the oldest.
        now = _time.monotonic()
        for k in [k for k, (exp, _) in _TOKEN_CACHE.items() if exp < now]:
            _TOKEN_CACHE.pop(k, None)
        if len(_TOKEN_CACHE) >= _TOKEN_CACHE_MAX:
            _TOKEN_CACHE.pop(next(iter(_TOKEN_CACHE)), None)
    _TOKEN_CACHE[key] = (_time.monotonic() + _TOKEN_CACHE_TTL, user_id)


async def _introspect_supabase_token(token: str) -> Optional[str]:
    """Return the Supabase user id for a valid access token, else None."""
    base = settings.supabase_auth_base
    anon = settings.supabase_auth_key
    if not base or not anon:
        logger.error(
            "[auth] Supabase URL/anon key not configured — cannot validate "
            "user sessions on the audits surface"
        )
        return None

    key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    cached = _cache_get(key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                f"{base}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": anon},
            )
    except Exception as e:
        logger.warning(f"[auth] Supabase introspection failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )

    if resp.status_code != 200:
        return None

    user_id = (resp.json() or {}).get("id")
    if not user_id:
        return None
    _cache_put(key, user_id)
    return user_id


async def verify_audit_access(
    authorization: Optional[str] = Header(default=None),
    api_key: Optional[str] = Security(api_key_header),
) -> Optional[str]:
    """Guard for /api/v1/audits/*.

    Accepts EITHER a signed-in Supabase user (browser: `Authorization: Bearer
    <access_token>`) OR the master API key (ops scripts, monitoring). Without
    it, `POST /audits/run` would let anyone spend provider credits.

    Returns the caller's identity ("user:<uuid>" or "apikey") for logging.
    """
    if not settings.audits_auth_required:
        return "auth-disabled"

    # Ops / automation path.
    if api_key and settings.api_key and api_key == settings.api_key:
        return "apikey"

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    user_id = await _introspect_supabase_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return f"user:{user_id}"
