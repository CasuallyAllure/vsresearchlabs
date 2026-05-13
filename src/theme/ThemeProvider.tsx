/**
 * ThemeProvider
 * Phase 2 — VS Research Labs Design System
 *
 * Runtime theme provider. Sets theme identity attributes on :root and
 * exposes theme context for components. CSS variable values are defined
 * in src/theme/theme.css (Phase 1) — this provider does not redefine them.
 *
 * Persists user preference to localStorage. Honors system color-scheme
 * preference on first load when no explicit prop or stored value exists.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// ============================================================================
// Types
// ============================================================================

export type ThemeMode = 'dark' | 'light';
export type ThemeFamily = 'classy';
export type ThemePresetId = 'classy-dark' | 'classy-light';

export interface ThemeContextValue {
  themeId: ThemePresetId;
  mode: ThemeMode;
  family: ThemeFamily;
  setTheme: (id: ThemePresetId) => void;
  toggleMode: () => void;
  cssVar: (name: string) => string;
}

// ============================================================================
// Constants
// ============================================================================

const THEME_STORAGE_KEY = 'vsresearchlabs-theme-preference';
const DEFAULT_THEME_ID: ThemePresetId = 'classy-dark';

const VALID_THEME_IDS: readonly ThemePresetId[] = ['classy-dark', 'classy-light'];

function isValidThemeId(value: string | null): value is ThemePresetId {
  return value !== null && (VALID_THEME_IDS as readonly string[]).includes(value);
}

function parseThemeId(id: ThemePresetId): { family: ThemeFamily; mode: ThemeMode } {
  const [family, mode] = id.split('-') as [ThemeFamily, ThemeMode];
  return { family, mode };
}

// ============================================================================
// Initial Theme Resolution (zero-flicker)
// ============================================================================

function getInitialThemeId(initial?: ThemePresetId): ThemePresetId {
  if (initial && isValidThemeId(initial)) return initial;

  if (typeof window === 'undefined') return DEFAULT_THEME_ID;

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidThemeId(stored)) return stored;
  } catch {
    /* localStorage unavailable */
  }

  try {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'classy-dark' : 'classy-light';
  } catch {
    return DEFAULT_THEME_ID;
  }
}

// ============================================================================
// DOM Application
// ============================================================================

function applyThemeToRoot(themeId: ThemePresetId): void {
  if (typeof document === 'undefined') return;

  const { family, mode } = parseThemeId(themeId);
  const root = document.documentElement;

  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-theme-mode', mode);
  root.setAttribute('data-theme-family', family);
  root.style.setProperty('--theme-id', `"${themeId}"`);
  root.style.setProperty('--theme-mode', `"${mode}"`);
  root.style.setProperty('--theme-family', `"${family}"`);
}

// ============================================================================
// Context
// ============================================================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export function useThemeSafe(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

// ============================================================================
// Provider
// ============================================================================

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: ThemePresetId;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemePresetId>(() =>
    getInitialThemeId(initialTheme)
  );

  const { family, mode } = useMemo(() => parseThemeId(themeId), [themeId]);

  // Apply theme to :root and persist on every change
  useEffect(() => {
    applyThemeToRoot(themeId);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
      /* localStorage unavailable */
    }
  }, [themeId]);

  // React to OS-level color scheme changes when user has no explicit preference
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (!stored) {
        setThemeId(e.matches ? 'classy-dark' : 'classy-light');
      }
    };

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const setTheme = useCallback((id: ThemePresetId) => {
    if (isValidThemeId(id)) {
      setThemeId(id);
    }
  }, []);

  const toggleMode = useCallback(() => {
    setThemeId((current) => {
      const { family: currentFamily, mode: currentMode } = parseThemeId(current);
      const nextMode: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';
      return `${currentFamily}-${nextMode}` as ThemePresetId;
    });
  }, []);

  const cssVar = useCallback((name: string): string => {
    const cleaned = name.startsWith('--') ? name.slice(2) : name;
    return `var(--${cleaned})`;
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      mode,
      family,
      setTheme,
      toggleMode,
      cssVar,
    }),
    [themeId, mode, family, setTheme, toggleMode, cssVar]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
