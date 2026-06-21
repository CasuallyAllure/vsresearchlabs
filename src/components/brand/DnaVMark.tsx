/**
 * DnaVMark — inline, animatable version of the DNA·V monogram.
 *
 * Identical art to /brand/vs-dna-s-full-colour.svg, inlined so the three
 * orbiting "bodies" are live DOM. The bodies orbit a shared center
 * CONTINUOUSLY (one reversed, all at different tempos — a three-body weave);
 * clicking the mark toggles the motion (stop / resume) without navigating.
 *
 * The three body circles are pre-transformed into view-box coordinates and
 * rotate around a single common center via `transform-box: view-box`.
 * Respects prefers-reduced-motion (motion off; mark stays static).
 */

import { useId, useState } from 'react';

interface DnaVMarkProps {
  size?: number;
  className?: string;
  /** When true, the mark is non-interactive — no click-to-pause, no
   *  cursor, no button semantics. Use inside loaders / decorative
   *  contexts where the mark should always be spinning. */
  static?: boolean;
  /** When set, the three bodies enter from a wider orbital radius and
   *  spiral inward to their resting orbits over this duration (ms).
   *  The mark itself (monogram, strand, rings) stays still and crisp —
   *  only the body positions animate. Runs once. */
  bodyEntryMs?: number;
  /** Intro-only reveal: when set, the V monogram starts hidden and rises
   *  in behind the bodies after this delay (ms) — so on first entry the
   *  three bodies + DNA strand "dance" alone first, then the V appears.
   *  Everything else (strand, rungs, rings, bodies) is visible from the
   *  start. Runs once; disabled under prefers-reduced-motion. */
  vRevealDelayMs?: number;
  /** Pin the V / orbit rings / body-1 to a fixed color, overriding the
   *  theme-driven default (`--color-content-primary`). Used by surfaces
   *  whose background does NOT follow the theme — e.g. the BrandLoader's
   *  always-cream vignette needs a black V in both light and dark. */
  inkColor?: string;
  /** Draw a seal ring enclosing the mark (V + orbits). Used by the header
   *  lockup to read the monogram as a badge. */
  ring?: boolean;
}

// Shared orbit center (view-box units) — the centroid of the three bodies.
const ORBIT = '67px 26px';

