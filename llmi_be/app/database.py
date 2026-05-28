from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

# Build engine with driver-appropriate options
engine_kwargs = {
    "echo": settings.debug,
}

if settings.is_postgres:
    # PostgreSQL via Supabase Supavisor in transaction-mode (port 6543).
    #
    # Why NullPool: Supavisor already pools server connections at the pooler
    # layer. Layering SQLAlchemy's QueuePool on top causes a known stale-
    # connection problem — client-side connections sit idle past Supavisor's
    # client_idle_timeout, Supavisor silently drops them, and the next reuse
    # surfaces as `ConnectionDoesNotExistError: connection was closed in the
    # middle of operation`. pool_pre_ping helps but isn't atomic with the
    # subsequent query, so the race still happens under load.
    #
    # With NullPool, each AsyncSessionLocal() call opens a fresh TCP/TLS
    # connection to Supavisor, which is cheap because the heavy Postgres
    # backend connection is already pooled at Supavisor's layer. This is
    # the configuration Supabase officially recommends for transaction-mode
    # pooled access from SQLAlchemy.
    #
    # statement_cache_size=0 stays — required because PgBouncer/Supavisor
    # doesn't preserve prepared statements across transactions.
    engine_kwargs["poolclass"] = NullPool
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
