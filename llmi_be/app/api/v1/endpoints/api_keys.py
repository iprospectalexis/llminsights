from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta
from typing import Optional

from app.api.deps import get_db, verify_admin_key
from app.models import ApiKey
from app.schemas import (
    ApiKeyCreate,
    ApiKeyResponse,
    ApiKeyCreateResponse,
    ApiKeyListResponse,
    ApiKeyUsageResponse,
)

router = APIRouter()


@router.post(
    "",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new API key",
)
async def create_api_key(
    key_data: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Create a new API key for a partner.
    Requires admin authentication.

    **Important**: The API key is only shown once in this response.
    Store it securely!
    """
    # Calculate expiration date if specified
    expires_at = None
    if key_data.expires_in_days:
        expires_at = datetime.utcnow() + timedelta(days=key_data.expires_in_days)

    # Create the API key
    api_key, plain_key = ApiKey.create_key(
        name=key_data.name,
        description=key_data.description,
        rate_limit=key_data.rate_limit,
        daily_limit=key_data.daily_limit,
        max_prompts_per_job=key_data.max_prompts_per_job,
        expires_at=expires_at,
    )

    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return ApiKeyCreateResponse(
        id=api_key.id,
        key=plain_key,
        key_prefix=api_key.key_prefix,
        name=api_key.name,
        description=api_key.description,
        rate_limit=api_key.rate_limit,
        daily_limit=api_key.daily_limit,
        max_prompts_per_job=api_key.max_prompts_per_job,
        created_at=api_key.created_at,
        expires_at=api_key.expires_at,
    )


@router.get(
    "",
    response_model=ApiKeyListResponse,
    summary="List all API keys",
)
async def list_api_keys(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    active_only: bool = Query(False, description="Only show active keys"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    List all API keys.
    Requires admin authentication.
    """
    query = select(ApiKey)
    count_query = select(func.count(ApiKey.id))

    if active_only:
        query = query.filter(ApiKey.is_active == True)
        count_query = count_query.filter(ApiKey.is_active == True)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Get paginated results
    offset = (page - 1) * per_page
    query = query.order_by(ApiKey.created_at.desc()).offset(offset).limit(per_page)

    result = await db.execute(query)
    keys = result.scalars().all()

    return ApiKeyListResponse(
        keys=[ApiKeyResponse.model_validate(k) for k in keys],
        total=total,
    )


@router.get(
    "/{key_id}",
    response_model=ApiKeyResponse,
    summary="Get API key details",
)
async def get_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Get details for a specific API key.
    Requires admin authentication.
    """
    result = await db.execute(select(ApiKey).filter(ApiKey.id == key_id))
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"API key {key_id} not found",
        )

    return ApiKeyResponse.model_validate(api_key)


@router.get(
    "/{key_id}/usage",
    response_model=ApiKeyUsageResponse,
    summary="Get API key usage statistics",
)
async def get_api_key_usage(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Get usage statistics for a specific API key.
    Requires admin authentication.
    """
    result = await db.execute(select(ApiKey).filter(ApiKey.id == key_id))
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"API key {key_id} not found",
        )

    # TODO: Calculate today's usage from a separate usage log table
    # For now, return total stats
    return ApiKeyUsageResponse(
        id=api_key.id,
        name=api_key.name,
        total_requests=api_key.total_requests,
        total_jobs=api_key.total_jobs,
        total_prompts=api_key.total_prompts,
        last_used_at=api_key.last_used_at,
        created_at=api_key.created_at,
        requests_today=0,  # TODO: Implement daily tracking
        jobs_today=0,
        prompts_today=0,
    )


@router.patch(
    "/{key_id}",
    response_model=ApiKeyResponse,
    summary="Update API key",
)
async def update_api_key(
    key_id: str,
    name: Optional[str] = Query(None, max_length=100),
    description: Optional[str] = Query(None, max_length=500),
    rate_limit: Optional[int] = Query(None, ge=1, le=1000),
    daily_limit: Optional[int] = Query(None, ge=100, le=100000),
    max_prompts_per_job: Optional[int] = Query(None, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Update an API key's settings.
    Requires admin authentication.
    """
    result = await db.execute(select(ApiKey).filter(ApiKey.id == key_id))
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"API key {key_id} not found",
        )

    # Update fields if provided
    if name is not None:
        api_key.name = name
    if description is not None:
        api_key.description = description
    if rate_limit is not None:
        api_key.rate_limit = rate_limit
    if daily_limit is not None:
        api_key.daily_limit = daily_limit
    if max_prompts_per_job is not None:
        api_key.max_prompts_per_job = max_prompts_per_job

    await db.commit()
    await db.refresh(api_key)

    return ApiKeyResponse.model_validate(api_key)


@router.post(
    "/{key_id}/deactivate",
    response_model=ApiKeyResponse,
    summary="Deactivate an API key",
)
async def deactivate_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Deactivate an API key (revoke access).
    Requires admin authentication.
    """
    result = await db.execute(select(ApiKey).filter(ApiKey.id == key_id))
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"API key {key_id} not found",
        )

    api_key.is_active = False
    await db.commit()
    await db.refresh(api_key)

    return ApiKeyResponse.model_validate(api_key)


@router.post(
    "/{key_id}/activate",
    response_model=ApiKeyResponse,
    summary="Reactivate an API key",
)
async def activate_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Reactivate a deactivated API key.
    Requires admin authentication.
    """
    result = await db.execute(select(ApiKey).filter(ApiKey.id == key_id))
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"API key {key_id} not found",
        )

    api_key.is_active = True
    await db.commit()
    await db.refresh(api_key)

    return ApiKeyResponse.model_validate(api_key)


@router.delete(
    "/{key_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete an API key",
)
async def delete_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_admin_key),
):
    """
    Permanently delete an API key.
    Requires admin authentication.

    **Warning**: This action cannot be undone. Consider deactivating instead.
    """
    result = await db.execute(select(ApiKey).filter(ApiKey.id == key_id))
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"API key {key_id} not found",
        )

    await db.delete(api_key)
    await db.commit()

    return {
        "message": f"API key {key_id} deleted",
        "key_id": key_id,
        "name": api_key.name,
    }
