/**
 * NotFound — 404 catch-all.
 *
 * Branded dead-end with routes back into the live surfaces, so an unknown
 * URL never strands the visitor on a blank page.
 */

import { Link } from 'react-router-dom';

const LINKS: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Home' },
  { to: '/research-supplies', label: 'Research Supplies' },
  { to: '/laboratory-equipment', label: 'Laboratory Equipment' },
  { to: '/contact', label: 'Contact' },
];

export function NotFound() {
  return (
    <section className="flex min-h-[60vh] items-center justify-center py-[var(--space-12)]">
      <div className="w-full max-w-[480px] text-center">
        <p className="mb-[var(--space-3)] font-mono text-[10px] uppercase tracking-[0.3em] text-ink/45">
          Error · 404
        </p>
        <h1 className="mb-[var(--space-3)] text-[clamp(1.6rem,3.4vw,2.3rem)] font-light leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="text-ink/85">This reference </span>
          <span className="font-medium">isn't on file.</span>
        </h1>
        <p className="mb-[var(--space-8)] text-[13.5px] leading-relaxed text-ink/60">
          The page you're after doesn't exist or has moved. Pick up the trail from
          one of these.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-[var(--space-3)]">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-full border border-ink/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink hover:border-ink/30"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
