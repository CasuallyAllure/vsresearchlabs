/**
 * AnimatedPortalShell
 * Phase 3 — VS Research Labs App Shell
 * Reconciliation Pass B — Motion neutralization.
 *
 * Wraps page content with the constrained content column. Originally
 * applied a Framer Motion entrance/exit animation on every route
 * change; that motion has been removed because narrative route
 * transitions communicate "consumer app" rather than "procurement
 * instrument." The wrapper is now a static <main> that swaps content
 * instantly on navigation.
 *
 * The "Animated" prefix in the component name is historical and is
 * preserved to avoid an App-level rename. The component no longer
 * animates and should not be re-instrumented with route-level motion
 * unless the system's procurement register changes.
 *
 * Padding clears the sticky <GlobalHeader /> at top. Bottom padding
 * is intentionally modest — <GlobalFooter /> renders as a sibling
 * after this main and owns the fixed <BottomNav /> clearance on
 * mobile, so this shell only needs visual breathing room before the
 * footer hairline.
 */

import type { ReactNode } from 'react';

interface AnimatedPortalShellProps {
  children: ReactNode;
}

export function AnimatedPortalShell({ children }: AnimatedPortalShellProps) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-[1100px] pt-2 pb-[var(--space-8)] px-[var(--space-6)]">
      {children}
    </main>
  );
}
