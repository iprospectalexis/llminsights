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
  checkHealth,
};
