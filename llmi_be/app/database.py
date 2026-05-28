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
    # Sizing: 10 base + 30 overflow = 40 max. Same as v2 — enough for
    # 3 concurrent audits × ~10 parallel DB ops + scheduler + endpoint
    # traffic — without using NullPool's per-session handshake cost.
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 30
    engine_kwargs["pool_timeout"] = 10        # fail fast instead of default 30s hang
    engine_kwargs["pool_pre_ping"] = True     # detect dropped connections before use
    engine_kwargs["pool_recycle"] = 60        # rotate every 60s, beats Supavisor's idle timeout
    engine_kwargs["connect_args"] = {
        "statement_cache_size": 0,
        # Fail fast on the rare case a connection setup hangs. Healthy
        # Supavisor handshake is <500ms; anything beyond 10s is dead.
        "timeout": 10,
        # Cap a single query at 30s to protect against a stalled Supavisor.
        "command_timeout": 30,
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
