/**
 * Contact
 * Phase 2 — Layout clarity, hierarchy, proportions.
 * Reconciliation Pass D — Open-inquiry framing.
 *
 * The open / non-itemized inquiry surface. Subordinate to /cart for
 * itemized procurement requests; Contact handles documentation
 * requests, procurement questions outside the catalog, and general
 * operational contact.
 *
 * Static page — no forms here. Inquiry submission with line items
 * is centralized in /cart. Channel rows render as a hairline-
 * divided definition list, left-aligned and typeset.
 */

export function Contact() {
  return (
    <section className="py-[var(--space-12)]">
      <header className="mb-[var(--space-12)] max-w-[60ch]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Open Inquiries
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-white mb-[var(--space-6)]">
          <span className="font-light text-white/85">Open </span>
          <span className="font-medium text-white">channels.</span>
        </h1>
        <p className="holo-text-body text-[13px] leading-relaxed">
          Procurement questions outside the catalog, documentation
          requests, and general operational contact. Itemized
          requests are submitted via the inquiry cart from any
          product page.
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
              className="text-base text-white underline underline-offset-4 decoration-white/15 hover:decoration-white/40 transition-colors focus:outline-none focus-visible:decoration-white/55"
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
              className="text-base text-white underline underline-offset-4 tabular-nums decoration-white/15 hover:decoration-white/40 transition-colors focus:outline-none focus-visible:decoration-white/55"
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

      <p className="holo-text-caption mt-[var(--space-12)] text-[10px] uppercase tracking-[0.25em]">
        For Research Purposes Only — Not for Human Use
      </p>
    </section>
  );
}
