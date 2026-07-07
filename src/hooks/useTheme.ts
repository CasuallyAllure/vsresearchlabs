/**
 * useTheme — light / "black & silver" dark mode.
 *
 * Single source of truth for the active palette. The actual colors live in
 * src/theme/theme.css (`:root` = light, `html[data-theme="dark"]` = dark);
 * this hook only owns the *mode* and persists the user's choice.
 *
 * No-flash: index.html sets `data-theme` before first paint from the same
 * localStorage key, so the page never flickers light → dark on load. This
 * hook reads that already-applied attribute as its initial state.
 */

import { useCallback, useEffect, useState } from 'react';
import { siteConfig } from '../config';

export type ThemeMode = 'light' | 'dark';

// Must match the no-flash boot script in index.html, which cannot import this.
const THEME_KEY = siteConfig.storage.themeKey;
const DEFAULT_THEME: ThemeMode = 'light';

// Page chrome color for the mobile browser UI, per mode.
const THEME_COLOR: Record<ThemeMode, string> = {
  light: '#F4EFE6',
  dark: '#0C0C0D',
};

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private mode / SSR) — fall through */
  }
  return DEFAULT_THEME;
}

/** Read whatever the boot script already applied, falling back to storage. */
function readInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return 'dark';
    if (attr === 'light') return 'light';
  }
  return readStoredTheme();
}

/** Apply a theme to the document and persist it. Safe to call repeatedly. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);

  try {
    localStorage.setItem(THEME_KEY, theme);
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
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, isDark: theme === 'dark', toggleTheme, setTheme };
}
