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
const FADE_OUT_MS = 520;
// Intro only — how long the three bodies "dance" before the V rises in.
const V_REVEAL_DELAY_MS = 1700;
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
        background: 'rgba(251, 249, 244, 0.94)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        pointerEvents: 'none',
        animation: exiting
          ? `vsrl-loader-fade-out ${FADE_OUT_MS}ms ease-in forwards`
          : `vsrl-loader-fade-in ${FADE_IN_MS}ms ease-out`,
      }}
    >
      <style>{`
        @keyframes vsrl-loader-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes vsrl-loader-fade-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
      `}</style>
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(-${MARK_LIFT_PX}px)`,
        }}
      >
        <DnaVMark
          size={96}
          static
          bodyEntryMs={1600}
          vRevealDelayMs={intro ? V_REVEAL_DELAY_MS : undefined}
        />
      </div>
    </div>
  );
}
