import React from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import { useDashboardFilters } from '../../contexts/DashboardFiltersContext';
import { Button } from '../ui/Button';
import { DateRangePicker } from './DateRangePicker';
import { LlmMultiSelect } from './LlmMultiSelect';
import { PromptGroupMultiSelect } from './PromptGroupMultiSelect';
import { SentimentSelect } from './SentimentSelect';

/**
 * Sticky filter bar rendered by AppLayout on dashboard routes only.
 *
 * Reads all filter state from `useDashboardFilters()`. The bar is
 * stateless beyond that — every interaction is dispatched to the
 * context, which handles URL + localStorage sync.
 *
 * Visibility rules:
 *   - Hidden unless the current route is a project dashboard
 *     (AppLayout handles that — this component renders unconditionally
 *     when included in the tree).
 *   - The prompt-groups dropdown is hidden when the project has no
 *     groups defined (a noisy empty dropdown is worse than no
 *     dropdown).
 */
export const DashboardFilterBar: React.FC = () => {
  const {
    filters,
    setFilter,
    reset,
    activeFilterCount,
    projectMeta,
  } = useDashboardFilters();

  const availableLlms = projectMeta?.availableLlms ?? [];
  const availableGroups = projectMeta?.availablePromptGroups ?? [];
  const availableDates = projectMeta?.availableDates ?? [];

  return (
    <div className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700">
      <div className="px-3 md:px-6 py-2 flex flex-wrap items-center gap-2 md:gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Filters</span>
        </div>

        <DateRangePicker
          value={filters.dateRange}
          customRange={filters.customDateRange}
          availableDates={availableDates}
          onChange={(next, customRange) => {
            if (customRange) {
              // Update both keys atomically — setFilter only takes one
              // at a time, so we do two synchronous calls. React will
              // batch them inside the same event handler.
              setFilter('dateRange', next);
              setFilter('customDateRange', customRange);
            } else {
              setFilter('dateRange', next);
            }
          }}
        />

        <LlmMultiSelect
          selected={filters.llms}
          available={availableLlms}
          onChange={next => setFilter('llms', next)}
        />

        {availableGroups.length > 0 && (
          <PromptGroupMultiSelect
            selected={filters.promptGroups}
            available={availableGroups}
            onChange={next => setFilter('promptGroups', next)}
          />
        )}

        <SentimentSelect
          value={filters.sentiment}
          onChange={next => setFilter('sentiment', next)}
        />

        <div className="ml-auto flex items-center gap-2">
          {activeFilterCount > 0 && (
            <span
              className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline"
              data-testid="active-filter-count"
            >
              {activeFilterCount} active
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={activeFilterCount === 0}
            className="!px-2 !py-1"
            aria-label="Reset filters"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
};
