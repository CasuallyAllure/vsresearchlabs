/**
 * useCompoundShareRoute — makes the compound overlay addressable.
 *
 * The overlay is a portal rendered by whichever page is underneath it
 * (catalog, /research, the supply pages, the landing hero, the bundle and
 * inventory modals). Turning it into a real route would unmount that page
 * and throw away its filters and scroll position, so instead this hook
 * writes the shareable URL straight onto the History API while the overlay
 * is open:
 *
 *   open   → history.pushState('/c/<slug>')   — address bar is copyable
 *   swipe  → history.replaceState('/c/<next>') — carousel stays in sync
 *   back   → popstate closes the overlay
 *   close  → history.back() rewinds to whatever page we came from
 *
 * A raw pushState does not notify React Router (it only listens to
 * popstate), which is exactly what we want: the page underneath keeps
 * rendering untouched. The two locations re-converge the moment the
 * overlay closes, because closing rewinds the same entry we pushed.
 *
 * When the overlay is mounted BY the /c/<slug> route itself (a cold deep
 * link), the URL is already correct — the hook pushes nothing and leaves
 * unwinding to that route's own onClose.
 */

import { useEffect, useRef } from 'react';
import type { Product } from '../types';
import { compoundSharePath, shareTitle } from '../lib/compoundShare';

interface Options {
  /** Called when the user dismisses the overlay with the back button. */
  onBack: () => void;
}

export function useCompoundShareRoute(product: Product, { onBack }: Options): void {
  const path = compoundSharePath(product);

  // Refs so the mount/unmount effect never re-runs on a callback identity
  // change — pushing a second history entry mid-session would strand the
  // user behind two back presses.
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; });

  const pushedRef = useRef(false);
  // Tracks the path currently written to the address bar, so the unmount
  // cleanup can tell whether the top history entry is still ours after the
  // visitor has swiped through several compounds. Kept current by the
  // carousel effect below.
  const pathRef = useRef(path);

  // ── Mount: claim the URL. Unmount: give it back. ───────────────────────
  useEffect(() => {
    const entryPath = pathRef.current;
    const previousTitle = document.title;

    // Already on the share route (cold deep link) — nothing to push.
    if (window.location.pathname !== entryPath) {
      window.history.pushState({ vsrCompoundShare: true }, '', entryPath);
      pushedRef.current = true;
    }

    function onPopState() {
      // The user walked out of the overlay's history entry. Close it; the
      // unmount branch below then sees the URL is no longer ours and leaves
      // history alone.
      if (pushedRef.current) onBackRef.current();
    }
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
      document.title = previousTitle;
      // Only rewind if OUR entry is still the current one. If the overlay
      // closed because the user followed a link out of it (or pressed back),
      // the top of the stack belongs to someone else and must not be popped.
      if (pushedRef.current && window.location.pathname === pathRef.current) {
        window.history.back();
      }
    };
    // Mount/unmount only — carousel changes are handled by the effect below.
  }, []);

  // ── Carousel: keep the URL (and title) on the compound being viewed. ────
  useEffect(() => {
    pathRef.current = path;
    document.title = shareTitle(product);
    // replaceState, not push: swiping through the catalog inside one overlay
    // session should not bury the page behind N back presses.
    if (window.location.pathname !== path) {
      window.history.replaceState({ vsrCompoundShare: true }, '', path);
    }
  }, [path, product]);
}
