import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMatch, useSearchParams } from 'react-router-dom';
import {
  DashboardFilters,
  DEFAULT_FILTERS,
  LOCAL_STORAGE_KEY,
} from '../types/dashboard-filters';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  countActiveFilters,
  filtersEqual,
  hydrate,
  parseFromUrl,
  ProjectMeta,
  serializeToUrl,
  validateAgainstProject,
} from '../lib/dashboard-filter-utils';

/**
 * Global dashboard-filter store.
 *
 * One provider, mounted inside the Router in `App.tsx`. Pages read via
 * `useDashboardFilters()` and never own their own filter state.
 *
 * Source-of-truth precedence on first render:
 *   1. URL search params       (so a shared link reproduces the view)
 *   2. localStorage per project (so reload preserves the user's
 *      last-used filters)
 *   3. DEFAULT_FILTERS
 *
 * On every change, the provider writes BOTH the URL (via
 * `setSearchParams(_, { replace: true })`) AND localStorage. This
 * keeps the address bar shareable and survives a full reload.
 *
 * When the user navigates to a different project (`useParams().id`
 * changes), the provider re-hydrates from THAT project's
 * localStorage slot, and validates the loaded filters against the
 * project's available LLMs / prompt groups (silently dropping any
 * that no longer apply).
 */

type SetFilter = <K extends keyof DashboardFilters>(
  key: K,
  value: DashboardFilters[K],
) => void;

interface DashboardFiltersContextValue {
  filters: DashboardFilters;
  setFilter: SetFilter;
  setAllFilters: (next: DashboardFilters) => void;
  reset: () => void;
  activeFilterCount: number;
  /**
   * Pages call this once they know which LLMs / prompt groups exist
   * for the current project. The provider then validates the loaded
   * filters and silently drops invalid values.
   */
  registerProjectMeta: (meta: ProjectMeta) => void;
  /**
   * Available LLMs / prompt groups / audit-dates for the current
   * project, as registered by the page. The FilterBar consumes this
   * to populate its dropdowns. Undefined until at least one page has
   * called `registerProjectMeta`.
   */
  projectMeta: ProjectMeta | undefined;
  /**
   * The most recent audit's YYYY-MM-DD (if any), as registered by the
   * page. Consumed by `resolveDateWindow` for the "Last audit" preset.
   */
  lastAuditDate: string | null;
  setLastAuditDate: (date: string | null) => void;
}

const DashboardFiltersContext =
  createContext<DashboardFiltersContextValue | undefined>(undefined);

export const useDashboardFilters = (): DashboardFiltersContextValue => {
  const ctx = useContext(DashboardFiltersContext);
  if (!ctx) {
    throw new Error(
      'useDashboardFilters must be used within a DashboardFiltersProvider',
    );
  }
  return ctx;
};

interface ProviderProps {
  children: ReactNode;
}

