import React, { useMemo } from 'react';
import { Brain } from 'lucide-react';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { LLM_ICONS, getLlmDisplayName } from '../../lib/llm-display';

interface Props {
  selected: string[];
  available: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * LLM filter dropdown. Renders the same UX as the inline
 * implementations on ProjectCompetitorsPage / ProjectPromptsPage that
 * we're now centralizing.
 */
export const LlmMultiSelect: React.FC<Props> = ({
  selected,
  available,
  onChange,
  className,
}) => {
  const options = useMemo(
    () =>
      available.map(llm => ({
        value: llm,
        label: getLlmDisplayName(llm),
        icon: LLM_ICONS[llm] ? (
          <img src={LLM_ICONS[llm]} alt="" className="w-4 h-4 rounded" />
        ) : null,
      })),
    [available],
  );

  return (
    <MultiSelectDropdown
      selected={selected}
      options={options}
      onChange={onChange}
      allLabel="All LLMs"
      noun="LLMs"
      triggerIcon={<Brain className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />}
      ariaLabel="Filter by LLM"
      className={className}
    />
  );
};
