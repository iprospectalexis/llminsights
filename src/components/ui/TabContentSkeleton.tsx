import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Placeholder rendered in place of a dashboard tab's widgets while the
 * project's data window is still loading. Mirrors the typical tab
 * layout (stat cards, two charts, a table) with pulsing blocks and a
 * single visible spinner, so the page never flashes "no data" empty
 * states mid-load.
 */
export const TabContentSkeleton: React.FC = () => {
  const card = 'rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5';
  const bar = 'rounded bg-gray-200 dark:bg-gray-700 animate-pulse';
  const soft = 'rounded bg-gray-100 dark:bg-gray-700/50 animate-pulse';

  return (
    <div className="pt-4 space-y-6" aria-busy="true" aria-label="Loading data">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={card}>
            <div className={`h-3.5 w-24 ${bar}`} />
            <div className={`mt-3 h-7 w-16 ${bar}`} />
            <div className={`mt-2 h-3 w-20 ${soft}`} />
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={card}>
          <div className={`h-4 w-44 ${bar}`} />
          <div className="mt-4 h-56 rounded-xl bg-gray-50 dark:bg-gray-700/30 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-gray-400 dark:text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Loading data…</span>
            </div>
          </div>
        </div>
        <div className={card}>
          <div className={`h-4 w-36 ${bar}`} />
          <div className="mt-4 h-56 rounded-xl bg-gray-50 dark:bg-gray-700/30 animate-pulse" />
        </div>
      </div>

      {/* Table */}
      <div className={card}>
        <div className={`h-4 w-52 ${bar}`} />
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-4">
              <div className={`h-4 w-4 rounded-full ${soft}`} />
              <div className={`h-3.5 ${soft}`} style={{ width: `${62 - i * 6}%` }} />
              <div className={`ml-auto h-3.5 w-12 ${soft}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
