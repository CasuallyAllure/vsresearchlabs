/**
 * PositioningBlock
 * Wave 8 — Landing Positioning Block.
 *
 * Identity calibration, not conversion pressure.
 *
 * Sits between the hero and the Categories list on `/`. Establishes
 * procurement-oriented identity and operational seriousness so the
 * catalog rows that follow read as a research procurement workflow,
 * not a storefront.
 *
 * Surface posture (anti-drift):
 *   - Fully flat. No glass, no backdrop-blur, no elevated surface.
 *   - Hairline grammar only — `border-b border-white/[0.06]` to close
 *     the block against the Categories section that follows.
 *   - No imagery, no badges, no CTA button.
 *   - Typography and spacing carry the entire hierarchy.
 *
 * Voice posture:
 *   - Short, dry, noun-led, editorial, restrained, credible.
 *   - References the actual schema vocabulary (family, dose tier,
 *     abbreviation) introduced in Wave 7c so the positioning is
 *     anchored in real operational primitives, not marketing copy.
 *   - One quiet inline link/chevron toward /contact for inquiry
 *     follow-up. No primary button.
 */

import { Link } from 'react-router-dom';

export function PositioningBlock() {
  return (
    <section
      className="-mx-[var(--space-6)] border-b border-white/[0.06]"
      aria-label="Procurement positioning"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-16)] sm:py-[var(--space-20)]">
        {/* Eyebrow — matches the restrained tier used by the Categories
            section ("Catalog"), not the gold brand-identifier tier the
            hero uses. The block is mid-page metadata, not a brand callout. */}
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-[var(--space-6)]">
          Procurement
        </p>

        {/* Display heading — two parallel noun-led statements.
            One step below the hero h1 in scale so the hero remains the
            loudest element on the page. */}
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-light text-white tracking-tight leading-[1.1] max-w-[22ch] mb-[var(--space-8)]">
          Inventory-first.
          <br />
          Inquiry-led.
        </h2>

        {/* Body — two restrained paragraphs.
            Para 1: documentation discipline + procurement positioning.
            Para 2: inquiry-first architecture + scientific restraint. */}
        <div className="space-y-[var(--space-5)] max-w-[60ch]">
          <p className="text-base sm:text-lg text-white/65 leading-relaxed">
            Every SKU carries a documented family, dose tier, and
            procurement abbreviation. The catalog is structured for
            repeat workflows — research environments that re-order,
            audit, and reconcile against the same identifiers session
            over session.
          </p>
          <p className="text-base sm:text-lg text-white/55 leading-relaxed">
            Pricing and availability are confirmed by inquiry, not by
            listing. Volume requests, custom dose tiers, and equipment
            configurations are quoted directly. No flash promotions,
            no urgency timers, no consumer-grade marketing furniture.
          </p>
        </div>

        {/* Optional quiet inline link — chevron only, caption tier.
            NOT a button. Matches the kerning and tracking already used
            by other quiet links across the site. */}
        <div className="mt-[var(--space-8)]">
          <Link
            to="/contact"
            className="inline-flex items-center gap-[var(--space-2)] text-[11px] uppercase tracking-[0.3em] text-white/55 hover:text-white transition-colors group focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            <span>Inquire about volume or custom configurations</span>
            <span
              aria-hidden="true"
              className="text-white/35 group-hover:text-gold group-hover:translate-x-0.5 transition-[color,transform] duration-150"
            >
              →
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
