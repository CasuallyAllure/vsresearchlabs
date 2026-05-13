/**
 * AnimatedPortalShell
 * Phase 3 — VS Research Labs App Shell
 *
 * Wraps page content with a Framer Motion entrance animation. Animates
 * on route key changes via AnimatePresence. Padding clears the sticky
 * <GlobalHeader /> at top and the fixed <BottomNav /> at bottom.
 *
 * Animation timing and easing are sourced from theme tokens
 * (`--duration-normal`, `--ease-exit`) defined in src/theme/theme.css.
 * No hardcoded millisecond or cubic-bezier values appear in this file.
 */

import { useMemo, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Token Resolution
// ---------------------------------------------------------------------------

/**
 * Read a CSS custom property from :root. Returns the trimmed string
 * value or null if unavailable (SSR / unset).
 */
function readRootToken(name: string): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : null;
}

/**
 * Convert a duration token (e.g. "250ms" or "0.25s") to seconds
 * (Framer Motion expects seconds).
 */
function parseDurationSeconds(raw: string | null, fallbackSeconds: number): number {
  if (!raw) return fallbackSeconds;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith('ms')) {
    const n = parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(n) ? n / 1000 : fallbackSeconds;
  }
  if (trimmed.endsWith('s')) {
    const n = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(n) ? n : fallbackSeconds;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : fallbackSeconds;
}

/**
 * Parse a `cubic-bezier(a,b,c,d)` token into a 4-tuple of numbers
 * suitable for Framer Motion's `ease` prop. Returns the fallback
 * ease tuple if parsing fails or the token is a named keyword.
 */
function parseCubicBezier(
  raw: string | null,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  if (!raw) return fallback;
  const match = raw.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i);
  if (!match) return fallback;
  const nums = match.slice(1, 5).map(parseFloat);
  if (nums.some((n) => !Number.isFinite(n))) return fallback;
  return nums as [number, number, number, number];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AnimatedPortalShellProps {
  children: ReactNode;
}

export function AnimatedPortalShell({ children }: AnimatedPortalShellProps) {
  const location = useLocation();

  const transition = useMemo(() => {
    // Fallbacks mirror the values defined in theme.css so SSR / first
    // paint behave identically to the resolved-token path.
    const duration = parseDurationSeconds(readRootToken('--duration-normal'), 0.25);
    const ease = parseCubicBezier(readRootToken('--ease-exit'), [0.16, 1, 0.3, 1]);
    return { duration, ease };
  }, []);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={location.pathname}
        className="mx-auto w-full max-w-[1100px] pt-2 pb-24 px-[var(--space-6)]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={transition}
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}
