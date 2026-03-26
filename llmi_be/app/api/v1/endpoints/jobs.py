from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from typing import Optional
from pathlib import Path
import math
import json

from app.api.deps import get_db, verify_api_key
from app.models import Job, JobStatus, Provider, ApiKey
from app.schemas import (
    JobCreate,
    JobResponse,
    JobCreateResponse,
    JobListResponse,
    JobStatusEnum,
    ProviderEnum,
)
from app.services.job_processor import job_processor
from app.config import get_settings

router = APIRouter()
settings = get_settings()


def build_job_response(job: Job, base_url: str) -> JobResponse:
    """Build JobResponse with download URLs."""
    response = JobResponse.model_validate(job)

    # Construct download URLs if files exist
    if job.merged_results_file:
        response.download_url = f"{base_url}/jobs/{job.id}/download"

    if job.converted_results_file:
        response.converted_download_url = f"{base_url}/jobs/{job.id}/download/converted"

    return response


def get_owner_filter(api_key: Optional[ApiKey]):
    """Get filter for owner-based job access."""
    if api_key is None:
        # No API key = admin/legacy access, can see all jobs
        return None
    # Partner can only see their own jobs
    return Job.owner_id == api_key.id


async def verify_job_access(job: Job, api_key: Optional[ApiKey]) -> bool:
    """Verify the API key has access to this job."""
    if api_key is None:
        # Admin/legacy access
        return True
    # Check if job belongs to this API key
    return job.owner_id == api_key.id or job.owner_id is None


@router.post(
    "",
    response_model=JobCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new job",
)
async def create_job(
    job_data: JobCreate,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Create a new batch processing job."""

    # Check prompts limit (use API key limit if available)
    max_prompts = settings.max_prompts_per_job
    if api_key and api_key.max_prompts_per_job:
        max_prompts = api_key.max_prompts_per_job

    if len(job_data.prompts) > max_prompts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {max_prompts} prompts allowed per job",
        )

    # Select batch size based on provider
    is_brightdata = job_data.provider == ProviderEnum.BRIGHTDATA
    batch_size = settings.brightdata_batch_size if is_brightdata else settings.batch_size
    estimated_batches = math.ceil(len(job_data.prompts) / batch_size)

    # Create job record with owner
    job = Job(
        owner_id=api_key.id if api_key else None,
        prompts=job_data.prompts,
        geo_targeting=job_data.geo_targeting,
        source=job_data.source,
        provider=job_data.provider.value,
        web_search=job_data.web_search,
        webhook_url=job_data.webhook_url,
        status=JobStatus.PENDING.value,
        total_prompts=len(job_data.prompts),
        processed_prompts=0,
        failed_prompts=0,
        progress=0,
    )

    # Log prompts for debugging
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Creating job with {len(job_data.prompts)} prompts")
    logger.debug(f"First 3 prompts: {job_data.prompts[:3]}")
    logger.debug(f"All prompts unique: {len(set(job_data.prompts)) == len(job_data.prompts)}")

    db.add(job)

    # Update API key usage statistics
    if api_key:
        api_key.total_jobs += 1
        api_key.total_prompts += len(job_data.prompts)

    await db.commit()
    await db.refresh(job)

    # Start background processing
    await job_processor.start_job(job.id)

    return JobCreateResponse(
        id=job.id,
        status=JobStatusEnum.PENDING,
        provider=job_data.provider.value,
        message=f"Job queued for processing via {job_data.provider.value}",
        total_prompts=len(job_data.prompts),
        estimated_batches=estimated_batches,
    )


@router.get(
    "",
    response_model=JobListResponse,
    summary="List jobs",
)
async def list_jobs(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[JobStatusEnum] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """
    List jobs with pagination.
    Partners can only see their own jobs.
    """

    query = select(Job)
    count_query = select(func.count(Job.id))

    # Apply owner filter for partner isolation
    owner_filter = get_owner_filter(api_key)
    if owner_filter is not None:
        query = query.filter(owner_filter)
        count_query = count_query.filter(owner_filter)

    if status_filter:
        query = query.filter(Job.status == status_filter.value)
        count_query = count_query.filter(Job.status == status_filter.value)

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    offset = (page - 1) * per_page
    query = query.order_by(desc(Job.created_at)).offset(offset).limit(per_page)

    result = await db.execute(query)
    jobs = result.scalars().all()

    pages = math.ceil(total / per_page) if total > 0 else 1

    # Build base URL for download links
    base_url = str(request.base_url).rstrip('/') + "/api/v1"

    return JobListResponse(
        jobs=[build_job_response(j, base_url) for j in jobs],
        total=total,
        page=page,
        per_page=per_page,
        pages=pages,
    )


@router.get(
    "/{job_id}",
    response_model=JobResponse,
    summary="Get job details",
)
async def get_job(
    job_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Get job details by ID."""

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    # Build base URL for download links
    base_url = str(request.base_url).rstrip('/') + "/api/v1"

    return build_job_response(job, base_url)


@router.delete(
    "/{job_id}",
    status_code=status.HTTP_200_OK,
    summary="Cancel a job",
)
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Cancel a pending or running job."""

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    if job.status not in [JobStatus.PENDING.value, JobStatus.PROCESSING.value]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel job in {job.status} status",
        )

    # Cancel the background task
    cancelled = await job_processor.cancel_job(job_id)

    if not cancelled:
        # Update status directly if task not found
        job.status = JobStatus.CANCELLED.value
        await db.commit()

    return {
        "message": f"Job {job_id} cancellation requested",
        "job_id": job_id,
    }


@router.post(
    "/{job_id}/retry",
    response_model=JobResponse,
    summary="Retry a failed job",
)
async def retry_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Retry a failed job with remaining failed queries."""

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    if job.status != JobStatus.FAILED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed jobs can be retried",
        )

    if not job.failed_queries:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No failed queries to retry",
        )

    # Create new job with failed queries (preserve owner)
    new_job = Job(
        owner_id=job.owner_id,
        prompts=job.failed_queries,
        geo_targeting=job.geo_targeting,
        source=job.source,
        provider=job.provider,
        webhook_url=job.webhook_url,
        status=JobStatus.PENDING.value,
        total_prompts=len(job.failed_queries),
        processed_prompts=0,
        failed_prompts=0,
        progress=0,
    )

    db.add(new_job)

    # Update API key usage statistics
    if api_key:
        api_key.total_jobs += 1
        api_key.total_prompts += len(job.failed_queries)

    await db.commit()
    await db.refresh(new_job)

    # Start processing
    await job_processor.start_job(new_job.id)

    return JobResponse.model_validate(new_job)


