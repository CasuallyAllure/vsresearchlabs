/**
 * TestimonialBlock
 * Wave 10 — Sparse Testimonial System.
 *
 * Trust through operational specificity. Three short, process-aware
 * references from procurement / lab roles. The absence of typical
 * ecommerce trust patterns is intentional — restraint IS the trust
 * signal.
 *
 * Surface posture (anti-drift):
 *   - Fully flat. No glass, no backdrop-blur, no elevated panels.
 *   - No testimonial "cards" — testimonials sit in a hairline-divided
 *     grid where typography and spacing carry the hierarchy.
 *   - No avatars, no logos, no star ratings, no social proof counters,
 *     no rotating carousel, no animation theatrics.
 *   - Hairline grammar matches the rest of Landing: `border-ink/[0.06]`.
 *
 * Voice posture:
 *   - Each quote names a specific operational event (documentation
 *     availability, batch reconciliation, inquiry turnaround).
 *   - Names are initial+lastname; orgs are redacted / partially
 *     anonymized to communicate that real labs have privacy needs
 *     and the platform respects them.
 *   - No exclamation points, no superlatives, no emotional language.
 *
 * Slot:
 *   Sits at the bottom of Landing — after Categories — closing the
 *   page with quietly-confident operational references. When a future
 *   "final CTA module" wave inserts below, the section's bottom
 *   hairline already provides the boundary.
 */

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  /**
   * Optional organization line. Always redacted or partially
   * anonymized — full institution names are intentionally absent
   * to reinforce the privacy-aware procurement posture.
   */
  org?: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'Documentation was available before request. Certificates of analysis arrived alongside batch confirmation.',
    name: 'M. Chen',
    role: 'Research Procurement Lead',
    org: 'University laboratory · Northeast U.S.',
  },
  {
    quote:
      'Batch references on the receiving end matched our intake records exactly. Reconciliation took minutes.',
    name: 'J. Park',
    role: 'Laboratory Manager',
    org: 'Independent research facility',
  },
  {
    quote:
      'Inquiry turnaround was consistent. Volume requests for repeat dose tiers were quoted within one business day.',
    name: 'K. Whitfield',
    role: 'Senior Researcher',
    org: 'Pharmacology lab · university partner',
  },
];

export function TestimonialBlock() {
  return (
    <section
      className="-mx-[var(--space-6)] border-b border-ink/[0.06]"
      aria-label="Field references"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-16)] sm:py-[var(--space-20)]">
        {/* Heading band — eyebrow + display heading. No body paragraph;
            the testimonials themselves carry the section's substance. */}
        <div className="mb-[var(--space-10)] sm:mb-[var(--space-12)]">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-4)]">
            References
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-light text-ink tracking-tight leading-[1.1] max-w-[22ch]">
            Field references.
          </h2>
        </div>

        {/* Testimonial grid.
            Mobile: vertical stack with horizontal hairlines between cells.
            Desktop (lg+): 3-column grid with vertical hairlines between cells.
            Each cell handles its own conditional borders so the hairline
            grammar stays explicit (no divide-* utilities). */}
        <ul role="list" className="grid grid-cols-1 lg:grid-cols-3">
          {TESTIMONIALS.map((t, i) => {
            const isFirst = i === 0;
            const isLast = i === TESTIMONIALS.length - 1;
            return (
              <li
                key={t.name}
                className={[
                  // Mobile vertical rhythm
                  'py-[var(--space-6)]',
                  isFirst ? 'pt-0' : '',
                  isLast ? 'pb-0' : '',
                  // Mobile bottom hairline (between cells only)
                  !isLast ? 'border-b border-ink/[0.06]' : '',
                  // Desktop: kill mobile hairlines, swap to right-side hairlines,
                  // and adopt horizontal padding rhythm. First/last cells
                  // shed their outer padding so the grid sits flush.
                  'lg:py-0 lg:px-[var(--space-6)]',
                  !isLast ? 'lg:border-b-0 lg:border-r lg:border-ink/[0.06]' : '',
                  isFirst ? 'lg:pl-0' : '',
                  isLast ? 'lg:pr-0' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <figure>
                  {/* Quote — primary tier, light weight, max-w to keep
                      lines short and restrained. Quote characters live
                      in the rendered string, not as decorative glyphs. */}
                  <blockquote className="text-base sm:text-lg text-ink/75 leading-relaxed font-light max-w-[36ch]">
                    “{t.quote}”
                  </blockquote>

                  {/* Attribution — caption hierarchy.
                      Name (white/65) → role (uppercase tracked white/45) →
                      org (smallest tier white/35, optional). */}
                  <figcaption className="mt-[var(--space-5)] space-y-[var(--space-1)]">
                    <p className="text-sm text-ink/65">— {t.name}</p>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-ink/45">
                      {t.role}
                    </p>
                    {t.org && (
                      <p className="text-[11px] text-ink/35">{t.org}</p>
                    )}
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
