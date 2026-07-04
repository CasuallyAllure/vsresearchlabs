/**
 * PillTabs
 * Wave 3 — App-Native Filter / Tab Switcher
 *
 * Research-adapted transplant per docs/EXECUTION_MAP.md §Wave 3.
 * Renders a horizontal pill-shaped tab control with a single active
 * selection. The container is a flat-frosted bar; the active pill is
 * a brighter surface; inactive pills are muted text only.
 *
 * Surface values are research-calibrated (lower intensity than the
 * VelariNights original). Blur stays at `backdrop-blur-sm` (4px) which
 * sits below the `--blur-precision` 8px cap.
 *
 * Accessibility:
 *   - The pill bar uses the ARIA tabs pattern (`role="tablist"`,
 *     `role="tab"`, `aria-selected`).
 *   - Selection is keyboard-operable via native button activation
 *     (Enter / Space). Arrow-key tab navigation is intentionally not
 *     implemented in Wave 3 — out of scope.
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip } from './Tooltip';

export interface PillTab {
  id: string;
  label: ReactNode;
  /** Optional definition / explanatory text shown on hover & keyboard
   *  focus. Plain string so it can be rendered inside a Tooltip. */
  tooltip?: string;
}

interface PillTabsProps {
  tabs: PillTab[];
  activeId: string;
  onChange: (id: string) => void;
  /** Optional accessible label for the tablist. */
  ariaLabel?: string;
  /** Optional className applied to the outer container. */
  className?: string;
}

export function PillTabs({
  tabs,
  activeId,
  onChange,
  ariaLabel,
  className,
}: PillTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        // Single scrollable row on phones instead of wrapping into stacked
        // rows; scrolls horizontally when the tabs exceed the width.
        'flex items-center flex-nowrap gap-1 p-1 max-w-full overflow-x-auto',
        'bg-ink/[0.04] border border-ink/[0.09] rounded-xl',
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const button = (
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-describedby={tab.tooltip ? `tt-${tab.id}` : undefined}
            onClick={() => {
              if (!isActive) onChange(tab.id);
            }}
            className={cn(
              'shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg text-[11px] transition-colors duration-150',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/45',
              isActive
                ? 'bg-gold/[0.16] text-ink font-medium border border-gold/45'
                : 'text-ink/55 font-normal hover:text-ink border border-transparent',
            )}
          >
            {tab.label}
          </button>
        );
        return tab.tooltip ? (
          <Tooltip key={tab.id} content={tab.tooltip} ariaId={`tt-${tab.id}`}>
            {button}
          </Tooltip>
        ) : (
          <span key={tab.id}>{button}</span>
        );
      })}
    </div>
  );
}
