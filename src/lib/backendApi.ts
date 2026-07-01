/**
 * Backend API client (llmi_be).
 *
 * In development Vite proxies /api → http://localhost:8000.
 * In production nginx (or similar) proxies /api → backend service.
 * The base URL is always relative so the same build works everywhere.
 */

const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  apiKey?: string;
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal, apiKey } = opts;

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (apiKey) {
    reqHeaders['X-API-Key'] = apiKey;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Backend API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Job endpoints ─────────────────────────────────────────────

export interface CreateJobPayload {
  prompts: string[];
  geo_targeting?: string;
  source?: string;
  provider?: string;
  web_search?: boolean;
  webhook_url?: string;
}

export interface JobResponse {
  id: string;
  status: string;
  provider: string;
  total_prompts: number;
  processed_prompts: number;
  failed_prompts: number;
  progress: number;
  results?: unknown[];
  download_url?: string;
  converted_download_url?: string;
  created_at: string;
  completed_at?: string;
}

export function createJob(payload: CreateJobPayload, apiKey?: string) {
  return request<JobResponse>('/v1/jobs', { method: 'POST', body: payload, apiKey });
}

export function getJob(jobId: string, apiKey?: string) {
  return request<JobResponse>(`/v1/jobs/${jobId}`, { apiKey });
}

export function listJobs(params?: { status?: string; limit?: number; offset?: number }, apiKey?: string) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return request<{ jobs: JobResponse[]; total: number }>(`/v1/jobs${query ? `?${query}` : ''}`, { apiKey });
}

export function getJobResults(jobId: string, apiKey?: string) {
  return request<{ results: unknown[] }>(`/v1/jobs/${jobId}/results`, { apiKey });
}

export function cancelJob(jobId: string, apiKey?: string) {
  return request<{ message: string }>(`/v1/jobs/${jobId}`, { method: 'DELETE', apiKey });
}

export function retryJob(jobId: string, apiKey?: string) {
  return request<JobResponse>(`/v1/jobs/${jobId}/retry`, { method: 'POST', apiKey });
}

// ── Audit endpoints ──────────────────────────────────────────

export interface RunAuditPayload {
  projectId: string;
  llms?: string[];
  enableSentiment?: boolean;
  forceWebSearch?: boolean;
  groupIds?: string[];
  isScheduled?: boolean;
  // Gemini only: true → DataForSEO Gemini (web-search), false → BrightData.
  geminiWebSearch?: boolean;
}

export interface AuditStatusResponse {
  audit_id: string;
  status: string;
  current_step?: string;
  progress: number;
  steps: { step: string; status: string; message?: string }[];
}

export function runAudit(payload: RunAuditPayload) {
  return request<{ success: boolean; auditId: string; message: string }>('/v1/audits/run', {
    method: 'POST',
    body: payload,
  });
}

export function pollAudit(auditId: string) {
  return request<{ success: boolean; message: string }>(`/v1/audits/${auditId}/poll`, {
    method: 'POST',
  });
}

export function getAuditStatus(auditId: string) {
  return request<AuditStatusResponse>(`/v1/audits/${auditId}/status`);
}

export interface RecoverPollingResponse {
  success: boolean;
  audit_id: string;
  rows_reset: number;
  message: string;
}

// Re-enter polling for a failed audit where the provider still has the
// data (error_message must start with "Polling finished but ..."). The
// backend resets the per-row exhaustion flags and flips the audit back
// to polling — scheduler picks it up within 15s and re-polls OneSearch.
export function recoverPollingAudit(auditId: string) {
  return request<RecoverPollingResponse>(`/v1/audits/${auditId}/recover-polling`, {
    method: 'POST',
  });
}

// ── SERP / AI Overview Preview ───────────────────────────────

export interface SerpSource {
  title: string;
  url: string;
  source: string;
  host: string;
  shared: boolean;
}

export interface SerpPreviewResult {
  keyword: string;
  ok: boolean;
  html: string;
  aio_sources: SerpSource[];
  organic_sources: SerpSource[];
  has_aio: boolean;
  error?: string | null;
}

export interface SerpPreviewPayload {
  keywords: string[];           // jusqu'à 5
  geo: string;                  // code pays ISO-2, ex. "US"
  device: 'desktop' | 'mobile';
}

export function getSerpPreview(payload: SerpPreviewPayload, signal?: AbortSignal) {
  return request<{ results: SerpPreviewResult[] }>('/v1/serp/preview', {
    method: 'POST',
    body: payload,
    signal,
  });
}

// ── Health ────────────────────────────────────────────────────

export function checkHealth() {
  return request<{ status: string; version?: string }>('/health');
}

export default {
  createJob,
  getJob,
  listJobs,
  getJobResults,
  cancelJob,
  retryJob,
  runAudit,
  pollAudit,
  getAuditStatus,
  recoverPollingAudit,
  checkHealth,
};
