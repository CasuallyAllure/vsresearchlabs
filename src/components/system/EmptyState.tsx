/**
 * EmptyState — R7
 *
 * Procedural empty-state primitive. Used wherever a query, filter, or
 * data set yields zero results. Posture is institutional and operational —
 * no illustration, no emoji, no conversational copy.
 *
 * `role="status"` implies `aria-live="polite"` — the message announces
 * when the element enters the DOM, which covers filter-change transitions
 * without requiring a separate live region on the container.
 *
 * Spacing: `py-[var(--space-12)]` preserves the approximate density of a
 * populated list so the layout does not collapse to a void. Callers can
 * override via `className` if the context warrants a different rhythm.
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  /** Primary operational message. Keep procedural: "No matching inventory." */
  label: string;
  /** Optional mono caption — archive context, counts, identifiers. */
  meta?: string;
  /** Optional action region — quiet text link or button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ label, meta, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn('py-[var(--space-12)]', className)}
    >
      <p className="text-sm text-white/50">{label}</p>
      {meta && (
        <p className="mt-[var(--space-2)] text-[11px] font-mono tabular-nums text-white/30">
          {meta}
        </p>
      )}
      {action && (
        <div className="mt-[var(--space-4)]">{action}</div>
      )}
    </div>
  );
}
