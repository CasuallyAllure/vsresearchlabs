/**
 * RouteFallback
 *
 * Suspense fallback for lazy-loaded routes. Shows while a route's JS chunk is
 * still downloading — most visible on slower connections, after the brief
 * RouteTransitionLoader overlay has already cleared. A quiet on-brand page
 * skeleton (eyebrow → title → body block) reads as "the page is arriving"
 * instead of a bare "Loading…" string.
 *
 * Motion: the pulse is disabled under prefers-reduced-motion
 * (motion-reduce:animate-none) so the static shell is the accessible default.
 */

function Bar({ className }: { className: string }) {
  return (
    <div
      className={`rounded bg-ink/[0.06] motion-reduce:animate-none animate-pulse ${className}`}
    />
  );
}

export function RouteFallback() {
  return (
    <div
      className="mx-auto w-full max-w-[64rem] px-[var(--space-5)] pt-[var(--space-8)] pb-[var(--space-12)]"
      aria-busy="true"
      aria-label="Loading page"
    >
      <span className="sr-only" role="status">
        Loading…
      </span>

      {/* Eyebrow → title → subtitle rhythm, mirroring a list/category page head. */}
      <Bar className="h-2.5 w-24" />
      <Bar className="mt-[var(--space-3)] h-8 w-3/5 max-w-[22rem]" />
      <Bar className="mt-[var(--space-3)] h-3 w-4/5 max-w-[34rem]" />

      {/* Content block — a display-inset placeholder plus stacked lines. */}
      <div className="mt-[var(--space-8)] grid gap-[var(--space-4)] sm:grid-cols-2">
        <div className="aspect-[4/3] w-full rounded-[var(--radius-card-inner)] bg-display/60 motion-reduce:animate-none animate-pulse" />
        <div className="flex flex-col justify-center gap-[var(--space-3)]">
          <Bar className="h-3 w-1/3" />
          <Bar className="h-3 w-3/4" />
          <Bar className="h-3 w-2/3" />
          <Bar className="h-3 w-4/5" />
        </div>
      </div>
    </div>
  );
}
