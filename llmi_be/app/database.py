import asyncio
import logging

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Build engine with driver-appropriate options
engine_kwargs = {
    "echo": settings.debug,
}

if settings.is_postgres:
    # PostgreSQL via Supabase Supavisor in transaction-mode (port 6543).
    #
    # History of this config (read before touching):
    #   v1: pool_size=5, overflow=7  → QueuePool exhaustion under load
    #   v2: pool_size=15, overflow=25 → QueuePool fixed, but stale
    #                                    connections after Supavisor's
    #                                    idle-timeout sweep killed them
    #   v3: NullPool                 → no stale-connection bug BUT every
    #                                    session opened a fresh TCP+TLS
    #                                    handshake → /dashboard took ~1min
    #                                    to list jobs because every small
    #                                    query paid 200ms of TLS overhead
    #
    # Current: QueuePool with **aggressive recycle** to avoid the stale
    # connection problem. With pool_recycle=60, every connection is
    # rotated every 60s — well before Supavisor's client_idle_timeout
    # (typically several minutes) gets a chance to drop it underneath us.
    # The rare race that still leaks through is caught by the
    # _retry_transient helper on SupabaseDB methods + the HTTP middleware
    # on ORM endpoints (commit 535e99a).
    #
    # Sizing rationale (production-observed):
    #   - 3 concurrent audits × ~10 parallel DB ops/each at peak     = 30
    #   - Scheduler tick (auto-fail sweep, dispatch, recover stale)  =  5
    #   - run_audit endpoint                                         =  1
    #   - /dashboard polling + /api/v1/jobs polling                  =  4
    #   - Retry storm multiplier (each transient drop spawns new
    #     session for next attempt; with K concurrent retrying calls
    #     this can double session demand for a few seconds)          = ×2
    #
    # Worst-case peak ≈ 80 sessions. Supavisor Pro supports 200+
    # client connections per project so we have plenty of headroom.
    #
    # Removed pool_pre_ping=True: it adds a SELECT 1 round-trip on
    # every checkout (~10-30ms holding time = ~30% capacity penalty)
    # and the dropped-connection case is already covered by:
    #   - _retry_transient on SupabaseDB methods
    #   - HTTP middleware on ORM endpoints
    # Pre-ping was a belt-and-suspenders that turned out to amplify
    # the pool-exhaustion failure mode.
    engine_kwargs["pool_size"] = 20
    engine_kwargs["max_overflow"] = 60
    engine_kwargs["pool_timeout"] = 10        # fail fast instead of default 30s hang
    # pool_recycle was 60s to dodge a Supavisor drop-storm caused by
    # UVICORN_WORKERS=2 (two workers × their own pool exceeded Supavisor's
    # client budget). With workers=1 that pressure is gone, so we can keep
    # connections warm for 10 minutes — this kills the 1.5s cold-handshake
    # latency that hit /dashboard on every idle return.
    engine_kwargs["pool_recycle"] = 600
    # pool_pre_ping was removed when the pool was exhausting and the extra
    # SELECT 1 hurt capacity. Now that's fixed it's worth keeping again to
    # silently handle the rare case where Supavisor still drops a stale
    # connection. ~5-15ms per checkout, negligible at our load.
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["connect_args"] = {
        "statement_cache_size": 0,
        # Fail fast on the rare case a connection setup hangs. Healthy
        # Supavisor handshake is <500ms; anything beyond 10s is dead.
        "timeout": 10,
        # Cap a single query at 20s (was 10s). A stalled Supavisor that
        # accepts the connection but never responds was holding sessions
        # in the pool for up to 30s × 3 retries = 90s per failed call.
        # Under sustained Supavisor flakiness this accumulated to pool
        # exhaustion within ~12 minutes despite an 80-session budget.
        # The hot path has no analytical workload, so 20s is generous; a
        # connection that does time out is hard-terminated by the
        # handle_error hook below, so the cap no longer costs pool capacity.
        "command_timeout": 20,
    }
else:
    # SQLite with aiosqlite: allow multi-thread access
    engine_kwargs["connect_args"] = {"check_same_thread": False}

async_engine = create_async_engine(settings.database_url, **engine_kwargs)

if settings.is_postgres:
    # Long-running maintenance statements (REFRESH MATERIALIZED VIEW ...) get
    # a pool-less engine of their own. The server-side statement_timeout set
    # per call is the authority there; the client cap sits far above it so
    # the client never cancels a statement that is merely slow.
    _maintenance_kwargs = {
        "echo": settings.debug,
        "poolclass": NullPool,
        "connect_args": {
            **engine_kwargs["connect_args"],
            "command_timeout": 180,
        },
    }
    maintenance_engine = create_async_engine(settings.database_url, **_maintenance_kwargs)
else:
    maintenance_engine = async_engine


def _terminate_on_timeout(context) -> None:
    """Hard-terminate an asyncpg connection whose command timed out.

    On a client-side timeout (and on task cancellation) asyncpg sends a
    CancelRequest and then blocks every later statement on that connection
    until the server acknowledges it. Through Supavisor in transaction mode
    that acknowledgment can never come, and the next statement — including
    the ROLLBACK the pool issues when the session is returned — blocks
    forever. 2026-09-01: 14 sessions plus the scheduler tick hung that way
    for 11 hours while /health kept answering 200. Terminating the socket
    and discarding the connection is the only safe exit.
    """
    exc = context.original_exception
    if not isinstance(exc, (asyncio.TimeoutError, TimeoutError, asyncio.CancelledError)):
        return
    context.is_disconnect = True
    context.invalidate_pool_on_disconnect = False
    try:
        fairy = context.connection.connection if context.connection is not None else None
        dbapi_conn = getattr(fairy, "dbapi_connection", None)
        raw = getattr(dbapi_conn, "_connection", None)
        if raw is not None and not raw.is_closed():
            raw.terminate()
            logger.warning(
                f"[db] terminated connection after {type(exc).__name__} "
                f"on: {str(context.statement)[:120]!r}"
            )
    except Exception as e:  # never let the guard itself break error handling
        logger.warning(f"[db] terminate-on-timeout guard failed: {e}")


if settings.is_postgres:
    event.listen(async_engine.sync_engine, "handle_error", _terminate_on_timeout)
    event.listen(maintenance_engine.sync_engine, "handle_error", _terminate_on_timeout)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Sessions for statements that legitimately run for minutes (see
# maintenance_engine). Not for the request/pipeline hot path.
MaintenanceSessionLocal = async_sessionmaker(
    bind=maintenance_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


async def get_async_session() -> AsyncSession:
    """Dependency for FastAPI routes."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Initialize database tables.

    Skipped for PostgreSQL/Supabase — schema is managed by migrations.
    Only needed for local SQLite development.
    """
    if settings.is_postgres:
        return  # Supabase manages the schema; create_all is a no-op but wastes a connection
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
