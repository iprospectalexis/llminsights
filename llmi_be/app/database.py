from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Build engine with driver-appropriate options
engine_kwargs = {
    "echo": settings.debug,
}

if settings.is_postgres:
    # PostgreSQL with asyncpg via Supabase transaction-mode pooler (port 6543).
    # Transaction mode returns connections after each TX, allowing ~200 concurrent
    # clients vs ~15 in session mode. Requires statement_cache_size=0 because
    # PgBouncer doesn't support prepared statements.
    engine_kwargs["pool_size"] = 3
    engine_kwargs["max_overflow"] = 5       # max 8 conn/worker × 2 workers = 16
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
