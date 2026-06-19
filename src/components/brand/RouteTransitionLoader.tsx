/**
 * RouteTransitionLoader
 *
 * Shows the BrandLoader briefly on every route change so navigation feels
 * deliberate and on-brand instead of an instant pop. Drop once at the App
 * root inside <BrowserRouter>; no props.
 *
 * Strategy:
 *   - Show for INITIAL_SHOW_MS on first paint (the moment React mounts).
 *   - On every subsequent route change show for TRANSITION_SHOW_MS.
 *   - prefers-reduced-motion → never show (the BrandLoader also no-ops
 *     its animation; this layer skips the overlay entirely so reduced
 *     users get instant navigation).
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BrandLoader } from './BrandLoader';

// Initial = first paint of the app. We hold long enough for the full intro
// to play without being cut: the three bodies dance ALONE (~2s), the rest of
// the mark (DNA strand + V + rings) rises in behind them (~0.76s), then a
// settle before BrandLoader's internal fade-out (520ms) crossfades into
// whatever's underneath. Route changes use the short hold and skip the intro.
const INITIAL_SHOW_MS = 3900;
const TRANSITION_SHOW_MS = 380;

export function RouteTransitionLoader() {
  const location = useLocation();
  const isFirstRunRef = useRef(true);
  const reducedMotionRef = useRef(false);

  // Resolve reduced-motion preference once, synchronously.
  if (typeof window !== 'undefined' && !reducedMotionRef.current) {
    reducedMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
  }

  const [active, setActive] = useState(!reducedMotionRef.current);
  // Intro (bodies-first, then V) plays only on the very first paint.
  const [intro, setIntro] = useState(true);

  useEffect(() => {
    if (reducedMotionRef.current) {
      setActive(false);
      return;
    }
    const isFirst = isFirstRunRef.current;
    isFirstRunRef.current = false;
    if (!isFirst) setIntro(false);

    setActive(true);
    const timer = setTimeout(
      () => setActive(false),
      isFirst ? INITIAL_SHOW_MS : TRANSITION_SHOW_MS
    );
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return <BrandLoader active={active} intro={intro} />;
}
