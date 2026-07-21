/**
 * Logo — canonical VS Research Labs identity lockup.
 *
 * Built on the locked brand system (see public/brand/):
 *   • dna-v-symbol.svg  — the primary DNA·V monogram mark (gold→teal helix
 *                         + the three orbiting bodies). Self-colored, so it
 *                         reads correctly on the cream page without recolor.
 *   • Cormorant Garamond wordmark ("VS Research Labs") — classical, editorial.
 *   • IBM Plex Mono tagline ("BioPeptide Sciences · Nootropics · Skin-Care").
 *
 * Variants:
 *   mark     — symbol only (favicon-scale, compact contexts)
 *   lockup   — mark + wordmark on one row, tagline beneath the wordmark
 *   stacked  — mark centered above the wordmark (footer / stamps / cards)
 */

import { Link } from 'react-router-dom';
import { siteConfig } from '../../config';
import { DnaVMark } from './DnaVMark';

type LogoVariant = 'mark' | 'lockup' | 'stacked';

interface LogoProps {
  variant?: LogoVariant;
  /** Route to link to. Pass null to render without a link. */
  to?: string | null;
  /** Mark height in px. */
  markSize?: number;
  /** Wordmark font-size in px (lockup/stacked). */
  wordSize?: number;
  showTagline?: boolean;
  /** Enclose the V mark in a gold seal ring (badge treatment). */
  circled?: boolean;
  /** Use the inverted mark + light wordmark for dark surfaces. */
  dark?: boolean;
  className?: string;
  ariaLabel?: string;
}

// Brand strings live in siteConfig (white-label layer). The visible wordmark
// may omit part of the name the mark carries; the accessible name stays full.
const BRAND_NAME = siteConfig.brand.name;
const BRAND_WORDMARK = siteConfig.brand.wordmark;
const BRAND_TAGLINE = siteConfig.brand.tagline;

export function Logo({
  variant = 'lockup',
  to = '/',
  markSize = 30,
  wordSize = 17,
  showTagline = false,
  circled = false,
  dark = false,
  className = '',
  ariaLabel = `${BRAND_NAME} — Home`,
}: LogoProps) {
  const mark = dark ? (
    <img
      src="/brand/vs-dna-s-inverted.svg"
      alt=""
      aria-hidden="true"
      width={markSize}
      height={markSize}
      style={{ width: markSize, height: markSize }}
      className="shrink-0 select-none"
      draggable={false}
    />
  ) : (
    // Inline, so the three bodies can swing + glow on hover.
    <DnaVMark size={markSize} ring={circled} />
  );

  const wordmark = (
    <span
      className={`font-serif font-medium uppercase leading-none whitespace-nowrap ${dark ? 'text-base-900' : 'text-ink'}`}
      style={{ fontSize: wordSize, letterSpacing: '0.2em' }}
    >
      {BRAND_WORDMARK}
    </span>
  );

  const tagline = showTagline ? (
    <span
      className="font-mono uppercase leading-none text-ink/55 whitespace-nowrap"
      style={{ fontSize: Math.max(6, wordSize * 0.34), letterSpacing: '0.16em' }}
    >
      {BRAND_TAGLINE}
    </span>
  ) : null;

  let body: React.ReactNode;
  if (variant === 'mark') {
    body = mark;
  } else if (variant === 'stacked') {
    // The mark's SVG carries whitespace below the "V"; the negative margin
    // pulls the wordmark up into it so there isn't a dead gap under the mark.
    body = (
      <span className="flex flex-col items-center gap-0 min-w-0">
        {mark}
        <span className={`flex flex-col items-center gap-1 min-w-0 ${circled ? 'mt-[3px]' : '-mt-[7px]'}`}>
          {wordmark}
          {tagline}
        </span>
      </span>
    );
  } else {
    // lockup — mark beside the [wordmark + tagline] column, so the tagline
    // sits directly (centered) under the wordmark. The mark's SVG carries
    // whitespace on its right edge; the negative margin pulls the wordmark
    // back into it so the two read as one tight unit.
    body = (
      <span className="flex items-center min-w-0">
        {mark}
        <span
          className="flex flex-col items-center gap-1 min-w-0"
          style={{ marginLeft: circled ? `${Math.round(markSize * 0.12)}px` : `-${Math.round(markSize * 0.16)}px` }}
        >
          {wordmark}
          {tagline}
        </span>
      </span>
    );
  }

  if (to === null) {
    return (
      <span className={`logo-hover-group ${className}`} aria-label={ariaLabel}>
        {body}
      </span>
    );
  }

  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className={`logo-hover-group inline-flex items-center min-w-0 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 ${className}`}
    >
      {body}
    </Link>
  );
}
