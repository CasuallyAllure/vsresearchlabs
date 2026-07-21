/**
 * useTheme — lab (default) / light / "black & silver" dark mode.
 *
 * Single source of truth for the active palette. The actual colors live in
 * src/theme/theme.css (`:root` = light, `html[data-theme="dark"]` = dark,
 * `html[data-theme="lab"]` = lab); this hook only owns the *mode* and
 * persists the user's choice for the current tab session.
 *
 * No-flash: index.html sets `data-theme` before first paint from the same
 * sessionStorage key, so the page never flickers on load. This hook reads
 * that already-applied attribute as its initial state. Every fresh tab
 * starts back on lab — the swatch choice doesn't outlive the session.
 */

import { useCallback, useEffect, useState } from 'react';
import { siteConfig } from '../config';

export type ThemeMode = 'light' | 'dark' | 'lab';

// Must match the no-flash boot script in index.html, which cannot import this.
const THEME_KEY = siteConfig.storage.themeKey;
const DEFAULT_THEME: ThemeMode = 'lab';

// Page chrome color for the mobile browser UI, per mode.
const THEME_COLOR: Record<ThemeMode, string> = {
  light: '#F4EFE6',
  dark: '#0C0C0D',
  lab: '#12100D',
};

// 3-way cycle order: lab (client default) → light → dark → lab.
const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
  lab: 'light',
  light: 'dark',
  dark: 'lab',
};

function readStoredTheme(): ThemeMode {
  try {
    const stored = sessionStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'lab') return stored;
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — fall through */
  }
  return DEFAULT_THEME;
}

/** Read whatever the boot script already applied, falling back to storage. */
function readInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return 'dark';
    if (attr === 'light') return 'light';
    if (attr === 'lab') return 'lab';
  }
  return readStoredTheme();
}

/** Apply a theme to the document and persist it. Safe to call repeatedly. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;

  document.documentElement.setAttribute('data-theme', theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);

  try {
    sessionStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore persistence failures */
  }
}

interface UseThemeResult {
  theme: ThemeMode;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);

  // Keep the document in sync if state changes from anywhere.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => NEXT_THEME[prev]);
  }, []);

  return { theme, isDark: theme !== 'light', toggleTheme, setTheme };
}
