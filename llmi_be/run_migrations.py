"""
Apply pending SQL migrations from /app/migrations/ on container startup.

Tracks applied migrations in a `_schema_migrations` table (filename + applied_at).
Idempotent: already-applied migrations are skipped. Migrations run in
lexicographic filename order, so use timestamped prefixes (YYYYMMDDhhmmss_*).

Failure behavior: if any migration fails, the whole startup aborts with a
non-zero exit code. docker-entrypoint.sh won't start uvicorn, so the
container restarts rather than serving traffic against a stale schema.

Usage (called from docker-entrypoint.sh):
    python run_migrations.py /app/migrations
"""
import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy import text

from app.database import async_engine


MIGRATIONS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS _schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    checksum   text
)
"""


async def list_applied(conn) -> set[str]:
    rows = (await conn.execute(
        text("SELECT filename FROM _schema_migrations")
    )).scalars().all()
    return set(rows)


async def apply_migration(conn, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    # Execute the file as one script — statements separated by semicolons are
    # handled by the driver. Most migrations are a handful of DDL statements.
    await conn.execute(text(sql))
    await conn.execute(
        text("INSERT INTO _schema_migrations (filename) VALUES (:f)"),
        {"f": path.name},
    )


async def is_existing_db(conn) -> bool:
    """True if this DB already has business schema (audits table exists).

    Used on first run to decide whether pending migrations should be executed
    or just marked as already-applied. Production DBs created before this
    runner existed should be baselined, not re-migrated.
    """
    row = (await conn.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'audits'
        )
    """))).scalar()
    return bool(row)


# Migration filenames that MUST run even on an existing DB (emergency hotfixes
# added after the runner was introduced). List the filenames here if you want
# them to bypass the baseline skip.
FORCE_APPLY = {
    "20260416140000_brand_kind_allow_sentinels.sql",
    "20260416140100_audit_zombie_detection.sql",
}


async def main(migrations_dir: str) -> int:
    root = Path(migrations_dir)
    if not root.is_dir():
        print(f"[migrations] directory not found: {root} — skipping")
        return 0

    files = sorted(root.glob("*.sql"))
    if not files:
        print(f"[migrations] no .sql files in {root}")
        return 0

    try:
        async with async_engine.begin() as conn:
            # Check whether this is a mid-life DB BEFORE creating the tracking
            # table. Otherwise the tracking table creation itself would count.
            existing = await is_existing_db(conn)
            tracking_exists = (await conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = '_schema_migrations'
                )
            """))).scalar()
            await conn.execute(text(MIGRATIONS_TABLE_DDL))
            applied = await list_applied(conn)
    except Exception as e:
        print(f"[migrations] failed to connect or init tracking table: {e}")
        return 1

    # First-run baseline: DB was created before this runner existed.
    # Mark every migration as applied WITHOUT executing it, except any in
    # FORCE_APPLY (emergency hotfixes that must still run).
    if existing and not tracking_exists and not applied:
        to_baseline = [f.name for f in files if f.name not in FORCE_APPLY]
        if to_baseline:
            print(f"[migrations] first run on existing DB — baselining {len(to_baseline)} migration(s)")
            async with async_engine.begin() as conn:
                for name in to_baseline:
                    await conn.execute(
                        text("INSERT INTO _schema_migrations (filename) VALUES (:f) "
                             "ON CONFLICT DO NOTHING"),
                        {"f": name},
                    )
            applied = set(to_baseline)

    pending = [f for f in files if f.name not in applied]
    if not pending:
        print(f"[migrations] up-to-date ({len(applied)} applied)")
        return 0

    print(f"[migrations] applying {len(pending)} migration(s)...")
    for f in pending:
        print(f"[migrations] → {f.name}")
        try:
            async with async_engine.begin() as conn:
                await apply_migration(conn, f)
        except Exception as e:
            print(f"[migrations] FAILED on {f.name}: {e}")
            return 1
    print(f"[migrations] done ({len(pending)} applied)")
    return 0


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "/app/migrations"
    sys.exit(asyncio.run(main(path)))
