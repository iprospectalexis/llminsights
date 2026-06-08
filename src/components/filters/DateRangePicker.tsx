import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import { Modal } from '../ui/Modal';
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
  { value: 'lastAudit', label: 'Last audit' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last14days', label: 'Last 14 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'last90days', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom…' },
];

/**
 * Date-range filter. Native `<select>` for the presets; a small modal
 * opens for `custom` so the user can pick start/end from the
 * project's actual audit dates (avoids picking a date with no data).
 *
 * The custom range is only applied when the user clicks "Apply" —
 * partial selections (start without end, or vice versa) don't fire
 * the filter, matching the pre-existing UX on Project pages.
 */
export const DateRangePicker: React.FC<Props> = ({
  value,
  customRange,
  availableDates,
  onChange,
  className = '',
}) => {
  const [showModal, setShowModal] = useState(false);
  const [draftStart, setDraftStart] = useState(customRange.startDate);
  const [draftEnd, setDraftEnd] = useState(customRange.endDate);

  const openCustom = () => {
    setDraftStart(customRange.startDate);
    setDraftEnd(customRange.endDate);
    setShowModal(true);
  };

  const handlePresetChange = (next: DateRangePreset) => {
    if (next === 'custom') {
      openCustom();
      return;
    }
    onChange(next);
  };

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    onChange('custom', { startDate: draftStart, endDate: draftEnd });
    setShowModal(false);
  };

  const cancelCustom = () => {
    setShowModal(false);
    // If no range was ever applied, fall back to lastAudit to avoid
    // a "custom" selection without dates.
    if (!customRange.startDate || !customRange.endDate) {
      onChange('lastAudit');
    }
  };

  const customLabel =
    value === 'custom' && customRange.startDate && customRange.endDate
      ? `Custom: ${customRange.startDate} → ${customRange.endDate}`
      : null;

  return (
    <>
      <div className={`flex items-center gap-1.5 ${className}`}>
        <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
        <select
          value={value}
          onChange={e => handlePresetChange(e.target.value as DateRangePreset)}
          className="font-sans rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
          aria-label="Date range filter"
        >
          {PRESETS.map(p => (
            <option key={p.value} value={p.value}>
              {customLabel && p.value === 'custom' ? customLabel : p.label}
            </option>
          ))}
        </select>
      </div>

      <Modal
        isOpen={showModal}
        onClose={cancelCustom}
        title="Select Custom Date Range"
      >
        <div className="p-6 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Select from dates with available audit data.
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Date
              </label>
              <select
                value={draftStart}
                onChange={e => setDraftStart(e.target.value)}
                className="font-sans block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              >
                <option value="">Select start date</option>
                {availableDates.map(date => (
                  <option key={date} value={date}>
                    {new Date(date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Date
              </label>
              <select
                value={draftEnd}
                onChange={e => setDraftEnd(e.target.value)}
                disabled={!draftStart}
                className="font-sans block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 disabled:opacity-50 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              >
                <option value="">Select end date</option>
                {availableDates
                  .filter(date => !draftStart || date >= draftStart)
                  .map(date => (
                    <option key={date} value={date}>
                      {new Date(date).toLocaleDateString()}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {draftStart && draftEnd && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
              <div className="text-sm text-blue-800 dark:text-blue-200">
                Selected range: {new Date(draftStart).toLocaleDateString()} –{' '}
                {new Date(draftEnd).toLocaleDateString()}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" onClick={cancelCustom}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={applyCustom}
              disabled={!draftStart || !draftEnd}
            >
              Apply Date Range
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
