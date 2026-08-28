import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  CustomDateRange,
  DateRangePreset,
} from '../../types/dashboard-filters';

interface Props {
  value: DateRangePreset;
  customRange: CustomDateRange;
  /** Dates available for the custom-range picker (YYYY-MM-DD). */
  availableDates: string[];
  onChange: (next: DateRangePreset, customRange?: CustomDateRange) => void;
  className?: string;
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'last7days', label: '7 days' },
  { value: 'last14days', label: '14 days' },
  { value: 'last30days', label: '1 month' },
  { value: 'last90days', label: '3 months' },
];

const fmtShort = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * GSC-style period selector: a horizontal joined button row for the
 * rolling presets, plus a "Plus" button that drops down a panel with
 * two native date inputs (each opens the browser calendar) for a
 * custom range. Every audit inside the selected window counts.
 */
export const DateRangePicker: React.FC<Props> = ({
  value,
  customRange,
  availableDates,
  onChange,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(customRange.startDate);
  const [draftEnd, setDraftEnd] = useState(customRange.endDate);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openCustom = () => {
    setDraftStart(customRange.startDate);
    setDraftEnd(customRange.endDate);
    setOpen(o => !o);
  };

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    const [start, end] =
      draftStart <= draftEnd ? [draftStart, draftEnd] : [draftEnd, draftStart];
    onChange('custom', { startDate: start, endDate: end });
    setOpen(false);
  };

  const isCustom = value === 'custom';
  const customLabel =
    isCustom && customRange.startDate && customRange.endDate
      ? `${fmtShort(customRange.startDate)} - ${fmtShort(customRange.endDate)}`
      : 'Plus';

  const minDate = availableDates.length > 0 ? availableDates[0] : undefined;
  const today = new Date().toISOString().split('T')[0];

  const segBase =
    'flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium whitespace-nowrap ' +
    'border-l first:border-l-0 border-gray-300 dark:border-gray-600 transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40';
  const segIdle =
    'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700';
  const segActive =
    'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        role="group"
        aria-label="Date range"
        className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden shadow-sm"
      >
        {PRESETS.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            aria-pressed={value === p.value}
            className={`${segBase} ${value === p.value ? segActive : segIdle}`}
          >
            {value === p.value && <Check className="w-3.5 h-3.5" />}
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={openCustom}
          aria-pressed={isCustom}
          aria-expanded={open}
          className={`${segBase} ${isCustom ? segActive : segIdle}`}
        >
          {isCustom && <Check className="w-3.5 h-3.5" />}
          {customLabel}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Custom period
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                From
              </label>
              <input
                type="date"
                value={draftStart}
                min={minDate}
                max={today}
                onChange={e => setDraftStart(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                To
              </label>
              <input
                type="date"
                value={draftEnd}
                min={draftStart || minDate}
                max={today}
                onChange={e => setDraftEnd(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              />
            </div>
          </div>
          {minDate && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Audit data available since {fmtShort(minDate)}.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              size="sm"
              onClick={applyCustom}
              disabled={!draftStart || !draftEnd}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
