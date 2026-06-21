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

// Module scope — true until the very first (intro) loader has fully played.
// Lives OUTSIDE the component so React StrictMode's double-invoked mount
// effect can't prematurely consume it: only the timer that actually fires
// (the intro's full INITIAL_SHOW_MS, never the StrictMode-cleared one) flips
// it false. Guarantees the bodies-first intro on the real first paint in both
// dev (StrictMode) and production. Resets on a full page reload.
let firstLoadPending = true;

export function RouteTransitionLoader() {
  const location = useLocation();
  const reducedMotionRef = useRef(false);

  // Resolve reduced-motion preference once, synchronously.
  if (typeof window !== 'undefined' && !reducedMotionRef.current) {
    reducedMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
  }

  const [active, setActive] = useState(!reducedMotionRef.current && firstLoadPending);
  // Intro (bodies-first, then V) plays only while the first load is pending.
  const [intro, setIntro] = useState(firstLoadPending);

  useEffect(() => {
    if (reducedMotionRef.current) {
      setActive(false);
      return;
    }
    const isFirst = firstLoadPending;
    setIntro(isFirst);
    setActive(true);
    const timer = setTimeout(() => {
      setActive(false);
      // Consume the first-load flag only once the intro has fully shown.
      firstLoadPending = false;
    }, isFirst ? INITIAL_SHOW_MS : TRANSITION_SHOW_MS);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return <BrandLoader active={active} intro={intro} />;
}
