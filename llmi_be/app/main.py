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
from app.services.audit_scheduler import (
    start_scheduler,
    stop_scheduler,
    scheduler_watchdog,
    get_scheduler_health,
    WATCHDOG_STALE_S,
)

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
    if settings.is_postgres and not settings.worker_enabled:
        logger.warning(
            "Audit scheduler DISABLED (WORKER_ENABLED=0) — this instance "
            "serves the API only and will not claim audits or jobs"
        )
    if settings.is_postgres and settings.worker_enabled:
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
        app.state.scheduler_running = True
        logger.info("Audit scheduler started (Supabase PostgreSQL detected)")
        watchdog_task = asyncio.create_task(scheduler_watchdog())

        # Pool monitor — logs a one-line snapshot of pool state every 30s,
        # warns if util stays >75% for 2 minutes, and DUMPS ALL ACTIVE
        # asyncio tasks with their current stack when util hits >=90%
        # (this is how we find which coroutines are leaking sessions —
        # the dump shows exactly which file:line each stuck task is at).
        async def _pool_monitor():
            from app.database import async_engine
            import io
            import traceback
            high_water_streak = 0
            task_dump_done = False
            while True:
                try:
                    p = async_engine.pool
                    size = p.size()
                    checked_out = p.checkedout()
                    overflow = p.overflow()
                    total_max = size + max(0, overflow)
                    util_pct = (checked_out / max(1, total_max)) * 100
                    msg = (
                        f"[db-pool] size={size} checked_out={checked_out} "
                        f"overflow={overflow} util={util_pct:.0f}%"
                    )
                    # Absolute floor as well as the utilisation ratio: with
                    # max_overflow=60 the ratio never crossed 75% while 14
                    # sessions sat wedged for 11 hours (2026-09-01).
                    if util_pct > 75 or checked_out >= 10:
                        high_water_streak += 1
                        logger.warning(
                            f"{msg} HIGH (streak={high_water_streak}, threshold=4)"
                        )
                        if high_water_streak >= 4:
                            logger.error(
                                f"[db-pool] sustained >75% for 2min — likely session leak"
                            )

                        # Once per high-water episode, dump all live asyncio
                        # tasks with their current stack. This is the *only*
                        # reliable way to find what's holding the sessions —
                        # the leaker shows up here with a non-trivial frame
                        # count and we can see exactly where it's stuck.
                        if (util_pct >= 90 or high_water_streak >= 4) and not task_dump_done:
                            task_dump_done = True
                            try:
                                tasks = asyncio.all_tasks()
                                buf = io.StringIO()
                                buf.write(
                                    f"\n[db-pool-dump] {len(tasks)} live "
                                    f"asyncio tasks at util={util_pct:.0f}%:\n"
                                )
                                # Group by coroutine name so the report stays
                                # readable when there are 50+ tasks.
                                from collections import Counter
                                names = Counter()
                                for t in tasks:
                                    try:
                                        names[t.get_coro().__qualname__] += 1
                                    except Exception:
                                        names["<unknown>"] += 1
                                buf.write("=== task counts by coro name ===\n")
                                for name, n in names.most_common(20):
                                    buf.write(f"  {n:>4} × {name}\n")
                                # Then dump the first non-trivial stack of
                                # each unique coro — usually enough to spot
                                # the leak. Cap at 30 frames each.
                                buf.write("\n=== one stack per unique coro ===\n")
                                seen_names: set[str] = set()
                                for t in tasks:
                                    try:
                                        name = t.get_coro().__qualname__
                                    except Exception:
                                        name = "<unknown>"
                                    if name in seen_names or name == "_pool_monitor":
                                        continue
                                    seen_names.add(name)
                                    buf.write(f"\n--- task: {name} ---\n")
                                    try:
                                        stack = t.get_stack(limit=15)
                                        for frame in stack:
                                            buf.write(
                                                f"  {frame.f_code.co_filename}:"
                                                f"{frame.f_lineno} in {frame.f_code.co_name}\n"
                                            )
                                    except Exception as ee:
                                        buf.write(f"  <stack error: {ee}>\n")
                                logger.error(buf.getvalue())
                            except Exception as e:
                                logger.error(f"[db-pool-dump] failed: {e}", exc_info=True)
                    else:
                        high_water_streak = 0
                        task_dump_done = False  # re-arm dump for next episode
                        logger.info(msg)
                except Exception as e:
                    logger.warning(f"[db-pool] monitor error: {e}")
                await asyncio.sleep(30)

        pool_monitor_task = asyncio.create_task(_pool_monitor())
    else:
        # Reachable in two cases: not a Postgres DB, or WORKER_ENABLED=0 (an
        # API-only instance that deliberately does not claim audits/jobs).
        # The old "SQLite mode" wording was wrong for the worker-gate case.
        if settings.is_postgres:
            logger.info(
                "Audit scheduler not started on this instance (WORKER_ENABLED=0) "
                "— serving API only"
            )
        else:
            logger.info("Audit scheduler skipped (non-Postgres DB — no Supabase tables)")
        pool_monitor_task = None
        watchdog_task = None

    yield

    # Stop scheduler
    if watchdog_task:
        watchdog_task.cancel()
    if scheduler_task:
        stop_scheduler()
        scheduler_task.cancel()
    if pool_monitor_task:
        pool_monitor_task.cancel()
    
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
LLM Insights backend — the audit pipeline plus the SERP/LLM collection
gateway behind app.llm-insights.com.

