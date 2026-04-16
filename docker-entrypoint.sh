#!/bin/bash
set -e

echo "=== LLMI Starting ==="

cd /app

# Apply any pending SQL migrations before serving traffic. Aborts on failure
# so the container restarts rather than running against a stale schema.
# Set SKIP_MIGRATIONS=1 to bypass (emergency only).
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
    echo "[1/3] Skipping migrations (SKIP_MIGRATIONS=1)"
else
    echo "[1/3] Applying pending migrations..."
    python run_migrations.py /app/migrations
fi

echo "[2/3] Starting nginx..."
nginx

echo "[3/3] Starting backend (uvicorn)..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers ${UVICORN_WORKERS:-1} \
    --log-level ${LOG_LEVEL:-info} \
    --proxy-headers \
    --forwarded-allow-ips='*'
