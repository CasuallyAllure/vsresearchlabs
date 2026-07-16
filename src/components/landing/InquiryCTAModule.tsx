/**
 * InquiryCTAModule
 * Wave 11 — Final Inquiry CTA.
 *
 * Closes Landing with a restrained inquiry invitation. Designed to
 * feel like a formal procurement intake desk, NOT a sales funnel.
 *
 * Surface posture (anti-drift):
 *   - Fully flat. No glass, no elevated panels, no atmospheric styling.
 *   - Hairline grammar matches the rest of Landing (border-b only).
 *   - Single CTA — no stacked buttons, no secondary link, no urgency
 *     timer, no conversion gimmicks.
 *
 * CTA architecture:
 *   - Routes to `/contact`, the existing open-ended inquiry surface.
 *   - The pill / gold / uppercase-tracked button shape is the
 *     established CTA primitive used elsewhere (ProductPage's
 *     "Add to Inquiry"). Reusing it here is consistency, not novelty.
 *
 * Voice posture:
 *   - Heading is a 2-word noun-led declaration ("Inquiries open.").
 *   - Body is a single dry sentence anchored in earlier waves'
 *     claims (volume requests, dose tiers, equipment configurations,
 *     one-business-day turnaround).
 */

import { Link } from 'react-router-dom';

export function InquiryCTAModule() {
  return (
    <section
      className="-mx-[var(--page-gutter)] border-b border-ink/[0.06]"
      aria-label="Open a procurement inquiry"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-16)] sm:py-[var(--space-20)]">
        {/* Eyebrow + heading band — same restrained tier used by the
            other Landing closing sections. */}
        <p className="text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-4)]">
          Inquiry
        </p>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-light text-ink tracking-tight leading-[1.1] max-w-[24ch] mb-[var(--space-6)]">
          Inquiries open.
        </h2>

        {/* Single context paragraph. Dry, anchored in prior waves. */}
        <p className="text-base sm:text-lg text-ink/65 leading-relaxed max-w-[60ch] mb-[var(--space-8)]">
          Volume requests, custom dose tiers, and equipment
          configurations are quoted by inquiry. A response follows
          within one business day.
        </p>

        {/* Single CTA — pill / gold / uppercase tracked. Mirrors the
            established ProductPage "Add to Inquiry" CTA shape, so the
            primary-action affordance reads consistently across the app. */}
        <Link
          to="/contact"
          className="inline-flex items-center justify-center px-[var(--space-8)] py-[var(--space-4)] rounded-full bg-gold text-ink text-xs uppercase tracking-[0.25em] font-medium transition-colors duration-150 hover:bg-gold-light focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base-900"
        >
          Open a procurement inquiry
        </Link>
      </div>
    </section>
  );
}
