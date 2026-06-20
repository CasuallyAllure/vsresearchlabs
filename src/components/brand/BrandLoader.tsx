/**
 * BrandLoader
 *
 * Full-screen brand loader shown during route transitions and the initial
 * page load. The mark itself (V monogram, S strand, orbital rings) sits
 * still, crisp, centered. Only the three bodies animate on entry —
 * starting at ~3.4× their orbital radius and spiraling inward to their
 * resting orbits over 1.6s while continuing to revolve at brand tempo.
 *
 * The mark is rendered via DnaVMark with bodyEntryMs=1600; the entry
 * animation lives inside DnaVMark and respects prefers-reduced-motion.
 */

import { useEffect, useState } from 'react';
import { DnaVMark } from './DnaVMark';
import { BRAND_WORDMARK } from './Logo';

export interface BrandLoaderProps {
  /** Whether the loader is visible. When flipped to false the loader
   *  fades out over FADE_OUT_MS before unmounting. */
  active: boolean;
  /** First-entry intro: the three bodies dance alone first, then the V
   *  monogram rises in behind them. Only true on the very first paint;
   *  route-transition loaders leave it off and show the full mark. */
  intro?: boolean;
}

const FADE_IN_MS = 220;
// Exit takes a touch longer now: the white doesn't fade uniformly, it
// recedes outside-in like a closing vignette that collapses onto the logo.
const FADE_OUT_MS = 660;
// Intro only — how long the three bodies dance ALONE before the rest of
// the mark (DNA strand + V + rings) rises in behind them.
const V_REVEAL_DELAY_MS = 2000;
// Shift the loader's mark this many px UP from viewport center so it sits
// in the upper half of the screen — paired with DisclaimerGate's
// CARD_DROP_PX so the loader logo and the gate module visually "meet in
// the middle" of the viewport.
const MARK_LIFT_PX = 30;

export function BrandLoader({ active, intro = false }: BrandLoaderProps) {
  const [mounted, setMounted] = useState(active);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const t = setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [active, mounted]);

  if (!mounted) return null;

  // Radial mask applied to the white layer only while exiting — its
  // opaque disc (the surviving white) is centered on the logo (which sits
  // MARK_LIFT_PX above viewport center) and shrinks to nothing, so the
  // white peels away from the edges inward and collapses onto the mark.
  const vignetteMask = exiting
    ? {
        WebkitMaskImage:
          'radial-gradient(circle, #000 34%, rgba(0,0,0,0.55) 52%, transparent 70%)',
        maskImage:
          'radial-gradient(circle, #000 34%, rgba(0,0,0,0.55) 52%, transparent 70%)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: `50% calc(50% - ${MARK_LIFT_PX}px)`,
        maskPosition: `50% calc(50% - ${MARK_LIFT_PX}px)`,
      }
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <style>{`
        @keyframes vsrl-loader-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        /* White recedes outside-in: the masked opaque disc shrinks to a
           point on the logo. */
        @keyframes vsrl-bg-vignette {
          from { -webkit-mask-size: 440% 440%; mask-size: 440% 440%; }
          to   { -webkit-mask-size: 0% 0%;     mask-size: 0% 0%;     }
        }
        /* Logo holds through the vignette, then fades as the last white
           collapses onto it. */
        @keyframes vsrl-logo-exit {
          0%   { opacity: 1; }
          64%  { opacity: 1; }
          100% { opacity: 0; }
        }
        /* Wordmark rises in with the V — same 760ms fade+lift as the
           DnaVMark V reveal so the two complete the mark together. */
        @keyframes vsrl-word-reveal {
          from { opacity: 0; transform: translateY(7px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .vsrl-word-reveal {
          opacity: 0;
          animation: vsrl-word-reveal 760ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .vsrl-word-reveal {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* White frosted backdrop — masked away outside-in on exit. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(251, 249, 244, 0.94)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: exiting
            ? `vsrl-bg-vignette ${FADE_OUT_MS}ms ease-in forwards`
            : `vsrl-loader-fade-in ${FADE_IN_MS}ms ease-out`,
          ...vignetteMask,
        }}
      />

      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
        }}
      >
        Loading
      </span>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(-${MARK_LIFT_PX}px)`,
          animation: exiting
            ? `vsrl-logo-exit ${FADE_OUT_MS}ms ease-in forwards`
            : undefined,
        }}
      >
        <DnaVMark
          size={96}
          static
          bodyEntryMs={1600}
          vRevealDelayMs={intro ? V_REVEAL_DELAY_MS : undefined}
        />
        {/* Wordmark — identical font / weight / tracking to the header
            Logo, sitting directly under the V. In intro mode it rises in
            with the V (same delay + 760ms curve); otherwise it's simply
            present, matching the always-visible mark on route loaders. */}
        <span
          className={`font-serif font-medium uppercase leading-none whitespace-nowrap text-ink${
            intro ? ' vsrl-word-reveal' : ''
          }`}
          style={{
            marginTop: -10,
            fontSize: 13,
            letterSpacing: '0.2em',
            ...(intro ? { animationDelay: `${V_REVEAL_DELAY_MS}ms` } : null),
          }}
        >
          {BRAND_WORDMARK}
        </span>
      </div>
    </div>
  );
}
