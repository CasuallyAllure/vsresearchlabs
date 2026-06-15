/**
 * BrandLoader
 *
 * Full-screen brand loader shown during route transitions and the initial
 * page load. Three "bodies" trace a figure-eight (lemniscate of Gerono)
 * offset 120° apart in phase — a close visual cousin of the Chenciner-
 * Montgomery three-body figure-eight orbit. The DNA-S monogram sits at
 * the crossing point, so the bodies appear to twist past each other
 * through it.
 *
 * Animation is driven by requestAnimationFrame — single timer, three
 * DOM writes per frame, no React re-renders inside the loop.
 *
 * Respects prefers-reduced-motion: when reduced, the component still
 * mounts (so accessibility hints fire) but the dots park at a static
 * three-point configuration and the rAF loop doesn't start.
 */

import { useEffect, useRef } from 'react';

export interface BrandLoaderProps {
  /** Whether the loader is visible. */
  active: boolean;
}

const PERIOD_MS = 2800;       // one full ∞ loop
const ORBIT_HALF_WIDTH = 38;  // a — half the width of the figure-eight
const DOT_RADIUS = 4.5;

// Three bodies, brand-aligned colors.
const BODY_COLORS = ['#1A1714', '#34727A', 'rgba(26,23,20,0.42)'];

export function BrandLoader({ active }: BrandLoaderProps) {
  const dotsRef = useRef<(SVGCircleElement | null)[]>([null, null, null]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      // Static three-point spread, no animation.
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3;
        const dot = dotsRef.current[i];
        if (dot) {
          dot.setAttribute('cx', (Math.cos(angle) * ORBIT_HALF_WIDTH).toFixed(2));
          dot.setAttribute('cy', (Math.sin(angle) * ORBIT_HALF_WIDTH * 0.5).toFixed(2));
        }
      }
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const t = ((now - start) / PERIOD_MS) * Math.PI * 2;
      for (let i = 0; i < 3; i++) {
        const phase = t + (i * 2 * Math.PI) / 3;
        // Lemniscate of Gerono: x = a·sin(p), y = (a/2)·sin(2p)
        const x = ORBIT_HALF_WIDTH * Math.sin(phase);
        const y = (ORBIT_HALF_WIDTH / 2) * Math.sin(2 * phase);
        const dot = dotsRef.current[i];
        if (dot) {
          dot.setAttribute('cx', x.toFixed(2));
          dot.setAttribute('cy', y.toFixed(2));
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active]);

  if (!active) return null;

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
        animation: 'vsrl-loader-fade-in 180ms ease-out',
      }}
    >
      <style>{`
        @keyframes vsrl-loader-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
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
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <img
          src="/brand/vs-dna-s-full-colour.png"
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 48,
            height: 48,
            transform: 'translate(-50%, -50%)',
            opacity: 0.96,
          }}
        />
        <svg
          viewBox="-70 -70 140 140"
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          aria-hidden="true"
        >
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              ref={(el) => {
                dotsRef.current[i] = el;
              }}
              r={DOT_RADIUS}
              fill={BODY_COLORS[i]}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
