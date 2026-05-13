/**
 * Contact
 * Phase 2 — Layout clarity, hierarchy, proportions.
 *
 * Static contact page. No forms, no integrations. Inventory-only:
 * existing page rebuilt with no glass surfaces. Channel rows render
 * as a hairline-divided definition list, left-aligned and typeset.
 */

export function Contact() {
  return (
    <section className="py-[var(--space-12)]">
      <header className="mb-[var(--space-12)] max-w-[60ch]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
          Get in touch
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight mb-[var(--space-6)]">
          Contact
        </h1>
        <p className="text-sm sm:text-base text-white/60 leading-relaxed">
          For research inquiries and product questions, please reach out using
          the channels below. Our team typically responds within one business
          day.
        </p>
      </header>

      <dl className="border-t border-white/[0.06] max-w-[60ch]">
        <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[160px_1fr] gap-[var(--space-6)] py-[var(--space-5)] border-b border-white/[0.06]">
          <dt className="text-[11px] uppercase tracking-[0.25em] text-white/40 pt-1">
            Email
          </dt>
          <dd>
            <a
              href="mailto:inquiries@vsresearchlabs.com"
              className="text-base text-white hover:text-gold transition-colors"
            >
              inquiries@vsresearchlabs.com
            </a>
          </dd>
        </div>

        <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[160px_1fr] gap-[var(--space-6)] py-[var(--space-5)] border-b border-white/[0.06]">
          <dt className="text-[11px] uppercase tracking-[0.25em] text-white/40 pt-1">
            Phone
          </dt>
          <dd>
            <a
              href="tel:+18005550100"
              className="text-base text-white hover:text-gold transition-colors"
            >
              +1 (800) 555-0100
            </a>
          </dd>
        </div>

        <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[160px_1fr] gap-[var(--space-6)] py-[var(--space-5)] border-b border-white/[0.06]">
          <dt className="text-[11px] uppercase tracking-[0.25em] text-white/40 pt-1">
            Address
          </dt>
          <dd className="text-sm text-white/70 leading-relaxed">
            VS Research Labs
            <br />
            Research Operations
            <br />
            United States
          </dd>
        </div>
      </dl>

      <p className="mt-[var(--space-12)] text-[11px] uppercase tracking-[0.25em] text-white/35">
        For Research Purposes Only — Not for Human Use
      </p>
    </section>
  );
}
