import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional leading visual (e.g. LLM icon). */
  icon?: ReactNode;
}

interface Props {
  /** Currently selected values. Empty array = all (no filter). */
  selected: string[];
  options: MultiSelectOption[];
  /**
   * Called whenever the selection changes. Pass an empty array to mean
   * "all selected" — that's our convention for an inactive filter.
   */
  onChange: (next: string[]) => void;
  /** Label visible on the trigger button when `selected` is empty. */
  allLabel: string;
  /** Singular noun for "N items" labels — e.g. "LLMs", "groups". */
  noun: string;
  /** Optional leading icon (rendered to the left of the button). */
  triggerIcon?: ReactNode;
  /** Optional `aria-label` for the trigger button. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Portal-based multi-select dropdown. Same UX as the inline
 * implementations in ProjectCompetitorsPage / ProjectPromptsPage,
 * extracted here so the global filter bar can drive any number of
 * such dropdowns from a single component.
 *
 * Convention: an empty `selected` array means "all options" (no
 * filter applied). The first menu item, "All <noun>", clears the
 * selection.
 */
export const MultiSelectDropdown: React.FC<Props> = ({
  selected,
  options,
  onChange,
  allLabel,
  noun,
  triggerIcon,
  ariaLabel,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reposition on scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 220) });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: Math.max(rect.width, 220),
      });
    }
    setOpen(true);
  };

  const isAll = selected.length === 0;
  const label =
    isAll
      ? allLabel
      : selected.length === 1
        ? options.find(o => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} ${noun}`;

  const toggle = (val: string) => {
    if (isAll) {
      // Coming from "all" → user clicked one specific value, so the
      // intent is "only this one". Start the explicit selection there.
      onChange([val]);
      return;
    }
    if (selected.includes(val)) {
      const next = selected.filter(v => v !== val);
      onChange(next);
      return;
    }
    // Adding to a partial selection. If that would now include every
    // option, normalize back to [] = all.
    const next = [...selected, val];
    if (next.length === options.length) {
      onChange([]);
    } else {
      onChange(next);
    }
  };

  const clearAll = () => {
    onChange([]);
    setOpen(false);
  };

  const isChecked = (val: string) => isAll || selected.includes(val);

  return (
    <div className={`relative flex items-center gap-1.5 ${className}`}>
      {triggerIcon}
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label={ariaLabel ?? `Filter by ${noun}`}
        aria-expanded={open}
        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm flex items-center gap-2"
      >
        <span>{label}</span>
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && pos && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="fixed bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg z-[9999] max-h-[400px] overflow-y-auto py-1"
            style={pos}
            role="listbox"
            aria-multiselectable
          >
            <button
              onClick={clearAll}
              className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
            >
              <span className="font-medium">{allLabel}</span>
              {isAll && <Check className="w-4 h-4 text-[rgb(126,34,206)] dark:text-purple-400" />}
            </button>
            <div className="border-t border-gray-200 dark:border-gray-600 my-1" />
            {options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                No {noun} in the current data.
              </div>
            ) : (
              options.map(opt => {
                const checked = isChecked(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    role="option"
                    aria-selected={checked}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                  >
                    <span className="flex items-center gap-2">
                      {opt.icon}
                      <span>{opt.label}</span>
                    </span>
                    {checked && <Check className="w-4 h-4 text-[rgb(126,34,206)] dark:text-purple-400" />}
                  </button>
                );
              })
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};
