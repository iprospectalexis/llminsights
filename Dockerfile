# =============================================================================
# Multi-stage Dockerfile for LLMI
# Stage 1: Build frontend (Vite/React)
# Stage 2: Production image (Python/FastAPI + nginx)
# =============================================================================

# --------------- Stage 1: Frontend Build ---------------
FROM node:20-alpine AS frontend-build

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy frontend source
COPY index.html vite.config.ts tsconfig*.json tailwind.config.js postcss.config.js ./
COPY src/ ./src/
COPY public/ ./public/

# Build-time env vars (injected via --build-arg or .env.production)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BACKEND_URL=/api
ARG VITE_BRIGHTDATA_API_URL=https://api.brightdata.com
ARG VITE_OPENAI_API_URL=https://api.openai.com/v1

RUN npm run build

# --------------- Stage 2: Production ---------------
FROM python:3.11-slim

# Install nginx
RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY llmi_be/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY llmi_be/ ./

# Copy built frontend into nginx serving directory
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Create directories
RUN mkdir -p /app/results /app/static /var/log/nginx

# Copy startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose ports: 80 (nginx), 8000 (backend - internal)
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
