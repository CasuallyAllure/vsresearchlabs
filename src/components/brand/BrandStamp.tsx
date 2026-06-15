/**
 * BrandStamp
 *
 * A standalone, static rendering of the VS Research Labs identity as a
 * "stamp" emblem — the header wordmark distilled into a single graphic
 * for documents: the inquiry/order receipt, the admin order detail, and
 * (rasterized) the invoice email.
 *
 * Design notes:
 *   - Ink uses `currentColor`, so the stamp adapts to its surface: dark
 *     ink on a white invoice, light ink on the dark app. Set color via
 *     the wrapping element (or the `tone` prop).
 *   - The three orbiting bodies (gold / teal / ink) are the one accent —
 *     the brand's "three body" mark (biopeptides · nootropics · skin-care).
 *   - No animation, no background-clip-text — intentionally print- and
 *     export-safe (unlike the live animated header wordmark).
 *
 * For the invoice EMAIL, do not import this component — email clients
 * strip SVG/animation. Use a hosted PNG export of `public/brand-stamp.svg`
 * (or the table-based HTML mark in the edge-function template).
 */

interface BrandStampProps {
  /** Rendered width in px (height scales with the 320×104 viewBox). */
  width?: number;
  /** Ink color. Defaults to `currentColor` so it inherits from the parent. */
  tone?: string;
  className?: string;
  /** Accessible label; set '' to mark purely decorative. */
  title?: string;
}

const BODY = { gold: '#B5904B', teal: '#34727A', ink: '#1A1714' };

export function BrandStamp({
  width = 240,
  tone = 'currentColor',
  className,
  title = 'VS Research Labs',
}: BrandStampProps) {
  const height = (width * 104) / 320;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 320 104"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ color: tone }}
    >
      {/* Stamp frame — double hairline rounded rectangle */}
      <rect x="3" y="3" width="314" height="98" rx="8"
        stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.25" />
      <rect x="8" y="8" width="304" height="88" rx="5"
        stroke="currentColor" strokeOpacity="0.22" strokeWidth="0.75" />

      {/* Corner registration ticks — instrument cue */}
      {([
        [14, 16, 1, 0], [306, 16, -1, 0], [14, 88, 1, 0], [306, 88, -1, 0],
      ] as const).map(([x, y, dx], i) => (
        <g key={i} stroke="currentColor" strokeOpacity="0.4" strokeWidth="1">
          <line x1={x} y1={y} x2={x + dx * 7} y2={y} />
          <line x1={x} y1={y - 5} x2={x} y2={y + 5} />
        </g>
      ))}

      {/* Top micro caption */}
      <text x="160" y="26" textAnchor="middle" fill="currentColor" fillOpacity="0.5"
        fontFamily="'IBM Plex Mono', ui-monospace, monospace" fontSize="6.5"
        letterSpacing="3" style={{ textTransform: 'uppercase' }}>
        Research-Grade · Bay Area · California
      </text>

      {/* Wordmark row: VS RESEARCH LABS (Cormorant serif) + three bodies */}
      <text x="150" y="57" textAnchor="middle" fill="currentColor"
        fontFamily="'Cormorant Garamond', 'Times New Roman', Georgia, serif"
        fontSize="25" fontWeight="600" letterSpacing="2"
        style={{ textTransform: 'uppercase' }}>
        VS Research Labs
      </text>

      {/* Three bodies — the single accent, sized to the wordmark cap height */}
      <g transform="translate(262, 40) scale(0.24)">
        <g fill="none" stroke="currentColor" strokeOpacity="0.4" strokeLinecap="round">
          <ellipse cx="50" cy="52" rx="36" ry="21.5" transform="rotate(-20 50 52)" strokeWidth="2.6" />
          <ellipse cx="53" cy="47" rx="25" ry="38" transform="rotate(33 53 47)" strokeWidth="2.2" />
        </g>
        <circle cx="59" cy="14" r="3.1" fill={BODY.ink} fillOpacity="0.55" />
        <circle cx="25" cy="63" r="4.7" fill={BODY.teal} />
        <circle cx="82" cy="43" r="7" fill={BODY.gold} />
      </g>

      {/* Divider hairline */}
      <line x1="70" y1="68" x2="250" y2="68" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.75" />

      {/* Sub-caption */}
      <text x="160" y="82" textAnchor="middle" fill="currentColor" fillOpacity="0.62"
        fontFamily="'IBM Plex Mono', ui-monospace, monospace" fontSize="6.5"
        letterSpacing="2.4" style={{ textTransform: 'uppercase' }}>
        BioPeptide Sciences · Nootropics · Skin-Care
      </text>

      {/* Bottom micro disclaimer */}
      <text x="160" y="93.5" textAnchor="middle" fill="currentColor" fillOpacity="0.4"
        fontFamily="'IBM Plex Mono', ui-monospace, monospace" fontSize="5.5"
        letterSpacing="2.2" style={{ textTransform: 'uppercase' }}>
        For Research Use Only · Not For Human Consumption
      </text>
    </svg>
  );
}
