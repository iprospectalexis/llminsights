# LLM Insights — API Reference

Generated against live OpenAPI **v2.0.0** (28 paths) plus the Supabase data
API the frontend consumes. Two transports:

1. **REST** (`/api/v1/*`) — this FastAPI service.
2. **Supabase** — PostgREST tables + SQL RPCs, called directly from the browser
   with the anon key + the user's session (RLS enforced).

Conventions: all REST bodies are JSON. `X-API-Key` where noted. Timestamps are
ISO-8601 UTC.

---

## 1. REST — Audits `/api/v1/audits`

**Auth (since 2026-08-25):** every audits endpoint requires ONE of:

- `Authorization: Bearer <supabase access_token>` — the signed-in user's
  session; the backend validates it against Supabase Auth (`GET /auth/v1/user`)
  and caches positives for 60s. This is what the frontend sends automatically.
- `X-API-Key: <master key>` — ops scripts and monitoring.

Missing/invalid credentials → **401**; Supabase Auth unreachable → **503**
(fail closed). Escape hatch: `AUDITS_AUTH_REQUIRED=0` in the environment
disables enforcement without a redeploy.

### POST `/audits/run` — start an audit
Body **RunAuditRequest**:

| field | type | default | notes |
|---|---|---|---|
| `projectId` | string (uuid) | — | **required** |
| `llms` | string[] \| null | all configured | e.g. `["searchgpt","perplexity","gemini"]` |
| `enableSentiment` | bool | `true` | |
| `forceWebSearch` | bool | `true` | |
| `groupIds` | string[] \| null | all groups | prompt-group filter |
| `isScheduled` | bool | `false` | marks a scheduled run |
| `geminiWebSearch` | bool | `false` | true → DataForSEO grounded Gemini; false → BrightData |
| `avalanche` | bool | `false` | ×3 runs (objectivity mode) |

Returns `{ success, auditId, message }`. Triggers provider jobs in a background
task, then the scheduler drives the pipeline. On trigger failure the audit is
marked `failed` **with** `error_message` + `finished_at`.

### GET `/audits/{audit_id}/status` — poll progress
Returns **AuditStatusResponse**: `status`, `pipeline_state`, `current_step`,
`progress`, `responses_expected/received`, `competitors_processed/total`,
`sentiment_processed/total`, `steps[]`.