export function DnaVMark({ size = 60, className = '', static: isStatic = false, bodyEntryMs, vRevealDelayMs, inkColor, ring = false }: DnaVMarkProps) {
  const uid = useId().replace(/[:]/g, '');
  const grad = `sStrand-${uid}`;
  const [spinning, setSpinning] = useState(true);
  const isRunning = isStatic ? true : spinning;

  const bodyStyle = (delay: string) => ({
    transformBox: 'view-box' as const,
    transformOrigin: ORBIT,
    animationPlayState: isRunning ? ('running' as const) : ('paused' as const),
    animationDelay: delay,
  });

  return (
    <svg
      className={`dna-v-mark shrink-0 select-none ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      overflow="visible"
      style={{
        ...(inkColor ? { color: inkColor } : null),
        ...(isStatic ? null : { cursor: 'pointer' }),
      }}
      {...(isStatic
        ? { 'aria-hidden': true }
        : {
            role: 'button',
            'aria-label': spinning
              ? 'VS Research Labs — bodies orbiting (click to pause)'
              : 'VS Research Labs — orbit paused (click to resume)',
            onClick: (e: React.MouseEvent<SVGSVGElement>) => {
              e.preventDefault();
              e.stopPropagation();
              setSpinning((s) => !s);
            },
          })}
    >
      <defs>
        <linearGradient id={grad} gradientUnits="userSpaceOnUse" x1="66" y1="20" x2="66" y2="55">
          <stop offset="0" stopColor="#E1C57E" />
          <stop offset="0.55" stopColor="#C49A48" />
          <stop offset="1" stopColor="#A87D2D" />
        </linearGradient>
        {/* Metallic rim — top-lit gold band so the seal ring catches light. */}
        <linearGradient id={`rim-${uid}`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#E1C57E" />
          <stop offset="0.5" stopColor="#B5904B" />
          <stop offset="1" stopColor="#8C6A2A" />
        </linearGradient>
      </defs>

      {/* Mark body (V monogram + DNA strand + orbit rings + seal ring). On
          intro it starts hidden and rises in together — behind the three
          bodies, which dance ALONE first (they live outside this group). */}
      <g
        className={vRevealDelayMs ? 'dna-v-reveal' : undefined}
        style={
          vRevealDelayMs
            ? { transformBox: 'view-box', animationDelay: `${vRevealDelayMs}ms` }
            : undefined
        }
      >
      {/* Seal — a thin gold ring enclosing the mark. Inside the reveal group,
          so on the intro loader it appears together with the V (not during the
          balls-only phase). */}
      {ring && (
        <circle
          cx="51"
          cy="46"
          r="50"
          fill="none"
          stroke={`url(#rim-${uid})`}
          strokeWidth="1.4"
          strokeOpacity="0.8"
        />
      )}
      {/* V monogram — currentColor so it tracks --color-content-primary
          (near-black in light, silver in dark). */}
      <g fill="currentColor">
        <rect x="16.5" y="21.3" width="21.5" height="2.7" rx="0.6" />
        <path d="M21 23.5 L34 23.5 L50 62 L50 84.5 Z" />
        <path d="M50.75 84.79 L 51.77 82.52 L 52.80 80.25 L 53.82 77.98 L 54.85 75.71 L 55.87 73.44 L 56.90 71.17 L 57.92 68.90 L 58.95 66.63 L 59.97 64.35 L 60.99 62.08 L 62.02 59.81 L 63.04 57.54 L 64.07 55.27 L 65.09 53.00 L 59.87 51.00 L 59.11 53.37 L 58.35 55.74 L 57.59 58.11 L 56.83 60.49 L 56.08 62.86 L 55.32 65.23 L 54.56 67.60 L 53.80 69.98 L 53.04 72.35 L 52.29 74.72 L 51.53 77.10 L 50.77 79.47 L 50.01 81.84 L 49.25 84.21 Z" />
      </g>

      <path d="M61.52 54.50 L61.78 53.79 L62.01 53.06 L62.15 52.31 L62.20 51.52 L62.17 50.70 L62.08 49.85 L61.98 49.00 L61.94 48.18 L62.02 47.40 L62.29 46.69 L62.80 46.07 L63.56 45.56 L64.57 45.13 L65.78 44.79 L67.14 44.50 L68.53 44.22 L69.86 43.92 L71.03 43.56 L71.94 43.10 L72.52 42.51 L72.74 41.79 L72.66 40.94 L72.29 39.99 L71.68 38.95 L70.88 37.83 L69.94 36.65 L68.92 35.45 L67.90 34.25 L66.95 33.07 L66.12 31.95 L65.49 30.89 L65.10 29.93 L64.97 29.07 L65.15 28.33 L65.62 27.70 L66.39 27.18 L67.41 26.77 L68.66 26.44 L70.12 26.19 L71.67 25.97 L73.11 25.71 L74.39 25.39 L75.46 24.99 L76.28 24.50 L76.86 23.91 L77.20 23.23" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3">
        <path d="M61.38 38.22 L72.52 42.50" />
        <path d="M76.22 32.92 L65.04 28.63" />
      </g>

      {/* S strand (DNA, gold) */}
      <path d="M61.52 54.50 L61.80 53.80 L62.12 53.11 L62.52 52.45 L63.01 51.83 L63.58 51.24 L64.21 50.67 L64.85 50.11 L65.44 49.52 L65.90 48.89 L66.17 48.18 L66.21 47.38 L65.99 46.49 L65.52 45.50 L64.85 44.43 L64.04 43.31 L63.19 42.17 L62.40 41.06 L61.78 40.01 L61.41 39.06 L61.37 38.23 L61.69 37.54 L62.32 36.97 L63.23 36.51 L64.38 36.14 L65.73 35.85 L67.21 35.61 L68.77 35.39 L70.33 35.18 L71.83 34.95 L73.19 34.66 L74.37 34.30 L75.31 33.85 L75.97 33.30 L76.34 32.63 L76.41 31.84 L76.19 30.95 L75.70 29.95 L75.00 28.87 L74.08 27.71 L73.08 26.51 L72.18 25.35 L71.44 24.26 L70.92 23.25 L70.63 22.33 L70.60 21.50 L70.80 20.77" fill="none" stroke={`url(#${grad})`} strokeWidth="5.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.28" />
      <path d="M61.52 54.50 L61.80 53.80 L62.12 53.11 L62.52 52.45 L63.01 51.83 L63.58 51.24 L64.21 50.67 L64.85 50.11 L65.44 49.52 L65.90 48.89 L66.17 48.18 L66.21 47.38 L65.99 46.49 L65.52 45.50 L64.85 44.43 L64.04 43.31 L63.19 42.17 L62.40 41.06 L61.78 40.01 L61.41 39.06 L61.37 38.23 L61.69 37.54 L62.32 36.97 L63.23 36.51 L64.38 36.14 L65.73 35.85 L67.21 35.61 L68.77 35.39 L70.33 35.18 L71.83 34.95 L73.19 34.66 L74.37 34.30 L75.31 33.85 L75.97 33.30 L76.34 32.63 L76.41 31.84 L76.19 30.95 L75.70 29.95 L75.00 28.87 L74.08 27.71 L73.08 26.51 L72.18 25.35 L71.44 24.26 L70.92 23.25 L70.63 22.33 L70.60 21.50 L70.80 20.77" fill="none" stroke={`url(#${grad})`} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M76.80 23.08 L71.20 20.92" fill="none" stroke={`url(#${grad})`} strokeWidth="3" strokeLinecap="round" />

      {/* Orbit rings (static) */}
      <g transform="translate(34,1.5) scale(0.6)">
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <ellipse cx="50" cy="52" rx="36" ry="21.5" transform="rotate(-20 50 52)" opacity="0.30" strokeWidth="0.8" />
          <ellipse cx="53" cy="47" rx="25" ry="38" transform="rotate(33 53 47)" opacity="0.17" strokeWidth="0.7" />
        </g>
      </g>
      </g>

      {/* Three bodies — wrapped so they can optionally enter from a wider
          orbital radius and spiral inward. The wrapper scales the bodies'
          positions around the shared orbit center; the mark itself (V,
          strand, rings) is outside the wrapper so it never moves. */}
      <g
        className={bodyEntryMs ? 'dna-bodies-enter' : undefined}
        style={
          bodyEntryMs
            ? {
                transformBox: 'view-box',
                transformOrigin: ORBIT,
                animationDuration: `${bodyEntryMs}ms`,
              }
            : undefined
        }
      >
        <circle className="vsbody vsbody-1" cx="69.4" cy="9.9" r="1.86" fill="currentColor" opacity="0.5" style={bodyStyle('0s')} />
        <circle className="vsbody vsbody-2" cx="49" cy="39.3" r="2.82" fill="#34727A" opacity="0.9" style={bodyStyle('-1.2s')} />
        <circle className="vsbody vsbody-3" cx="83.2" cy="27.3" r="4.2" fill="#B5904B" opacity="1" style={bodyStyle('-0.6s')} />
      </g>

      <style>{`
        /* currentColor for the V / rings / body-1 tracks the active theme's
           primary content color: near-black in light, silver in dark. */
        .dna-v-mark { color: var(--color-content-primary); }
        .dna-v-mark .vsbody-1 { animation: vsbody-cw  7s  linear infinite; }
        .dna-v-mark .vsbody-2 { animation: vsbody-ccw 11s linear infinite; }
        .dna-v-mark .vsbody-3 { animation: vsbody-cw  15s linear infinite; }
        @keyframes vsbody-cw  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes vsbody-ccw { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        .dna-v-mark .dna-bodies-enter {
          animation-name: dna-bodies-enter-spread;
          animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
          animation-fill-mode: forwards;
          animation-iteration-count: 1;
        }
        @keyframes dna-bodies-enter-spread {
          from { transform: scale(3.4); }
          to   { transform: scale(1);   }
        }
        .dna-v-mark .dna-v-reveal {
          animation: dna-v-reveal-in 760ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }
        @keyframes dna-v-reveal-in {
          from { opacity: 0; transform: translateY(7px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @media (prefers-reduced-motion: reduce) {
          .dna-v-mark .vsbody { animation: none !important; }
          .dna-v-mark .dna-bodies-enter { animation: none !important; }
          /* No staged reveal for reduced motion — V is simply present. */
          .dna-v-mark .dna-v-reveal { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>
    </svg>
  );
}
