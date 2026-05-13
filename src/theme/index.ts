/**
 * Theme module barrel export
 * Phase 2 — VS Research Labs Design System
 */

export {
  ThemeProvider,
  useTheme,
  useThemeSafe,
  type ThemeContextValue,
  type ThemeMode,
  type ThemeFamily,
  type ThemePresetId,
} from './ThemeProvider';

export {
  ThemeTuningProvider,
  useThemeTuning,
  useThemeTuningSafe,
  themeTuningDefaults,
  type ThemeTuningState,
  type GlassIntensity,
  type ModuleDensity,
  type AccentStrength,
  type Roundedness,
} from './ThemeTuningProvider';
