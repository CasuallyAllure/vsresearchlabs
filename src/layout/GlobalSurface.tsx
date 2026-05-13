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
      className={`min-h-screen w-full bg-base-900 text-text-primary ${className}`.trim()}
    >
      {children}
    </div>
  );
}
