/**
 * CatalogFeatureRow — the rail the catalog's featured-supply modules sit in.
 *
 * Desktop (sm+): a plain two-up flex row, equal columns, tops and heights
 * aligned. Below sm: a horizontally swipeable CSS scroll-snap carousel — no
 * carousel library, no JS. Children carry their own slide width via
 * {@link FEATURE_SLIDE}.
 *
 * Accessibility: a scrollable container needs to be reachable and operable
 * without a pointer, so the rail is a labelled `region` with `tabIndex={0}`
 * (focus it, then arrow-key the scroll) and a visible focus ring. Dot
 * indicators are deliberately omitted — non-interactive dots would be
 * decoration pretending to be a control. Smooth snapping is disabled under
 * `prefers-reduced-motion` (see `.catalog-feature-row` in theme.css).
 */

import type { ReactNode } from 'react';

/** Slide sizing for a direct child: one peeking card below sm, an equal
 *  column of the two-up row at sm and above. */
export const FEATURE_SLIDE = 'w-[86%] shrink-0 snap-center sm:w-auto sm:flex-1 sm:shrink';

interface CatalogFeatureRowProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function CatalogFeatureRow({ label, children, className = '' }: CatalogFeatureRowProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`catalog-feature-row -mx-[var(--space-2)] flex snap-x snap-mandatory items-stretch gap-[var(--space-4)] overflow-x-auto px-[var(--space-2)] pb-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 sm:mx-0 sm:snap-none sm:overflow-x-visible sm:px-0 sm:pb-0 ${className}`}
    >
      {children}
    </div>
  );
}
