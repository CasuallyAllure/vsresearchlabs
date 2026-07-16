/**
 * Brand tokens mirrored from src/theme/theme.css (light theme values).
 * The site's "--color-accent-gold-*" tokens are brushed silver under the
 * monochrome direction — named by role here to avoid confusion.
 */
import { loadFont as loadCormorant } from '@remotion/google-fonts/CormorantGaramond';
import { loadFont as loadPlexMono } from '@remotion/google-fonts/IBMPlexMono';

export const COLORS = {
  cream: '#F4EFE6', // --color-surface-base
  creamElevated: '#FBF9F4', // --color-surface-elevated
  creamSunken: '#ECE6DA', // --color-surface-sunken
  ink: '#1A1714', // --color-content-primary
  inkSecondary: '#6B635A', // --color-content-secondary
  inkTertiary: '#9A9186', // --color-content-tertiary
  silver: '#9AA0A6', // --color-accent-gold
  silverLight: '#B9BCC0', // --color-accent-gold-light
  silverDark: '#6C7176', // --color-accent-gold-dark
  plate: '#16130F', // --color-display-base
  plateElevated: '#211C16', // --color-display-elevated
  complianceRed: '#B23A3A', // --color-status-error
} as const;

const cormorant = loadCormorant('normal', {
  weights: ['500', '600'],
  subsets: ['latin'],
});
const plexMono = loadPlexMono('normal', {
  weights: ['400', '500'],
  subsets: ['latin'],
});

export const SERIF = cormorant.fontFamily;
export const MONO = plexMono.fontFamily;

/** The brushed-metal gradient used for the "Peptides Explained" series mark. */
export const SILVER_GRADIENT = `linear-gradient(90deg, ${COLORS.silverDark}, ${COLORS.silverLight} 50%, ${COLORS.silverDark})`;
