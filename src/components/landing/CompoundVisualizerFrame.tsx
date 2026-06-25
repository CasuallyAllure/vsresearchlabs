/**
 * CompoundVisualizerFrame
 *
 * The captioned "FIG-01 · Compound of the Month" scientific panel that
 * houses the swipeable HeroHoloCarousel (3D structure + intelligence
 * slides). Extracted from the Landing hero so the SAME framed module can
 * be rendered in two places, pixel-for-pixel:
 *
 *   • Inline    — the 5:4 slot in the hero grid (pass `onExpand`).
 *   • Expanded  — blown up to fill a centered overlay (pass `expanded`
 *                 + `onClose`); see CompoundVisualizerModal.
 *
 * Frame chrome (corner registration marks, title strip, grid backdrop,
 * scanline overlay, PDB provenance mark) is static; the carousel inside
 * carries all the real data. A few size tokens shift in the expanded
 * variant so the chrome stays proportional in the larger box.
 */

import { Suspense, lazy } from 'react';

const HeroHoloCarousel = lazy(() =>
  import('./HeroHoloCarousel').then((m) => ({ default: m.HeroHoloCarousel })),
);

interface CompoundVisualizerFrameProps {
  /** Expanded (overlay) variant — fills its parent box instead of the hero 5:4 slot. */
  expanded?: boolean;
  /** When provided, renders the expand affordance (inline hero only). */
  onExpand?: () => void;
  /** When provided, renders the close affordance (overlay only). */
  onClose?: () => void;
}

export function CompoundVisualizerFrame({
  expanded = false,
  onExpand,
  onClose,
}: CompoundVisualizerFrameProps) {
  return (
    <div
      className={`module-aura relative w-full overflow-hidden rounded-2xl ${
        expanded ? 'h-full' : 'aspect-[5/4]'
      }`}
      style={{
        background: 'var(--visualizer-glass)',
        backdropFilter: 'blur(10px) saturate(118%)',
        WebkitBackdropFilter: 'blur(10px) saturate(118%)',
        border: '1px solid var(--visualizer-glass-border)',
        boxShadow:
          '0 26px 64px -30px rgba(26,23,20,0.28), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(26,23,20,0.05)',
      }}
      aria-label="Compound visualization"
    >
      {/* Corner registration marks — scientific panel cue */}
      <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l border-t border-ink/25" />
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r border-t border-ink/25" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b border-l border-ink/25" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b border-r border-ink/25" />

      {/* Top scrim — thin band that keeps the title strip legible
          over the structure without eating into slide content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-12"
        style={{ background: 'var(--visualizer-scrim)' }}
      />

      {/* Top title strip — single thin label line (lower-third / chyron
          style), static across all slides. */}
      <div
        className={`absolute inset-x-4 top-3 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono uppercase tracking-[0.2em] ${
          expanded ? 'text-[10px] pr-10' : 'text-[8.5px] pr-1'
        }`}
      >
        <span className="tabular-nums text-ink/40">FIG-01</span>
        <span aria-hidden="true" className="text-ink/25">·</span>
        <span className="text-ink/45">Compound of the Month</span>
        <span aria-hidden="true" className="text-ink/25">·</span>
        <span className="font-bold tracking-[0.18em]" style={{ color: '#8C6A2A' }}>
          Retatrutide
        </span>
      </div>

      {/* Subtle grid backdrop — instrumentation feel */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 200 160"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(52, 114, 122,0.05)" strokeWidth="0.4" />
          </pattern>
          <radialGradient id="hero-glow" cx="50%" cy="55%" r="55%">
            <stop offset="0%" stopColor="rgba(52, 114, 122,0.12)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <rect width="200" height="160" fill="url(#hero-grid)" />
        <rect width="200" height="160" fill="url(#hero-glow)" />
      </svg>

      {/* Holographic content — swipeable carousel (3D structure + slides). */}
      <Suspense
        fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-ink/30">
              Initializing structure…
            </span>
          </div>
        }
      >
        <HeroHoloCarousel />
      </Suspense>

      {/* Scanline overlay — period 90s holo cue */}
      <div
        aria-hidden="true"
        className="hero-holo-scan pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(to bottom, transparent 0px, rgba(52, 114, 122,0.05) 1px, transparent 2px, transparent 3px)',
          mixBlendMode: 'screen',
        }}
      />

      {/* Bottom-left registration — provenance of the rendered structure
          (real cryo-EM coordinates). Moved off the right edge so it never
          shares the corner with the expand control. */}
      <span
        className={`absolute bottom-3 left-4 z-10 font-mono uppercase tracking-[0.2em] text-ink/40 ${
          expanded ? 'text-[9px]' : 'text-[8px]'
        }`}
      >
        PDB 8YW3
      </span>

      {/* Expand affordance — inline only. Bottom-right corner so it never
          overlaps the FIG-01 title strip; sits above the canvas/carousel
          so the click never competes with drag-to-rotate or swipe. */}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand compound visualizer"
          title="Expand"
          className="hero-holo-expand absolute right-3 bottom-2.5 z-40 flex h-7 w-7 items-center justify-center rounded-md border border-ink/15 bg-base-800/80 text-ink/55 backdrop-blur transition-colors hover:border-ink/35 hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M5.5 1H1v4.5M8.5 1H13v4.5M5.5 13H1V8.5M8.5 13H13V8.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* Close affordance — overlay only. */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close expanded view"
          title="Close"
          className="absolute right-3 top-2.5 z-40 flex h-9 w-9 items-center justify-center rounded-md border border-ink/15 bg-base-800/85 text-ink/60 backdrop-blur transition-colors hover:border-ink/35 hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {/* Frame animation styles — scoped to this module. */}
      <style>{`
        /* Gentle breathing pulse on the expand glyph so it reads as
           interactive without nagging. */
        @keyframes hero-holo-expand-pulse {
          0%, 100% { opacity: 0.75; }
          50%      { opacity: 1; }
        }
        .hero-holo-expand {
          animation: hero-holo-expand-pulse 3.2s ease-in-out infinite;
        }
        .hero-holo-expand:hover { animation: none; opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .hero-holo-scan { animation: none !important; }
          .hero-holo-expand { animation: none !important; opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
