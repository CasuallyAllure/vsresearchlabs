/**
 * BrandLoader
 *
 * Full-screen brand loader shown during route transitions and the initial
 * page load. The logo (V monogram + seal ring + wordmark) sits centered on a
 * frosted, blurred-cream backdrop; the gold seal ring spins + pulses as the
 * loading indicator (via DnaVMark's `spin`). The bodies keep their orbit.
 */

import { useEffect, useState } from 'react';
import { DnaVMark } from './DnaVMark';
import { siteConfig } from '../../config';

const BRAND_WORDMARK = siteConfig.brand.wordmark;

export interface BrandLoaderProps {
  /** Whether the loader is visible. When flipped to false the loader
   *  fades out over FADE_OUT_MS before unmounting. */
  active: boolean;
}

const FADE_IN_MS = 220;
// Exit takes a touch longer: the frosted backdrop doesn't fade uniformly, it
// recedes outside-in like a closing vignette that collapses onto the logo.
const FADE_OUT_MS = 660;
// Shift the loader's mark this many px UP from viewport center so it sits
// in the upper half of the screen — paired with DisclaimerGate's
// CARD_DROP_PX so the loader logo and the gate module visually "meet in
// the middle" of the viewport.
const MARK_LIFT_PX = 30;

export function BrandLoader({ active }: BrandLoaderProps) {
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
        /* Logo holds through the vignette, then fades as the backdrop
           collapses onto it. */
        @keyframes vsrl-logo-exit {
          0%   { opacity: 1; }
          64%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Frosted blurred-cream backdrop — masked away outside-in on exit. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--loader-bg)',
          backdropFilter: 'blur(18px) saturate(118%)',
          WebkitBackdropFilter: 'blur(18px) saturate(118%)',
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
          size={78}
          static
          ring
          spin
          // No inkColor → the V follows the theme's content color (ink on the
          // cream backdrop in light, silver on the dark backdrop in dark mode),
          // matching the header.
        />
        {/* Wordmark — identical font / weight / tracking to the header Logo,
            sitting directly under the V. Simply present (no staged reveal). */}
        <span
          className="font-serif font-medium uppercase leading-none whitespace-nowrap"
          style={{
            marginTop: 6,
            fontSize: 12,
            letterSpacing: '0.2em',
            // Follows the theme: ink in light, silver in dark.
            color: 'var(--color-content-primary)',
          }}
        >
          {BRAND_WORDMARK}
        </span>
      </div>
    </div>
  );
}
