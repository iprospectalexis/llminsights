/**
 * Pure helpers backing the global dashboard filter context.
 *
 * Everything here is a pure function — no React, no side effects. The
 * context glues them together; pages call `applyFilters` (or the
 * lower-level helpers) directly when they need to project their own
 * data through the active filter set.
 */

import {
  DashboardFilters,
  DEFAULT_FILTERS,
  DateRangePreset,
  SentimentFilter,
  URL_KEYS,
  VALID_DATE_RANGE_PRESETS,
  VALID_SENTIMENT_VALUES,
} from '../types/dashboard-filters';

// ── URL serialization ───────────────────────────────────────────────

/**
 * Convert a `DashboardFilters` into a `URLSearchParams`-compatible
 * record. Keys whose value equals the default are omitted, so a fully
 * unfiltered view produces an empty URL.
 */
export function serializeToUrl(filters: DashboardFilters): Record<string, string> {
  const out: Record<string, string> = {};

  if (filters.dateRange !== DEFAULT_FILTERS.dateRange) {
    out[URL_KEYS.dateRange] = filters.dateRange;
  }
  if (filters.dateRange === 'custom') {
    if (filters.customDateRange.startDate) {
      out[URL_KEYS.customStart] = filters.customDateRange.startDate;
    }
    if (filters.customDateRange.endDate) {
      out[URL_KEYS.customEnd] = filters.customDateRange.endDate;
    }
  }
  if (filters.llms.length > 0) {
    out[URL_KEYS.llms] = filters.llms.join(',');
  }
  if (filters.promptGroups.length > 0) {
    out[URL_KEYS.promptGroups] = filters.promptGroups.join(',');
  }
  if (filters.sentiment !== DEFAULT_FILTERS.sentiment) {
    out[URL_KEYS.sentiment] = filters.sentiment;
  }

  return out;
}

/**
 * Parse a `URLSearchParams` (or anything with `.get`) into a
 * `DashboardFilters`. Permissive: unknown keys are ignored, malformed
 * values fall back to the default so an old bookmark never crashes
 * the page.
 *
 * Returns `null` if no recognized filter key is present — lets the
 * caller distinguish "no URL state" from "URL state explicitly all
 * defaults" so it can skip the URL branch and fall back to
 * localStorage.
 */
