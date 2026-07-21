/**
 * FeaturedSupplyCarousel — ONE contained `floating-module` box for the
 * catalog's featured-supply modules (paired supply, newly cataloged), with
 * its content swiping inside it.
 *
 * This component owns the card chrome (background, border, radius, shadow)
 * — children are bare content, not their own cards. They bleed edge-to-edge
 * inside the box; `overflow-hidden` on the box clips them to its rounded
 * corners. Every slide is full width (`w-full shrink-0 snap-center`), one
 * slide visible at a time, native scroll-snap drives the swipe. A slim dots
 * bar sits at the bottom, still inside the box, on the card surface.
 *
 * Auto-advances every 6s, loops, pauses on pointer/focus interaction, and
 * exposes an explicit play/pause control (WCAG 2.2.2 — auto-updating content
 * needs a way to stop it beyond incidental interaction). `prefers-reduced-
 * motion` disables autoplay entirely and drops programmatic scrolls to an
 * instant jump.
 *
 * Children may include `null`/`false` (a slide component that renders nothing
 * when it can't show honest data) — those are filtered out before slide count
 * drives the dots, so a hidden slide never leaves a phantom dot and a single
 * surviving child just fills the box with no dots at all.
 */

import {
  Children,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const AUTOPLAY_MS = 6000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

interface FeaturedSupplyCarouselProps {
  label: string;
  /** Optional per-slide names for dot aria-labels, e.g. ["Paired supply", "Newly cataloged"]. */
  slideLabels?: string[];
  className?: string;
  children: ReactNode;
}

export function FeaturedSupplyCarousel({
  label,
  slideLabels,
  className = '',
  children,
}: FeaturedSupplyCarouselProps) {
  // Drop null/false slides (a child component honestly rendering nothing)
  // BEFORE they can produce a phantom dot or an empty snap point.
  const slides = useMemo(() => Children.toArray(children).filter(Boolean), [children]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const track = trackRef.current;
      if (!track) return;
      track.scrollTo({ left: index * track.clientWidth, behavior });
    },
    [],
  );

  // Track which slide is active as the user swipes/scrolls, throttled to one
  // read per animation frame rather than on every scroll event.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const width = track.clientWidth;
        if (width === 0) return;
        const index = Math.round(track.scrollLeft / width);
        setActiveIndex((prev) => (prev === index ? prev : index));
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const autoplayActive =
    !prefersReducedMotion && !manuallyPaused && !interactionPaused && slides.length > 1;

  useEffect(() => {
    if (!autoplayActive) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % slides.length;
        scrollToIndex(next, 'smooth');
        return next;
      });
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplayActive, slides.length, scrollToIndex]);

  function handlePause() {
    setInteractionPaused(true);
  }

  function handleResume() {
    setInteractionPaused(false);
  }

  function handleDotClick(index: number) {
    scrollToIndex(index, prefersReducedMotion ? 'auto' : 'smooth');
    setActiveIndex(index);
  }

  if (slides.length === 0) return null;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      className={`floating-module flex flex-col overflow-hidden ${className}`}
      onPointerEnter={handlePause}
      onPointerLeave={handleResume}
      onPointerDown={handlePause}
      onFocus={handlePause}
      onBlur={handleResume}
    >
      <div
        ref={trackRef}
        tabIndex={0}
        className="featured-supply-carousel no-scrollbar flex snap-x snap-mandatory items-stretch overflow-x-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
      >
        {slides.map((slide, i) => (
          <div key={i} className="flex w-full shrink-0 snap-center">
            {slide}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-ink/[0.06] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="flex items-center gap-1.5">
            {slides.map((_, i) => {
              const on = i === activeIndex;
              const name = slideLabels?.[i];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleDotClick(i)}
                  aria-label={name ? `Go to slide ${i + 1}: ${name}` : `Go to slide ${i + 1}`}
                  aria-current={on ? 'true' : undefined}
                  className="h-1.5 rounded-full transition-[width,background-color] duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
                  style={{
                    width: on ? '16px' : '6px',
                    backgroundColor: on ? 'rgb(var(--c-ink) / 0.65)' : 'rgb(var(--c-ink) / 0.18)',
                  }}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setManuallyPaused((p) => !p)}
            aria-label={manuallyPaused ? 'Play automatic slideshow' : 'Pause automatic slideshow'}
            className="flex h-5 w-5 items-center justify-center text-ink/45 transition-colors hover:text-ink/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 rounded-full"
          >
            {manuallyPaused ? (
              <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true">
                <path d="M0.5 0.5 L8.5 5 L0.5 9.5 Z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="2.5" height="10" fill="currentColor" />
                <rect x="5.5" y="0" width="2.5" height="10" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
