/**
 * Color theme switcher — non-destructive.
 *
 * Themes are applied as a `data-theme` attribute on <html>, and the
 * actual recoloring is a single root-level CSS filter (see index.css).
 * Because the filter sits on the ROOT element, it does NOT create a
 * containing block for fixed descendants, so the sticky header, bottom
 * nav, drawers, and modals keep their positioning. Clearing the
 * attribute restores the original design exactly.
 *
 *   default  — the shipped dark + holo palette (no filter)
 *   negative — invert + hue-rotate: a true negative of the site
 *   gray     — invert + grayscale: a light "90s computer" monochrome
 */

import { useCallback, useState } from 'react';

export type ThemeId = 'default' | 'negative' | 'gray';

export const THEME_ORDER: ThemeId[] = ['default', 'negative', 'gray'];

export const THEME_LABELS: Record<ThemeId, string> = {
  default: 'Default',
  negative: 'Negative',
  gray: 'Grayscale',
};

const STORAGE_KEY = 'vsr.theme';

export function getStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'negative' || v === 'gray') return v;
  } catch {
    /* ignore */
  }
  return 'default';
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'default') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function nextTheme(theme: ThemeId): ThemeId {
  const i = THEME_ORDER.indexOf(theme);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length];
}

/** React hook: current theme + a cycler that advances to the next one. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => getStoredTheme());
  const cycle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      applyTheme(next);
      return next;
    });
  }, []);
  return { theme, cycle };
}