export function parseFromUrl(params: URLSearchParams): DashboardFilters | null {
  let hasAny = false;
  const out: DashboardFilters = { ...DEFAULT_FILTERS };

  const dr = params.get(URL_KEYS.dateRange);
  if (dr && (VALID_DATE_RANGE_PRESETS as readonly string[]).includes(dr)) {
    out.dateRange = dr as DateRangePreset;
    hasAny = true;
  }
  const from = params.get(URL_KEYS.customStart);
  const to = params.get(URL_KEYS.customEnd);
  if (from || to) {
    out.customDateRange = {
      startDate: from && isIsoDate(from) ? from : '',
      endDate: to && isIsoDate(to) ? to : '',
    };
    hasAny = true;
  }
  const llms = params.get(URL_KEYS.llms);
  if (llms) {
    out.llms = llms.split(',').map(s => s.trim()).filter(Boolean);
    hasAny = true;
  }
  const pg = params.get(URL_KEYS.promptGroups);
  if (pg) {
    out.promptGroups = pg.split(',').map(s => s.trim()).filter(Boolean);
    hasAny = true;
  }
  const sent = params.get(URL_KEYS.sentiment);
  if (sent && (VALID_SENTIMENT_VALUES as readonly string[]).includes(sent)) {
    out.sentiment = sent as SentimentFilter;
    hasAny = true;
  }

  return hasAny ? out : null;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ── Filter validation against a project's available data ────────────

export type ProjectMeta = {
  /** LLMs that this project's audits actually use. */
  availableLlms: string[];
  /** Prompt-group names defined for this project. */
  availablePromptGroups: string[];
  /** YYYY-MM-DD dates with audit data — drives the custom-range picker. */
  availableDates: string[];
  /** True if the project has at least one completed audit. */
  hasAudits: boolean;
};

/**
 * Strip filter values that don't apply to the current project (e.g.
 * the user had `llms: ['grok']` saved but the new project has only
 * Perplexity). Silent — no error, just narrow the set.
 *
 * Returns the input filters unchanged if `meta` is undefined (we
 * haven't yet loaded the project's metadata — be lenient).
 */
export function validateAgainstProject(
  filters: DashboardFilters,
  meta: ProjectMeta | undefined,
): DashboardFilters {
  if (!meta) return filters;

  const llms = filters.llms.filter(l => meta.availableLlms.includes(l));
  const promptGroups = filters.promptGroups.filter(g =>
    meta.availablePromptGroups.includes(g),
  );

  let dateRange = filters.dateRange;
  if (dateRange === 'lastAudit' && !meta.hasAudits) {
    dateRange = 'all';
  }

  // Avoid allocating a new object if nothing changed — keeps React
  // memoization stable for downstream consumers.
  const unchanged =
    llms.length === filters.llms.length &&
    promptGroups.length === filters.promptGroups.length &&
    dateRange === filters.dateRange;
  if (unchanged) return filters;

  return { ...filters, llms, promptGroups, dateRange };
}

// ── Active filter count (for the bar's badge) ───────────────────────

export function countActiveFilters(filters: DashboardFilters): number {
  let n = 0;
  if (filters.dateRange !== DEFAULT_FILTERS.dateRange) n++;
  if (filters.llms.length > 0) n++;
  if (filters.promptGroups.length > 0) n++;
  if (filters.sentiment !== DEFAULT_FILTERS.sentiment) n++;
  // customDateRange is implicit when dateRange === 'custom'; not a
  // separate filter for badge purposes.
  return n;
}

// ── Date-window resolution ──────────────────────────────────────────

export type DateWindow = { start: Date; end: Date };

/**
 * Resolve a `dateRange` preset (plus optional `customDateRange` and
 * the page-supplied `lastAuditDate`) into a concrete [start, end]
 * window. Returns `null` for "all dates — no filter".
 *
 * `lastAuditDate` is the YYYY-MM-DD of the most recent audit with
 * data for the current page's data set. The page computes it from
 * its own `auditsData` and passes it in — this helper does not know
 * about Supabase.
 */
export function resolveDateWindow(
  filters: DashboardFilters,
  lastAuditDate: string | null,
): DateWindow | null {
  if (filters.dateRange === 'all') return null;

  if (filters.dateRange === 'lastAudit') {
    if (!lastAuditDate) return null; // not loaded yet → don't filter
    const start = new Date(`${lastAuditDate}T00:00:00.000Z`);
    const end = new Date(`${lastAuditDate}T23:59:59.999Z`);
    return { start, end };
  }

  if (filters.dateRange === 'custom') {
    const { startDate, endDate } = filters.customDateRange;
    if (!startDate || !endDate) return null;
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T23:59:59.999Z`);
    return { start, end };
  }

  // Rolling-window presets.
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  switch (filters.dateRange) {
    case 'last7days':
      start.setDate(start.getDate() - 6);
      break;
    case 'last14days':
      start.setDate(start.getDate() - 13);
      break;
    case 'last30days':
      start.setDate(start.getDate() - 29);
      break;
    case 'last90days':
      start.setDate(start.getDate() - 89);
      break;
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// ── Generic row filtering ───────────────────────────────────────────

/**
 * Generic filter helper used by every page. The caller passes
 * accessor functions so a single implementation can drive both
 * `llm_responses` and `citations` (which have different field names
 * for the same conceptual data).
 *
 * Rows are kept when ALL active criteria match. Inactive criteria
 * (empty arrays, `'all'`, no date window) are skipped entirely.
 */
export type RowAccessors<T> = {
  /** Audit-row creation date (preferred for "Last Audit" filter). */
  getAuditDate: (row: T) => string | null | undefined;
  /** Fallback when audit date is missing — e.g. citation.checked_at. */
  getFallbackDate?: (row: T) => string | null | undefined;
  getLlm: (row: T) => string | null | undefined;
  getPromptGroup: (row: T) => string | null | undefined;
  getSentiment: (row: T) => string | null | undefined;
};

export function applyFilters<T>(
  rows: T[],
  filters: DashboardFilters,
  lastAuditDate: string | null,
  accessors: RowAccessors<T>,
): T[] {
  const window = resolveDateWindow(filters, lastAuditDate);
  const llmSet = filters.llms.length > 0 ? new Set(filters.llms) : null;
  const pgSet = filters.promptGroups.length > 0 ? new Set(filters.promptGroups) : null;
  const sentimentActive = filters.sentiment !== 'all';

  return rows.filter(row => {
    // Date window
    if (window) {
      const raw =
        accessors.getAuditDate(row) ??
        (accessors.getFallbackDate ? accessors.getFallbackDate(row) : null);
      if (!raw) return false;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return false;
      if (d < window.start || d > window.end) return false;
    }

    // LLM
    if (llmSet) {
      const llm = accessors.getLlm(row);
      if (!llm || !llmSet.has(llm)) return false;
    }

    // Prompt group
    if (pgSet) {
      const pg = accessors.getPromptGroup(row);
      if (!pg || !pgSet.has(pg)) return false;
    }

    // Sentiment
    if (sentimentActive) {
      const s = accessors.getSentiment(row);
      if (s !== filters.sentiment) return false;
    }

    return true;
  });
}

// ── Hydration entry point ───────────────────────────────────────────

/**
 * Compute the initial filters value for the provider. Precedence:
 *   1. URL (if any recognized key is present)
 *   2. localStorage value (already loaded by the hook)
 *   3. DEFAULT_FILTERS
 *
 * The returned value is also validated against `meta` if provided.
 */
export function hydrate(
  searchParams: URLSearchParams,
  storedValue: DashboardFilters,
  meta?: ProjectMeta,
): DashboardFilters {
  const fromUrl = parseFromUrl(searchParams);
  const base = fromUrl ?? storedValue ?? DEFAULT_FILTERS;
  return validateAgainstProject(base, meta);
}

/**
 * Shallow equality on `DashboardFilters` — used inside the provider's
 * URL-watching effect to avoid an infinite render loop after the URL
 * synchronizes itself.
 */
export function filtersEqual(a: DashboardFilters, b: DashboardFilters): boolean {
  if (a.dateRange !== b.dateRange) return false;
  if (a.sentiment !== b.sentiment) return false;
  if (a.customDateRange.startDate !== b.customDateRange.startDate) return false;
  if (a.customDateRange.endDate !== b.customDateRange.endDate) return false;
  if (a.llms.length !== b.llms.length) return false;
  if (a.promptGroups.length !== b.promptGroups.length) return false;
  // Order matters less than membership, but the URL serializer always
  // produces the same order — element-wise compare is safe and faster
  // than a Set roundtrip for the typical 1-3 element arrays.
  for (let i = 0; i < a.llms.length; i++) {
    if (a.llms[i] !== b.llms[i]) return false;
  }
  for (let i = 0; i < a.promptGroups.length; i++) {
    if (a.promptGroups[i] !== b.promptGroups[i]) return false;
  }
  return true;
}
