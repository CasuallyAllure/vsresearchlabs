/**
 * BrandLoader
 *
 * Full-screen brand loader shown during route transitions and the initial
 * page load. Just the DnaVMark — no outer body layer. The mark enters
 * large (about 2.6× its resting size) and shrinks down to its resting
 * size over 1.6s with an ease-out curve, then holds for a beat before
 * the parent fade-out begins. The mark's own bodies continue orbiting
 * the whole time at the brand tempo (7s / 11s / 15s).
 *
 * Respects prefers-reduced-motion: shrink animation is skipped and the
 * mark renders at its resting size immediately. The mark's body
 * animations have their own reduced-motion handling inside DnaVMark.
 */

import { useEffect, useState } from 'react';
import { DnaVMark } from './DnaVMark';

export interface BrandLoaderProps {
  /** Whether the loader is visible. When flipped to false the loader
   *  fades out over FADE_OUT_MS before unmounting. */
  active: boolean;
}

const FADE_IN_MS = 220;
const FADE_OUT_MS = 520;

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
        @keyframes vsrl-loader-shrink {
          from { transform: scale(2.6); }
          to   { transform: scale(1);   }
        }
        .vsrl-loader-shrink {
          animation: vsrl-loader-shrink 1600ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
          transform-origin: center;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .vsrl-loader-shrink { animation: none !important; }
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
        className="vsrl-loader-shrink"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <DnaVMark size={96} static />
      </div>
    </div>
  );
}
