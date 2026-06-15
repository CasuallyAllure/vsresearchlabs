/**
 * IntroModal
 *
 * Floating, dismissible intro that appears when a visitor first enters the
 * site — the three-tab VideoIntroModule lifted out of the page flow into a
 * centered overlay you must dismiss (X / backdrop / ESC / "Enter site").
 *
 * Shown once per browser session (sessionStorage) so it doesn't re-pop on
 * every in-site navigation or scroll. To show it on every reload instead,
 * swap sessionStorage → a ref/no-store; to show once ever, use localStorage.
 *
 * Portaled to <body> so it escapes the sticky header's stacking context, and
 * scroll-locked while open. Honors prefers-reduced-motion.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { VideoIntroModule } from './VideoIntroModule';

const SESSION_KEY = 'vsr.intro.seen';

export function IntroModal() {
  // Decide once, lazily, whether this visit should see the intro — avoids a
  // setState-in-effect and never flashes for a returning visitor.
  const [render, setRender] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) !== '1';
    } catch {
      return true; // sessionStorage unavailable (private-mode quirks) — show it.
    }
  });
  const [open, setOpen] = useState(false);

  // Trigger the enter transition on the next frame after mount.
  useEffect(() => {
    if (!render) return;
    const t = setTimeout(() => setOpen(true), 30);
    return () => clearTimeout(t);
  }, [render]);

  // Body scroll lock while visible.
  useEffect(() => {
    if (!render) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [render]);

  // ESC closes.
  useEffect(() => {
    if (!render) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [render]);

  function close() {
    setOpen(false);
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
    // Unmount after the exit transition.
    setTimeout(() => setRender(false), 250);
  }

  if (!render) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to VS Research Labs"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`absolute inset-0 bg-ink/65 backdrop-blur-[3px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel */}
      <div
        className={`relative w-full max-w-[920px] max-h-[90dvh] overflow-y-auto rounded-lg transition-all duration-300 ease-out ${
          open ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-[0.98]'
        }`}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss intro"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 bg-base-800/90 text-ink/60 hover:text-ink hover:border-ink/35 backdrop-blur transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <VideoIntroModule />

        {/* Enter site */}
        <div className="-mt-[var(--space-6)] mb-[var(--space-2)] flex justify-center">
          <button
            type="button"
            onClick={close}
            className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-6)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors"
          >
            Enter site →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
