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


def _split_sql_statements(sql: str) -> list[str]:
    """Split a migration file into individual statements.

    asyncpg uses prepared statements by default, and prepared statements
    cannot contain multiple commands. So we split on `;` at statement
    boundaries. Handles:
      - line comments starting with `--` (anywhere on the line)
      - `$$...$$` dollar-quoted blocks (PL/pgSQL function bodies etc.)
      - single-quoted string literals

    Does NOT handle C-style block comments (/* */). Add if ever needed.
    """
    stmts: list[str] = []
    buf: list[str] = []
    i = 0
    in_single_quote = False
    dollar_tag: str | None = None  # e.g. '' or 'body' for $body$
    n = len(sql)

    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""

        if dollar_tag is not None:
            # Inside a dollar-quoted block — consume until matching $tag$
            end = sql.find(f"${dollar_tag}$", i)
            if end == -1:
                buf.append(sql[i:])
                i = n
            else:
                buf.append(sql[i:end + len(dollar_tag) + 2])
                i = end + len(dollar_tag) + 2
                dollar_tag = None
            continue

        if in_single_quote:
            buf.append(ch)
            i += 1
            if ch == "'":
                # Escaped quote '' stays inside the string
                if nxt == "'":
                    buf.append("'")
                    i += 1
                else:
                    in_single_quote = False
            continue

        # Line comment — skip to newline
        if ch == "-" and nxt == "-":
            newline = sql.find("\n", i)
            if newline == -1:
                i = n
            else:
                i = newline  # keep the \n for readable errors
            continue

        # Start of dollar-quoted block: $tag$
        if ch == "$":
            end = sql.find("$", i + 1)
            if end != -1:
                tag = sql[i + 1:end]
                if tag == "" or tag.replace("_", "").isalnum():
                    dollar_tag = tag
                    buf.append(sql[i:end + 1])
                    i = end + 1
                    continue

        if ch == "'":
            in_single_quote = True
            buf.append(ch)
            i += 1
            continue

        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                stmts.append(stmt)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


async def apply_migration(conn, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    # asyncpg can't put multiple commands in one prepared statement, so we
    # must split the file into individual statements and execute each.
    for stmt in _split_sql_statements(sql):
        await conn.execute(text(stmt))
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
