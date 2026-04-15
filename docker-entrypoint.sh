#!/bin/bash
set -e

echo "=== LLMI Starting ==="

# Start nginx in background
echo "[1/2] Starting nginx..."
nginx

# Start FastAPI backend
echo "[2/2] Starting backend (uvicorn)..."
cd /app
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers ${UVICORN_WORKERS:-1} \
    --log-level ${LOG_LEVEL:-info} \
    --proxy-headers \
    --forwarded-allow-ips='*'
