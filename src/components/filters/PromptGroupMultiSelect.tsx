import React, { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { MultiSelectDropdown } from './MultiSelectDropdown';

interface Props {
  selected: string[];
  available: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * Prompt-group filter dropdown. Functionally identical to
 * `LlmMultiSelect` but without icons — prompt groups are just text.
 *
 * Hidden by the filter bar when `available.length === 0`, because a
 * project with no prompt groups has nothing to filter by.
 */
export const PromptGroupMultiSelect: React.FC<Props> = ({
  selected,
  available,
  onChange,
  className,
}) => {
  const options = useMemo(
    () => available.map(g => ({ value: g, label: g })),
    [available],
  );

  return (
    <MultiSelectDropdown
      selected={selected}
      options={options}
      onChange={onChange}
      allLabel="All groups"
      noun="groups"
      triggerIcon={<Tag className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />}
      ariaLabel="Filter by prompt group"
      className={className}
    />
  );
};
