import React from 'react';
import { SentimentFilter } from '../../types/dashboard-filters';

interface Props {
  value: SentimentFilter;
  onChange: (v: SentimentFilter) => void;
  className?: string;
}

const OPTIONS: { value: SentimentFilter; label: string }[] = [
  { value: 'all', label: 'All sentiments' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

/**
 * Single-select dropdown for the sentiment filter. Plain `<select>`
 * — no need for a custom portal here since there's only ever 4
 * options and they fit comfortably in the native dropdown.
 */
export const SentimentSelect: React.FC<Props> = ({ value, onChange, className = '' }) => {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as SentimentFilter)}
      className={`font-sans rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 ${className}`}
      aria-label="Sentiment filter"
    >
      {OPTIONS.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
};