### POST `/audits/{audit_id}/poll`
Force one manual polling tick. *(Runs `process_step` directly — see the
concurrency note in [Security](#security-open-items).)*

### POST `/audits/{audit_id}/resume`
Re-queue a stuck audit (clears lock, re-stamps `last_activity_at`). Valid only
from resumable pipeline states.

### POST `/audits/{audit_id}/reprocess?from_stage=<stage>`
Re-enter a **completed/failed** audit at `extracting_competitors`,
`analyzing_sentiment`, or `finalizing`. Re-stamps `pipeline_state_entered_at`
(so the zombie sweep doesn't immediately kill it) and resets batch counters.

### POST `/audits/{audit_id}/recover-polling`
For a failed audit whose provider still holds the data (`error_message` starts
with `Polling finished but …`): resets per-row exhaustion flags and flips back
to `polling`. Used by the StatusPage "Recover" button.

### POST `/audits/{audit_id}/retry-llm`
Body **RetryLlmRequest** `{ "llm": "gemini" }`. Re-triggers a fresh provider
job for one LLM's un-answered rows — including rows carrying the
`{"error": …}` trigger-failure sentinel. Rows that already have answers are
untouched.

### GET `/audits/provider-health`
Per-provider circuit state: `status` (ok/open), `reason`, `credentials`,
`consecutive_failures`, `opened_until`.

### GET `/audits/scheduler-health`
Scheduler liveness / last tick.

---

## 2. REST — Jobs `/api/v1/jobs` — `X-API-Key`

The partner-facing SERP/LLM collection gateway.

**Partner base URLs:** canonical `https://app.llm-insights.com/api/v1` (TLS).
The legacy standalone service that lived on `http://<vps>:8000` was retired on
2026-08-25; that port is now a Caddy compatibility listener proxying to this
same backend — existing partner keys and the webhook secret carried over
unchanged (smalk_ai migrated this way with zero action on their side).

### POST `/jobs` — create
Body **JobCreate**:

| field | type | default | notes |
|---|---|---|---|
| `prompts` | string[] | — | **required**, ≤ 1000 |
| `geo_targeting` | string | `Paris,Paris,Ile-de-France,France` | |
| `source` | string | `chatgpt` | chatgpt · perplexity · gemini · copilot |
| `provider` | enum | `serp` | `serp` \| `brightdata` |
| `web_search` | bool | `true` | preserved across retries |
| `webhook_url` | string \| null | — | POSTed on completion with `X-Webhook-Secret` (only when configured) |

### GET `/jobs?page=&per_page=&status=` — list · GET `/jobs/{id}` — detail
Returns **JobResponse** / **JobListResponse**.

### DELETE `/jobs/{id}` — cancel
Allowed for `pending`, `getting_results`, **and** `processing_results`.

### POST `/jobs/{id}/retry` — retry failed queries
Creates a new job from `failed_queries`, **preserving** `web_search`,
`source`, `provider`, `webhook_url`.

### GET `/jobs/{id}/results?page=&per_page=&format=` — JSON results
Paginated. Pagination object exposes `total_pages` (consumers should read
`total_pages`, falling back to `pages`).

### GET `/jobs/{id}/download` · `/download/converted` — files
### POST `/jobs/{id}/reconvert` — re-run conversion

Job lifecycle: `pending → getting_results → processing_results → completed`
(or `failed` / `cancelled`).

---

## 3. REST — API keys `/api/v1/api-keys` — admin `X-API-Key`

| method | path | body / params |
|---|---|---|
| POST | `/api-keys` | **ApiKeyCreate** `{name, description?, rate_limit=100, daily_limit=10000, max_prompts_per_job=1000, expires_in_days?}` → returns the plaintext key **once** |
| GET | `/api-keys?page=&per_page=&active_only=` | list |
| GET | `/api-keys/{id}` | detail |
| PATCH | `/api-keys/{id}?name=&description=&rate_limit=&daily_limit=&max_prompts_per_job=` | update |
| DELETE | `/api-keys/{id}` | delete |
| POST | `/api-keys/{id}/activate` · `/deactivate` | toggle |
| GET | `/api-keys/{id}/usage` | totals; per-day fields are `null` (not tracked), never a fake 0 |

> **Known limitation:** `POST /api-keys` currently 500s against the prod
> table — `group_id` and `created_by` are NOT NULL there (the table is owned
> by the frontend key-management flow) and the REST create does not populate
> them. Create keys through the frontend, or by SQL following
> `llmi_be/migrate_smalk_key.py`. Read/list/update/usage endpoints work.

---

## 4. REST — SERP `/api/v1/serp`

| method | path | auth | body |
|---|---|---|---|
| POST | `/serp/lead` | — | **GeoLeadRequest** (lead capture) |
| POST | `/serp/preview` | IP allowlist (`SERP_PREVIEW_IP_WHITELIST`) | **SerpPreviewRequest** `{queries[], device=desktop}` |
| GET | `/serp/usage?token=&format=` | `SERP_USAGE_TOKEN` | usage report |

---

## 5. REST — Root & health

| method | path | notes |
|---|---|---|
| GET | `/health` | **HealthResponse** `{status, version, database, active_jobs, worker_enabled, scheduler_running}`. **503** when the DB is unreachable, else **200**. |
| GET | `/api` | surface map + doc links |
| GET | `/` · `/dashboard` | static UI |
| GET | `/docs` · `/redoc` · `/openapi.json` | interactive docs |

---

## 6. Supabase data API (frontend-facing)

Called from the browser via `supabase-js` with the anon key + the user's JWT;
**RLS** restricts rows to the caller's projects. Reporting reads tables
(`audits`, `llm_responses`, `citations`, `brands`, `response_brand_sentiment`,
`project_metrics`, `domain_categories`, `brand_domains`, …) and these SQL RPCs:

| RPC | params | returns |
|---|---|---|
| `audit_response_stats` | `audit_id` | per-LLM answered/terminal counts |
| `audit_llm_response_stats` | `audit_id` | above + `competitors_missing` |
| `audit_competitor_ads` | `audit_id` | advertiser↔competitor matches |
| `project_citations_over_time` | `p_project_id, p_llm?, p_groups?, p_from?, p_to?, p_project_domain?, p_domain_mode?, p_max_domains?` | citations/date/domain over full history |
| `project_mentions_over_time` | `p_project_id, p_llm?, p_groups?, p_sentiment?, p_from?, p_to?, p_max_brands?` | mentions/date/brand |
| `project_domain_movers` | `p_project_id, p_llm?, p_groups?, p_days` | domain citing-share, last vs N-days-ago audit |
| `project_page_movers` | `p_project_id, p_llm?, p_groups?, p_days` | page citing-share, last vs N-days-ago audit |
| `top_source_domains` | filters | top cited domains |
| `get_web_search_count_by_time` / `..._trigger_percentage_by_time` | time filters | web-search usage |
| `get_costs_summary` / `_by_project` / `_by_audit` / `_by_operation` / `_by_user` / `_daily`, `get_audit_cost_events` | filters | OpenAI/provider cost analytics |
| `delete_project` | `project_id` | cascade delete |
| `recalculate_project_metrics` | `p_project_id` | **service_role only** — mention/citation rate; called by the pipeline & the recalculate-metrics edge function, **not** the browser |

Metric definitions (single source of truth = `recalculate_project_metrics`):
per-response over **answered** responses; brand match on word boundaries
(accent-insensitive, aliases); citations count `cited IS DISTINCT FROM false`;
citation rate is **NULL** ("not measurable") when a project's prompts were
orphaned.

---

## Security — resolved & open items

**Resolved 2026-08-25:**

- ~~Audits surface unauthenticated~~ — now requires a Supabase session or the
  master key (see section 1). Verified externally: `POST /audits/run` without
  credentials returns 401.
- ~~Stale host uvicorn on VPS `:8000`~~ — the legacy standalone backend
  (`llmi-backend.service`, `/root/llmi_backend`) is stopped and disabled; its
  port now proxies to the containerized backend. Its 56 GB SQLite is kept as
  an archive pending deletion.

**Still open:**

1. **Manual `/audits/{id}/poll`** runs `process_step` outside the scheduler's
   CAS lock/in-flight guard; a manual poll can race a scheduler tick on the
   same audit.
2. **No stalled-job recovery** for the `jobs` table (only audits are recovered
   on startup); a crash can strand a job in `getting_results`/`processing_results`.
3. **`WORKER_ENABLED=0` is not enforced on `POST /jobs`** — an API-only
   instance still processes a job POSTed directly to it.
4. **`POST /api-keys` broken against the prod table** (see section 3 note).
