/**
 * ErrorState — R7
 *
 * Procedural error-state primitive. Used wherever a data fetch, lookup,
 * or system operation fails. Posture is operationally calm — no red
 * alert theatrics, no giant warning iconography, no dramatic language.
 *
 * `role="alert"` implies `aria-live="assertive"` and `aria-atomic="true"` —
 * screen readers announce the message immediately when the element enters
 * the DOM, which is appropriate for system-level failure states.
 *
 * The "System Notice" eyebrow provides procedural framing without visual
 * aggression. The message is rendered in white/55 — slightly brighter
 * than empty-state copy to signal it requires attention.
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ErrorStateProps {
  /** Operational failure message. Keep concise: "Record could not be resolved." */
  message: string;
  /** Optional action — quiet navigation link or retry trigger. */
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ message, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('py-[var(--space-8)]', className)}
    >
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/30 mb-[var(--space-2)]">
        System Notice
      </p>
      <p className="text-sm text-white/55">{message}</p>
      {action && (
        <div className="mt-[var(--space-4)]">{action}</div>
      )}
    </div>
  );
}
