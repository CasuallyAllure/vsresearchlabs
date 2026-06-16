/**
 * BrandLoader
 *
 * Full-screen brand loader shown during route transitions and the initial
 * page load. Visual language matches DnaVMark: same body palette (small
 * ink, medium teal, larger gold), same paired orbital-ring backdrop, but
 * orbiting at a larger radius — the three "outer planets" to the mark's
 * three "inner planets." Same CSS-rotate motion model as DnaVMark so the
 * outer family is unmistakably the same brand.
 *
 * Tempos are intentionally different from the inner mark (8s / 13s / 18s
 * vs 7s / 11s / 15s) and one of the three orbits backwards — a faint
 * three-body weave on top of the slower inner weave.
 *
 * Respects prefers-reduced-motion via a CSS media query (no rAF; CSS
 * animation does the right thing automatically).
 */

import { useEffect, useState } from 'react';
import { DnaVMark } from './DnaVMark';

export interface BrandLoaderProps {
  /** Whether the loader is visible. When flipped to false the loader fades
   *  out over FADE_OUT_MS before unmounting. */
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
        @keyframes vsrl-outer-cw  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
        @keyframes vsrl-outer-ccw { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
        .vsrl-outer-body {
          transform-box: view-box;
          transform-origin: 0px 0px;
        }
        .vsrl-outer-body-1 { animation: vsrl-outer-cw  8s  linear infinite; }
        .vsrl-outer-body-2 { animation: vsrl-outer-ccw 13s linear infinite; }
        .vsrl-outer-body-3 { animation: vsrl-outer-cw  18s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .vsrl-outer-body { animation: none !important; }
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

      <div style={{ position: 'relative', width: 220, height: 220 }}>
        {/* Outer field — faint orbital rings + three larger bodies orbiting
            shared center (0,0) in view-box coordinates. */}
        <svg
          viewBox="-110 -110 220 220"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'visible',
          }}
          aria-hidden="true"
        >
          <g fill="none" stroke="#1A1714" strokeLinecap="round">
            <ellipse
              cx="0"
              cy="0"
              rx="92"
              ry="56"
              transform="rotate(-22)"
              opacity="0.18"
              strokeWidth="0.6"
            />
            <ellipse
              cx="0"
              cy="0"
              rx="68"
              ry="94"
              transform="rotate(33)"
              opacity="0.11"
              strokeWidth="0.55"
            />
          </g>

          {/* Small ink — CW, tightest of the outer trio */}
          <circle
            className="vsrl-outer-body vsrl-outer-body-1"
            cx="90"
            cy="0"
            r="3.2"
            fill="#1A1714"
            opacity="0.55"
          />
          {/* Medium teal — CCW, mid radius */}
          <circle
            className="vsrl-outer-body vsrl-outer-body-2"
            cx="0"
            cy="-92"
            r="4.8"
            fill="#34727A"
            opacity="0.92"
          />
          {/* Larger gold — CW, widest of the three */}
          <circle
            className="vsrl-outer-body vsrl-outer-body-3"
            cx="-76"
            cy="40"
            r="6.6"
            fill="#B5904B"
            opacity="1"
          />
        </svg>

        {/* Inner mark — same component the header uses, full body animation */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <DnaVMark size={88} static />
        </div>
      </div>
    </div>
  );
}
