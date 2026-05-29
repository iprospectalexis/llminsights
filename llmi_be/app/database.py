from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

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
        # Cap a single query at 10s (was 30s). A stalled Supavisor that
        # accepts the connection but never responds was holding sessions
        # in the pool for up to 30s × 3 retries = 90s per failed call.
        # Under sustained Supavisor flakiness this accumulated to pool
        # exhaustion within ~12 minutes despite an 80-session budget.
        # 10s is plenty for any normal query (we have no analytical
        # workload on the hot path).
        "command_timeout": 10,
    }
else:
    # SQLite with aiosqlite: allow multi-thread access
    engine_kwargs["connect_args"] = {"check_same_thread": False}

async_engine = create_async_engine(settings.database_url, **engine_kwargs)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
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
