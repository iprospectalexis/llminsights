/**
 * Shared filter state for every project-dashboard page.
 *
 * Owned by `src/contexts/DashboardFiltersContext.tsx`. Consumed by:
 *   - ProjectDetailPage / ProjectOverviewPage
 *   - ProjectPromptsPage
 *   - ProjectCompetitorsPage
 *   - PromptDetailPage
 *   - DomainDetailPage
 *
 * Source of truth precedence (handled by the provider):
 *   1. URL search params (so a shared link reproduces the view)
 *   2. localStorage per projectId (so reload / return preserves state)
 *   3. DEFAULT_FILTERS
 *
 * The explicit `type` here makes the legacy `promptGroup` vs
 * `promptGroups` typo (string vs string[]) impossible — it would fail
 * `tsc --noEmit` immediately.
 */

export type DateRangePreset =
  | 'lastAudit'
  | 'last7days'
  | 'last14days'
  | 'last30days'
  | 'last90days'
  | 'all'
  | 'custom';

export type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative';

export type CustomDateRange = {
  /** ISO date string (YYYY-MM-DD) — empty string when no range is set. */
  startDate: string;
  endDate: string;
};

export type DashboardFilters = {
  dateRange: DateRangePreset;
  customDateRange: CustomDateRange;
  /** Multi-select. Empty array = no filter (all LLMs). */
  llms: string[];
  /** Multi-select. Empty array = no filter (all prompt groups). */
  promptGroups: string[];
  sentiment: SentimentFilter;
};

export const DEFAULT_FILTERS: DashboardFilters = {
  dateRange: 'last90days',
  customDateRange: { startDate: '', endDate: '' },
  llms: [],
  promptGroups: [],
  sentiment: 'all',
};

/**
 * Short URL keys — keep them compact so the address bar stays readable
 * even with several filters active. Mapping is exhaustive; any value
 * equal to its default is omitted from the URL by the serializer.
 */
export const URL_KEYS = {
  dateRange: 'dr',
  customStart: 'from',
  customEnd: 'to',
  llms: 'llms',
  promptGroups: 'pg',
  sentiment: 'sent',
} as const;

/** localStorage key template — versioned + per-project namespaced. */
export const LOCAL_STORAGE_KEY = (projectId: string | null | undefined) =>
  `dfilters_v1_${projectId ?? 'global'}`;

/**
 * Presets the UI offers. `lastAudit` and `all` were retired when the
 * period selector became the GSC-style button row (7d / 14d / 1m / 3m /
 * custom): they remain in the type so legacy stored/URL values still
 * type-check, but hydration coerces them to the default 3-month window.
 */
export const VALID_DATE_RANGE_PRESETS: ReadonlyArray<DateRangePreset> = [
  'last7days',
  'last14days',
  'last30days',
  'last90days',
  'custom',
];

export const VALID_SENTIMENT_VALUES: ReadonlyArray<SentimentFilter> = [
  'all',
  'positive',
  'neutral',
  'negative',
];