@router.post(
    "/{job_id}/reconvert",
    response_model=JobResponse,
    summary="Re-convert job results",
)
async def reconvert_job(
    job_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Re-run the JSON conversion for a completed job."""
    from app.services.json_converter import json_converter

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    if not job.merged_results_file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No merged results file to convert",
        )

    # Re-run conversion
    try:
        converted_path, converted_count = json_converter.convert_file(job.merged_results_file)
        job.converted_results_file = converted_path
        await db.commit()
        await db.refresh(job)

        # Build base URL for download links
        base_url = str(request.base_url).rstrip('/') + "/api/v1"
        return build_job_response(job, base_url)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Conversion failed: {str(e)}",
        )


@router.get(
    "/{job_id}/results",
    summary="Get job results as JSON",
)
async def get_results_json(
    job_id: str,
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(100, ge=1, le=500, description="Results per page"),
    format: str = Query("raw", description="Format: 'raw' or 'converted'"),
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """
    Get job results directly as JSON response.
    Supports pagination for large result sets.

    - **format=raw**: Returns original/merged results
    - **format=converted**: Returns converted results (if available)
    """

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    if job.status != JobStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job is not completed (status: {job.status})",
        )

    # Determine which file to read
    if format == "converted":
        file_path = job.converted_results_file
        if not file_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No converted results available for this job",
            )
    else:
        file_path = job.merged_results_file
        if not file_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No results available for this job",
            )

    path = Path(file_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Results file not found on disk",
        )

    # Read and parse JSON
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse results file",
        )

    # Handle pagination
    if isinstance(data, list):
        total_items = len(data)
        total_pages = math.ceil(total_items / per_page) if total_items > 0 else 1
        start_idx = (page - 1) * per_page
        end_idx = start_idx + per_page
        paginated_data = data[start_idx:end_idx]

        return JSONResponse({
            "job_id": job_id,
            "status": job.status,
            "format": format,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total_items": total_items,
                "total_pages": total_pages,
            },
            "results": paginated_data,
        })
    else:
        # If data is not a list, return as-is
        return JSONResponse({
            "job_id": job_id,
            "status": job.status,
            "format": format,
            "results": data,
        })


@router.get(
    "/{job_id}/download",
    summary="Download merged results",
    response_class=FileResponse,
)
async def download_results(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Download the merged JSON results file for a completed job."""

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    if not job.merged_results_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No merged results available for this job",
        )

    file_path = Path(job.merged_results_file)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Results file not found on disk",
        )

    return FileResponse(
        path=file_path,
        filename=f"results_{job_id[:8]}.json",
        media_type="application/json",
    )


@router.get(
    "/{job_id}/download/converted",
    summary="Download converted results",
    response_class=FileResponse,
)
async def download_converted_results(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key),
):
    """Download the converted JSON results file for a completed job."""

    result = await db.execute(select(Job).filter(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    # Verify access
    if not await verify_job_access(job, api_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this job",
        )

    if not job.converted_results_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No converted results available for this job",
        )

    file_path = Path(job.converted_results_file)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Converted results file not found on disk",
        )

    return FileResponse(
        path=file_path,
        filename=f"results_{job_id[:8]}_converted.json",
        media_type="application/json",
    )
