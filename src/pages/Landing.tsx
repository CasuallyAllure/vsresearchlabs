/**
 * Landing
 * Phase 2 — Layout clarity, hierarchy, proportions.
 *
 * Inventory: existing page only. No new components introduced.
 * Removed: glass-card pills, decorative grid texture, gradient halos.
 * Surfaces: solid base + a single hairline divider between the hero
 * and the category section. Categories render as plain linked rows
 * separated by hairlines — image-free, type-led, scannable.
 */

import { Link } from 'react-router-dom';

export function Landing() {
  return (
    <>
      {/* HERO — full-bleed, sits flush against the GlobalHeader */}
      <section
        className="relative -mx-[var(--space-6)] -mt-[var(--space-2)] border-b border-white/[0.06]"
        aria-label="Welcome"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-20)] sm:py-[var(--space-24)]">
          <div className="max-w-[44ch]">
            <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-5)]">
              VS Research Labs
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light text-white leading-[1.05] tracking-tight mb-[var(--space-6)]">
              Research-grade supplies,
              <br />
              engineered for precision.
            </h1>
            <p className="text-base sm:text-lg text-white/65 leading-relaxed max-w-[52ch]">
              Clinical-quality peptide accessories and laboratory equipment
              for academic and independent research environments. Sourced for
              consistency. Discreetly shipped. Built for repeat workflows.
            </p>
          </div>
        </div>
      </section>

      {/* CATEGORIES — typeset linked rows separated by hairlines */}
      <section
        className="-mx-[var(--space-6)]"
        aria-label="Browse categories"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)]">
          <p className="pt-[var(--space-12)] pb-[var(--space-6)] text-[11px] uppercase tracking-[0.3em] text-white/40">
            Catalog
          </p>
        </div>

        <ul className="border-t border-white/[0.06]">
          <li className="border-b border-white/[0.06]">
            <Link
              to="/research-supplies"
              className="group block"
            >
              <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-10)] flex items-center justify-between gap-[var(--space-6)]">
                <div className="min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-light text-white tracking-tight">
                    Research Supplies
                  </h2>
                  <p className="mt-[var(--space-2)] text-sm text-white/50">
                    Peptides, bacteriostatic water, syringes & consumables.
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-2xl text-white/30 group-hover:text-gold group-hover:translate-x-1 transition-all duration-200"
                >
                  →
                </span>
              </div>
            </Link>
          </li>

          <li className="border-b border-white/[0.06]">
            <Link
              to="/laboratory-equipment"
              className="group block"
            >
              <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-10)] flex items-center justify-between gap-[var(--space-6)]">
                <div className="min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-light text-white tracking-tight">
                    Laboratory Equipment
                  </h2>
                  <p className="mt-[var(--space-2)] text-sm text-white/50">
                    Precision instruments and bench tools.
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-2xl text-white/30 group-hover:text-gold group-hover:translate-x-1 transition-all duration-200"
                >
                  →
                </span>
              </div>
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
