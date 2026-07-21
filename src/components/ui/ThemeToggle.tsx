/**
 * ThemeToggle — an extremely small split-disc color swatch.
 *
 * The disc shows the *live* palette: left half = page surface, right half =
 * primary content. So it reads cream│ink in light, black│silver in dark, and
 * graphite│bone in lab — a literal swatch of the current theme. A small dot
 * at the top uses the accent-gold token, which resolves to warm amber only
 * in lab, so lab reads as visibly distinct from dark at this size. Clicking
 * cycles lab → light → dark → lab; the disc does a mechanical rotation
 * (reduced-motion users get an instant swap).
 *
 * Sits in the header's left cluster, just after the hamburger.
 */

import { useTheme, type ThemeMode } from '../../hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  /** Diameter of the swatch disc in px. Kept small by design. */
  size?: number;
}

// Rotation position per theme — one 3-way dial, 120° apart.
const ROTATION: Record<ThemeMode, number> = {
  lab: 0,
  light: 120,
  dark: 240,
};

// What clicking will switch to, for the button's label.
const NEXT_THEME_LABEL: Record<ThemeMode, string> = {
  lab: 'light',
  light: 'dark',
  dark: 'lab',
};

export function ThemeToggle({ className = '', size = 15 }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${NEXT_THEME_LABEL[theme]} mode`}
      title={`${theme.charAt(0).toUpperCase()}${theme.slice(1)} mode`}
      className={`shrink-0 p-2 text-ink/70 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{
          transform: `rotate(${ROTATION[theme]}deg)`,
          transition: 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Page-surface half (full disc, surface fill). */}
        <circle cx="12" cy="12" r="9" fill="var(--color-surface-base)" />
        {/* Content half — right semicircle, primary content fill. */}
        <path d="M12 3 A9 9 0 0 1 12 21 Z" fill="var(--color-content-primary)" />
        {/* Hairline ring + crisp divider — the "machined edge". */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth="1.4"
        />
        <line
          x1="12"
          y1="3"
          x2="12"
          y2="21"
          stroke="var(--color-border-strong)"
          strokeWidth="1.1"
        />
        {/* Lab indicator — accent-gold resolves to warm amber only in lab
            (light/dark keep it brushed silver), so this dot is the third
            swatch state's tell at a glance. */}
        <circle cx="12" cy="4.6" r="1.6" fill="var(--color-accent-gold)" />
      </svg>
    </button>
  );
}
