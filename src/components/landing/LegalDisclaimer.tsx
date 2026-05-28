/**
 * LegalDisclaimer
 * Wave 11 — Legal Disclaimer Foundation.
 *
 * Compliance-oriented closing posture for Landing. Five short,
 * procedural paragraphs covering:
 *   1. Research-use-only / no human or animal consumption
 *   2. No FDA evaluation / no therapeutic, cosmetic, dietary claims
 *   3. Buyer-side responsibility (qualified personnel, regulatory
 *      compliance)
 *   4. Documentation framing (audit / reconciliation, not fitness
 *      representation)
 *   5. Reserved right to verify or decline inquiries
 *
 * Surface posture (anti-drift):
 *   - Fully flat. No glass, no elevated panels, no warning-box
 *     framing (no red borders, no alert iconography, no exclamation
 *     marks).
 *   - Small type is permitted by the brief — body is `text-xs` with
 *     restrained line-height to read as procedural fine print.
 *   - Hairline grammar matches the rest of Landing.
 *
 * Voice posture:
 *   - Dense, procedural, neutral, legally conventional.
 *   - Increases trust through seriousness, NOT through fear or
 *     aggression. No "WARNING:" prefix, no all-caps shouting.
 *
 * Note: This is a foundation disclaimer suitable for procurement of
 * research-grade peptides and laboratory equipment. It does NOT
 * constitute legal advice. The text should be reviewed by counsel
 * before production launch.
 */

export function LegalDisclaimer() {
  return (
    <section
      className="-mx-[var(--space-6)] border-b border-white/[0.06]"
      aria-label="Legal disclosure"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-12)] sm:py-[var(--space-16)]">
        {/* Eyebrow — even quieter than other Landing eyebrows.
            The disclosure should not announce itself. */}
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/35 mb-[var(--space-5)]">
          Disclosure
        </p>

        {/* Procedural body — five short paragraphs. Tight measure
            (max-w 80ch) for fine-print readability. */}
        <div className="space-y-[var(--space-3)] max-w-[80ch] text-xs text-white/45 leading-relaxed">
          <p>
            All products listed on this site are sold strictly for in
            vitro research and laboratory reference use. Products are
            not intended for diagnosis, treatment, cure, or prevention
            of any disease, and are not intended for human or animal
            consumption.
          </p>

          <p>
            No statement on this site has been evaluated by the U.S.
            Food and Drug Administration. Nothing on this site
            constitutes medical advice or a recommendation for
            therapeutic, cosmetic, dietary, or investigational use in
            humans.
          </p>

          <p>
            Buyers represent that all materials are procured for
            legitimate research, educational, or industrial purposes by
            qualified personnel operating within an appropriate
            institutional or laboratory setting. Compliance with all
            applicable federal, state, and local regulations governing
            the receipt, handling, storage, and disposition of research
            materials is the buyer's responsibility.
          </p>

          <p>
            Documentation, batch references, and certificates of
            analysis are made available for inventory reconciliation and
            procurement audit purposes. They do not constitute
            representations of fitness for any purpose outside the
            stated research context.
          </p>

          <p>
            VS Research Labs reserves the right to verify buyer
            eligibility, request institutional documentation, or
            decline any inquiry without further explanation.
          </p>
        </div>
      </div>
    </section>
  );
}
