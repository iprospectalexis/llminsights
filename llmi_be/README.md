# LLM Insights API

Backend for **app.llm-insights.com** — the audit pipeline plus the SERP/LLM
collection gateway. FastAPI + asyncpg over Supabase Postgres, deployed in
Docker on the VPS behind Caddy (TLS) → nginx → uvicorn.

- **Version:** 2.0.0
- **Interactive docs:** `/docs` (Swagger UI) · `/redoc` · `/openapi.json`
- **Base URL (prod):** `https://app.llm-insights.com/api/v1`
- **Health:** `GET /health`

> There is a second, larger API surface this service does **not** own: the
> **Supabase data API** (PostgREST + SQL RPCs) that the React frontend calls
> directly for all reporting. It is documented in
> [API_REFERENCE.md](API_REFERENCE.md) alongside the REST endpoints below.

---

## Architecture

```
Browser (React)
   │  ├── REST ────────────►  this FastAPI service  ──►  Supabase Postgres
   │  └── PostgREST/RPC ───►  Supabase (data + SQL functions)
   │
Partners ── X-API-Key ─────►  /api/v1/jobs  (SERP/LLM collection gateway)
```

Two REST surfaces live here:

| Surface | Prefix | Auth | Purpose |
|---|---|---|---|
| **Audits** | `/api/v1/audits` | *(none today — see Security)* | Trigger & drive brand-visibility audits |
| **Jobs** | `/api/v1/jobs` | `X-API-Key` | Partner SERP/LLM batch collection gateway |
| **API keys** | `/api/v1/api-keys` | `X-API-Key` (admin) | Manage partner keys |
| **SERP** | `/api/v1/serp` | mixed (token / IP allowlist) | Lead capture, preview, usage |

### The audit pipeline

An audit is a tick-based state machine (15s scheduler interval, CAS-locked per
worker). States:

```
fetching → polling → extracting_competitors → analyzing_sentiment → finalizing → completed
```

- **polling** waits on provider jobs; anchored at `pipeline_state_entered_at`,
  bounded by `POLLING_MAX_MINUTES`.
- **extracting_competitors** runs `gpt-5.6-luna` over each answer.
- **analyzing_sentiment** scores per-brand sentiment (run 1 only in Avalanche).
- A scheduler **zombie sweep** auto-fails audits stuck >45 min in the three
  middle states; re-entry endpoints must re-stamp `pipeline_state_entered_at`.
- `WORKER_ENABLED=0` makes an instance serve the API only (no scheduler, no
  audit/job claiming). `GET /health` reports `worker_enabled` +
  `scheduler_running`.

**Providers & fallback:** each LLM has a provider chain (BrightData /
DataForSEO / OneSearch SERP). A circuit opens on billing (402) or repeated
transient errors; one fallback switch per row. See
`GET /api/v1/audits/provider-health`.

---

## Authentication

Partner endpoints require a key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: <key>" https://app.llm-insights.com/api/v1/jobs
```

- A legacy single master key (`API_KEY` env) is accepted everywhere.
- DB-backed partner keys (`api_keys` table) carry `rate_limit`, `daily_limit`,
  `max_prompts_per_job` and usage counters. Missing key → **401**, invalid →
  **403**, inactive/expired → **403**.

> ⚠️ The **audits** surface currently has **no** auth dependency. See
> [API_REFERENCE.md#security](API_REFERENCE.md#security-open-items).

---

## Local development

```bash
cd llmi_be
python -m venv venv311 && venv311/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env          # set DATABASE_URL, provider keys, WORKER_ENABLED
uvicorn app.main:app --reload --port 8000
```

Set `WORKER_ENABLED=0` locally so a dev instance never claims production
audits/jobs off the shared Supabase DB.

## Migrations

SQL migrations live in `../supabase/migrations/` and run on container startup
via `run_migrations.py`, tracked in `_schema_migrations`. A migration applied
by hand must be recorded there (`INSERT ... ON CONFLICT DO NOTHING`) or the
runner will try to re-run it and abort startup.

## Deploy

```bash
ssh srv818123 "cd ~/llminsights && git fetch origin && git reset --hard origin/main && docker compose up -d --build"
```

Never deploy while an in-container backfill or in-flight BrightData job is
running — `up --build` recreates the container and kills in-memory work.

---

Full endpoint & RPC reference: **[API_REFERENCE.md](API_REFERENCE.md)**.
