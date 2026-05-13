/**
 * ThemeTuningProvider
 * Phase 2 — VS Research Labs Design System
 *
 * Pass-through provider for runtime theme tuning (glass intensity,
 * module density, accent strength, roundedness). Heavy logic deferred
 * to a later phase — this scaffold provides the context shape and
 * stable defaults so consumers can wire up early without breaking when
 * tuning is enabled.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// ============================================================================
// Types
// ============================================================================

export type GlassIntensity = 'low' | 'medium' | 'high';
export type ModuleDensity = 'comfortable' | 'compact';
export type AccentStrength = 'subtle' | 'normal' | 'bold';
export type Roundedness = 'soft' | 'sharp';

export interface ThemeTuningState {
  glassIntensity: GlassIntensity;
  moduleDensity: ModuleDensity;
  accentStrength: AccentStrength;
  roundedness: Roundedness;

  setGlassIntensity: (v: GlassIntensity) => void;
  setModuleDensity: (v: ModuleDensity) => void;
  setAccentStrength: (v: AccentStrength) => void;
  setRoundedness: (v: Roundedness) => void;
  reset: () => void;
}

// ============================================================================
// Defaults
// ============================================================================

export const themeTuningDefaults = {
  glassIntensity: 'medium' as GlassIntensity,
  moduleDensity: 'comfortable' as ModuleDensity,
  accentStrength: 'normal' as AccentStrength,
  roundedness: 'soft' as Roundedness,
};

// ============================================================================
// Context
// ============================================================================

const ThemeTuningContext = createContext<ThemeTuningState | null>(null);

export function useThemeTuning(): ThemeTuningState {
  const ctx = useContext(ThemeTuningContext);
  if (!ctx) {
    throw new Error('useThemeTuning must be used within a ThemeTuningProvider');
  }
  return ctx;
}

export function useThemeTuningSafe(): ThemeTuningState | null {
  return useContext(ThemeTuningContext);
}

// ============================================================================
// Provider
// ============================================================================

interface ThemeTuningProviderProps {
  children: ReactNode;
}

export function ThemeTuningProvider({ children }: ThemeTuningProviderProps) {
  const [glassIntensity, setGlassIntensity] = useState<GlassIntensity>(
    themeTuningDefaults.glassIntensity
  );
  const [moduleDensity, setModuleDensity] = useState<ModuleDensity>(
    themeTuningDefaults.moduleDensity
  );
  const [accentStrength, setAccentStrength] = useState<AccentStrength>(
    themeTuningDefaults.accentStrength
  );
  const [roundedness, setRoundedness] = useState<Roundedness>(
    themeTuningDefaults.roundedness
  );

  const reset = useCallback(() => {
    setGlassIntensity(themeTuningDefaults.glassIntensity);
    setModuleDensity(themeTuningDefaults.moduleDensity);
    setAccentStrength(themeTuningDefaults.accentStrength);
    setRoundedness(themeTuningDefaults.roundedness);
  }, []);

  const value = useMemo<ThemeTuningState>(
    () => ({
      glassIntensity,
      moduleDensity,
      accentStrength,
      roundedness,
      setGlassIntensity,
      setModuleDensity,
      setAccentStrength,
      setRoundedness,
      reset,
    }),
    [glassIntensity, moduleDensity, accentStrength, roundedness, reset]
  );

  return (
    <ThemeTuningContext.Provider value={value}>
      {children}
    </ThemeTuningContext.Provider>
  );
}
