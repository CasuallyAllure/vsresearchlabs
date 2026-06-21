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

// First full page load holds a touch longer so the spinning seal reads;
// route changes use the short hold.
const INITIAL_SHOW_MS = 1800;
const TRANSITION_SHOW_MS = 380;

// Module scope — true until the very first loader has fully shown. Lives
// OUTSIDE the component so React StrictMode's double-invoked mount effect
// can't prematurely consume it: only the timer that actually fires (the full
// INITIAL_SHOW_MS, never the StrictMode-cleared one) flips it false. Resets
// on a full page reload.
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

  useEffect(() => {
    if (reducedMotionRef.current) {
      setActive(false);
      return;
    }
    // First full load holds a touch longer than a route transition.
    const isFirst = firstLoadPending;
    setActive(true);
    const timer = setTimeout(() => {
      setActive(false);
      // Consume the first-load flag only once the loader has fully shown.
      firstLoadPending = false;
    }, isFirst ? INITIAL_SHOW_MS : TRANSITION_SHOW_MS);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return <BrandLoader active={active} />;
}
