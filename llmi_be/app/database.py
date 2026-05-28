from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Build engine with driver-appropriate options
engine_kwargs = {
    "echo": settings.debug,
}

if settings.is_postgres:
    # PostgreSQL with asyncpg via Supabase Supavisor in transaction-mode (port 6543).
    # Transaction mode releases the underlying server connection after each TX,
    # so the client-side pool size is bounded only by Supavisor's max_client_conn
    # (200+ on Pro plan), NOT by direct Postgres connection limits.
    #
    # The previous "max 12, leaves 3 for PostgREST" comment referenced PgBouncer
    # session-mode limits, which Supavisor doesn't share. With 3 concurrent audits,
    # the scheduler, the run-audit endpoint, and background heartbeats all
    # competing, 12 was too tight — we hit QueuePool timeouts during normal load.
    #
    # 15 base + 25 overflow = 40 max. Comfortably under Supavisor's pool budget
    # but enough headroom for 3 concurrent audits × ~10 parallel DB writes each
    # plus endpoint traffic.
    engine_kwargs["pool_size"] = 15
    engine_kwargs["max_overflow"] = 25
    engine_kwargs["pool_timeout"] = 10      # fail fast instead of default 30s hang
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 300     # recycle connections every 5 min
    engine_kwargs["connect_args"] = {"statement_cache_size": 0}
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
