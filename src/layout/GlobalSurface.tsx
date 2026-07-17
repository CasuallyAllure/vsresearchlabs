/**
 * GlobalSurface
 * Phase 3 — VS Research Labs App Shell
 *
 * Root visual container for the app shell. Provides the full-bleed
 * background (viewport-spanning) and base text color only. Children
 * control their own width: a hero may render edge-to-edge, while
 * AnimatedPortalShell applies the constrained content column for pages.
 */

import type { ReactNode } from 'react';

interface GlobalSurfaceProps {
  children: ReactNode;
  className?: string;
}

export function GlobalSurface({ children, className = '' }: GlobalSurfaceProps) {
  return (
    <div
      className={`relative isolate min-h-[100dvh] w-full bg-base-900 text-text-primary ${className}`.trim()}
    >
      {/* Top light-leaks — brand-colored shafts bleeding down behind all
          content, lifting modules off the background. Decorative only. */}
      <div aria-hidden="true" className="vsr-light-leaks" />
      {children}
    </div>
  );
}
