import asyncio
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.database import init_db, async_engine
from app.config import get_settings
from app.schemas import HealthResponse
from app.services.job_processor import job_processor
from app.services.audit_scheduler import start_scheduler, stop_scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting SERP SaaS API (Lite)...")
    
    # Initialize database tables
    await init_db()
    logger.info("Database initialized")

    # Start audit scheduler if connected to PostgreSQL (Supabase)
    scheduler_task = None
    if settings.is_postgres:
        # Self-test of polling SQL helpers BEFORE the scheduler starts.
        # If any of these crash on the driver level (e.g. the
        # `CAST(:ids AS uuid[])` bug from 2026-04-08, where every tick
        # silently failed inside `mark_polling_terminal` and stuck a live
        # audit for 40 minutes), we want to know on the first deploy line
        # in the container log — not after a customer reports a stuck
        # modal. The dummy UUID matches no rows so the calls are no-ops
        # in terms of side effects.
        from app.services.supabase_db import db
        DUMMY = "00000000-0000-0000-0000-000000000000"
        try:
            await db.get_polling_status(DUMMY)
            await db.get_active_pending_responses(DUMMY, min_interval_seconds=0, limit=1)
            await db.mark_polling_attempt([])
            await db.mark_polling_terminal([], "smoke")
            logger.info("[startup] polling helpers self-test OK")
        except Exception as e:
            logger.error(
                f"[startup] polling helpers self-test FAILED: {e}",
                exc_info=True,
            )

        scheduler_task = asyncio.create_task(start_scheduler())
        logger.info("Audit scheduler started (Supabase PostgreSQL detected)")
    else:
        logger.info("Audit scheduler skipped (SQLite mode — no Supabase tables)")

    yield

    # Stop scheduler
    if scheduler_task:
        stop_scheduler()
        scheduler_task.cancel()
    
    # Shutdown
    logger.info("Shutting down SERP SaaS API...")

    # Cancel all active jobs
    for job_id in list(job_processor.active_jobs.keys()):
        await job_processor.cancel_job(job_id)


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
## SERP Batch Processing API (Lite)

Lightweight version without Docker/Celery/Redis.
Uses SQLite and FastAPI background tasks.

### Features:
- **Batch Processing**: Submit up to 1000 prompts per job
- **Async Processing**: Jobs run in background asyncio tasks
- **Progress Tracking**: Monitor job progress in real-time
- **Webhook Notifications**: Get notified when jobs complete
- **Retry Logic**: Automatic retries for failed queries

### Quick Start:
```bash
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your SERP_API_KEY
uvicorn app.main:app --reload
```
    """,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        field = " -> ".join(str(loc) for loc in error["loc"])
        errors.append(f"{field}: {error['msg']}")
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error", "errors": errors},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error: {exc}")
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Health check",
)
async def health_check():
    """Check API health status."""
    from sqlalchemy import text
    
    db_status = "healthy"
    try:
        async with async_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"
    
    active_jobs = len(job_processor.get_active_job_ids())
    overall = "healthy" if db_status == "healthy" else "degraded"
    
    return HealthResponse(
        status=overall,
        version=settings.app_version,
        database=db_status,
        active_jobs=active_jobs,
    )


@app.get("/", tags=["Root"])
async def root():
    """Redirect to dashboard."""
    return FileResponse(Path(__file__).parent.parent / "static" / "index.html")


@app.get("/dashboard", tags=["Root"])
async def dashboard():
    """Serve dashboard UI."""
    return FileResponse(Path(__file__).parent.parent / "static" / "index.html")


@app.get("/api", tags=["Root"])
async def api_info():
    """API root endpoint."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "health": "/health",
        "dashboard": "/dashboard",
    }


# Include API router
app.include_router(api_router, prefix="/api/v1")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
