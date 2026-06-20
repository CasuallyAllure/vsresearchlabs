/**
 * ThemeToggle — an extremely small split-disc color swatch.
 *
 * The disc shows the *live* palette: left half = page surface, right half =
 * primary content. So it reads cream│ink in light, and black│silver in dark —
 * a literal swatch of the current theme. Clicking flips the mode; the disc
 * does a mechanical 180° rotation (reduced-motion users get an instant swap).
 *
 * Sits in the header's left cluster, just after the hamburger.
 */

import { useTheme } from '../../hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  /** Diameter of the swatch disc in px. Kept small by design. */
  size?: number;
}

export function ThemeToggle({ className = '', size = 15 }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={`shrink-0 p-2 text-ink/70 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{
          transform: isDark ? 'rotate(180deg)' : 'rotate(0deg)',
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
      </svg>
    </button>
  );
}