**Two surfaces:**

- **Audits** (`/api/v1/audits/*`) — trigger and drive brand-visibility
  audits: a tick-based pipeline (fetching → polling → extracting_competitors
  → analyzing_sentiment → finalizing → completed) over ChatGPT/SearchGPT,
  Perplexity, Gemini, Google AI Overview/Mode, Bing Copilot and Grok, with
  provider fallback (BrightData / DataForSEO / OneSearch SERP).
- **Jobs** (`/api/v1/jobs/*`) — the partner-facing SERP/LLM collection
  gateway: submit prompt batches, poll status, download merged/converted
  results. Protected by `X-API-Key`.

**Runtime:** FastAPI + asyncpg against Supabase Postgres, deployed in Docker.
`WORKER_ENABLED` gates whether an instance runs the scheduler (claims audits
and jobs) or serves the API only.
    """,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# CORS middleware. Auth is a header (X-API-Key), not a cookie, so we do not
# need credentialed CORS — and `allow_origins=["*"]` together with
# `allow_credentials=True` is spec-invalid (Starlette then reflects any Origin
# while sending Allow-Credentials: true). Drop credentials to keep the
# wildcard honest.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Supavisor transient-drop retry middleware ─────────────────────────
# Background: Supavisor (Supabase's transaction-mode pooler) periodically
# drops client-side connections silently. With NullPool we open a fresh
# connection per session, but Supavisor can kill it between connect and
# _start_transaction → asyncpg.ConnectionDoesNotExistError → SQLAlchemy
# DBAPIError → 500 to the user.
#
# The SupabaseDB class is already wrapped with _retry_transient. This
# middleware catches the SAME class of error for endpoints that talk to
# the DB via ORM sessions (Depends(get_db)) — primarily the OneSearch
# /api/v1/jobs* surface and the /dashboard UI which polls it.
#
# Safety: we only retry when the error message matches a transient-drop
# token AND only up to 2 extra attempts. For mutating methods this is
# safe in practice because the drop happens at `_start_transaction` —
# the transaction never began, so no write has been committed.
@app.middleware("http")
async def retry_transient_db_drops(request, call_next):
    from sqlalchemy.exc import DBAPIError, OperationalError

    _TRANSIENT_TOKENS = (
        "connectiondoesnotexisterror",
        "connection was closed",
        "server closed the connection",
        "ssl connection has been closed",
        "connection reset",
        "connection refused",
    )

    def _is_transient(e: BaseException) -> bool:
        msg = str(e).lower()
        return any(tok in msg for tok in _TRANSIENT_TOKENS)

    attempts = 3
    last_exc: BaseException | None = None
    for i in range(attempts):
        try:
            return await call_next(request)
        except (DBAPIError, OperationalError) as e:
            if not _is_transient(e):
                raise
            last_exc = e
            if i == attempts - 1:
                break
            backoff = 0.2 if i == 0 else 0.5
            logger.warning(
                f"[http-retry] {request.method} {request.url.path} hit "
                f"transient DB drop (attempt {i + 1}/{attempts}, sleeping {backoff}s): "
                f"{type(e).__name__}"
            )
            await asyncio.sleep(backoff)
    # Exhausted — surface a clean 503 instead of a raw stack trace.
    logger.error(
        f"[http-retry] {request.method} {request.url.path} exhausted "
        f"{attempts} attempts: {type(last_exc).__name__}: {str(last_exc)[:200]}"
    )
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database temporarily unavailable (Supavisor connection drop). "
                      "Please retry in a moment.",
            "error_type": type(last_exc).__name__ if last_exc else "Unknown",
        },
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
    db_ok = db_status == "healthy"
    scheduler_running = bool(getattr(app.state, "scheduler_running", False))

    # A scheduler that stopped ticking is an outage for every audit, even
    # though the API keeps answering. The static `scheduler_running` flag
    # hid exactly that on 2026-09-01; report real liveness instead.
    scheduler_info = None
    scheduler_ok = True
    if scheduler_running:
        scheduler_info = get_scheduler_health()
        stale = scheduler_info.get("stale_seconds")
        scheduler_ok = bool(scheduler_info.get("alive")) and (
            stale is None or stale <= WATCHDOG_STALE_S
        )

    overall = "healthy" if (db_ok and scheduler_ok) else "unhealthy"
    body = HealthResponse(
        status=overall,
        version=settings.app_version,
        database=db_status,
        active_jobs=active_jobs,
        worker_enabled=settings.worker_enabled,
        scheduler_running=scheduler_running and scheduler_ok,
        scheduler=scheduler_info,
    )
    # Return 503 when the DB is unreachable or the scheduler loop is stale,
    # so uptime monitors, load balancers and Docker healthchecks (which key
    # on the status CODE, not the JSON body) actually see the instance as
    # down.
    return JSONResponse(
        status_code=status.HTTP_200_OK if overall == "healthy" else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=body.model_dump(),
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
    """API root endpoint — surface map and doc links."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "health": "/health",
        "surfaces": {
            "audits": "/api/v1/audits",
            "jobs": "/api/v1/jobs",
            "api_keys": "/api/v1/api-keys",
            "serp": "/api/v1/serp",
        },
    }


# Include API router
app.include_router(api_router, prefix="/api/v1")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
