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

export interface PillTab {
  id: string;
  label: ReactNode;
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
        'inline-flex items-center flex-wrap gap-1 p-1.5',
        'bg-white/[0.04] backdrop-blur-sm border border-white/[0.09] rounded-xl',
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              if (!isActive) onChange(tab.id);
            }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs transition-all duration-150',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40',
              isActive
                ? 'bg-holo/[0.12] text-holo-light font-medium border border-holo/30'
                : 'text-white/55 font-normal hover:text-holo-light border border-transparent',
            )}
            style={
              isActive
                ? {
                    boxShadow:
                      '0 0 8px rgba(100, 200, 255, 0.28), inset 0 0 6px rgba(100, 200, 255, 0.08)',
                  }
                : undefined
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