export const DashboardFiltersProvider: React.FC<ProviderProps> = ({
  children,
}) => {
  // The provider is mounted ABOVE <Routes> (so it can wrap every
  // page), which means it is NOT inside a matched <Route> — therefore
  // useParams() would return {} here. Instead we match the pathname
  // directly with useMatch, which works anywhere under the Router.
  // The splat pattern matches both /projects/:id and any nested
  // dashboard route (/projects/:id/prompts/:promptId, …). When not on
  // a project route the match is null and we fall back to the 'global'
  // localStorage slot.
  const projectMatch = useMatch('/projects/:projectId/*');
  const projectId = projectMatch?.params.projectId ?? null;

  const [searchParams, setSearchParams] = useSearchParams();
  const [storage, setStorage] = useLocalStorage<DashboardFilters>(
    LOCAL_STORAGE_KEY(projectId),
    DEFAULT_FILTERS,
  );

  // Project metadata (LLMs, prompt groups) is supplied by the first
  // page that loads it. Until then, validation is skipped (lenient).
  const [projectMeta, setProjectMeta] = useState<ProjectMeta | undefined>();
  const [lastAuditDate, setLastAuditDate] = useState<string | null>(null);

  // Clear page-supplied meta when projectId changes, so we don't
  // momentarily validate filters against the previous project's
  // LLMs/groups while the new page is still loading.
  useEffect(() => {
    setProjectMeta(undefined);
    setLastAuditDate(null);
  }, [projectId]);

  // Hydration: read URL first, fall back to storage. Note that
  // `searchParams` here is the *current* URL on mount — initial
  // computation only.
  const [filters, setFilters] = useState<DashboardFilters>(() =>
    hydrate(searchParams, storage),
  );

  // ── Sync filters → URL + localStorage ─────────────────────────────
  //
  // Every state change writes both backends. The `setSearchParams`
  // call uses `replace: true` so users don't accumulate history
  // entries from filter tweaks.
  //
  // Guard against the no-op write that would otherwise occur right
  // after the URL-watching effect (below) calls `setFilters` to mirror
  // a Back/Forward navigation — without the equality check we'd
  // bounce-back-and-forth forever.
  const lastSerializedRef = useRef<string>('');
  useEffect(() => {
    const url = serializeToUrl(filters);
    const serialized = JSON.stringify(url);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    setSearchParams(url, { replace: true });
    setStorage(filters);
  }, [filters, setSearchParams, setStorage]);

  // ── Sync URL → filters (Back / Forward / paste) ──────────────────
  //
  // When the URL changes from outside (browser nav, deep link), parse
  // it and update local state IFF it differs. The equality check
  // breaks the cycle with the previous effect.
  useEffect(() => {
    const fromUrl = parseFromUrl(searchParams);
    if (!fromUrl) return;
    setFilters(prev => (filtersEqual(prev, fromUrl) ? prev : fromUrl));
  }, [searchParams]);

  // ── Project navigation: re-hydrate from the new project ──────────
  //
  // When `projectId` changes (navigating from project A to B), reload
  // B's filters rather than carrying A's into B. Precedence is the
  // same as initial hydration: URL params first (shared/deep links),
  // then B's localStorage slot, then defaults. We read localStorage
  // synchronously here because the `useLocalStorage` state can lag a
  // render behind the key change.
  //
  // Skipped on first mount (ref starts equal to projectId) — the
  // useState initializer already handled initial hydration.
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    if (projectIdRef.current === projectId) return;
    projectIdRef.current = projectId;

    const fromUrl = parseFromUrl(searchParams);
    let next: DashboardFilters = DEFAULT_FILTERS;
    if (fromUrl) {
      next = fromUrl;
    } else if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY(projectId));
        next = raw ? (JSON.parse(raw) as DashboardFilters) : DEFAULT_FILTERS;
      } catch {
        next = DEFAULT_FILTERS;
      }
    }
    setFilters(next);
  }, [projectId, searchParams]);

  // Pages register their project metadata as it loads.
  const registerProjectMeta = useCallback((meta: ProjectMeta) => {
    setProjectMeta(prev => {
      // Skip if nothing changed — avoids a render storm when the page
      // re-renders for unrelated reasons.
      if (
        prev &&
        prev.hasAudits === meta.hasAudits &&
        prev.availableLlms.length === meta.availableLlms.length &&
        prev.availablePromptGroups.length === meta.availablePromptGroups.length &&
        prev.availableDates.length === meta.availableDates.length &&
        prev.availableLlms.every((l, i) => l === meta.availableLlms[i]) &&
        prev.availablePromptGroups.every((g, i) => g === meta.availablePromptGroups[i]) &&
        prev.availableDates.every((d, i) => d === meta.availableDates[i])
      ) {
        return prev;
      }
      return meta;
    });
  }, []);

  // Apply validation when meta arrives or changes.
  useEffect(() => {
    if (!projectMeta) return;
    setFilters(prev => validateAgainstProject(prev, projectMeta));
  }, [projectMeta]);

  // ── Public API ───────────────────────────────────────────────────

  const setFilter = useCallback<SetFilter>((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const setAllFilters = useCallback((next: DashboardFilters) => {
    setFilters(next);
  }, []);

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    // Also drop the URL entries — `setSearchParams({}, ...)` clears
    // every key from the bar.
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const activeFilterCount = useMemo(
    () => countActiveFilters(filters),
    [filters],
  );

  const value = useMemo<DashboardFiltersContextValue>(
    () => ({
      filters,
      setFilter,
      setAllFilters,
      reset,
      activeFilterCount,
      registerProjectMeta,
      projectMeta,
      lastAuditDate,
      setLastAuditDate,
    }),
    [
      filters,
      setFilter,
      setAllFilters,
      reset,
      activeFilterCount,
      registerProjectMeta,
      projectMeta,
      lastAuditDate,
    ],
  );

  return (
    <DashboardFiltersContext.Provider value={value}>
      {children}
    </DashboardFiltersContext.Provider>
  );
};
