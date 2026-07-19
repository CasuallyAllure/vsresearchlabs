// COPY STATUS: model-drafted — requires owner review before launch. Do not treat as legal advice.

/**
 * Shipping — /shipping
 *
 * Mirrors the site's existing S1–S4 operational sequence (see SEQUENCE in
 * src/pages/Landing.tsx) and repeats the Bay Area delivery claim exactly as
 * stated in the Landing hero copy — no embellishment. Includes a storage
 * note because several catalog items specify cold storage
 * (see "Storage" fields in src/data/products.json, e.g. "−20°C, desiccated").
 */

import { LegalPage, LegalSection } from './LegalPage';

export function Shipping() {
  return (
    <LegalPage
      eyebrow="Legal"
      title={
        <>
          <span className="text-ink/85">Shipping &amp; </span>
          <span className="text-ink">fulfilment.</span>
        </>
      }
      intro="How an inquiry moves from request to delivery, and what to expect from packaging and carrier handoff."
      lastUpdated="July 2026"
    >
      <LegalSection title="Order sequence">
        <p>Every order moves through the same four stages:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-ink">Inquiry</strong> — catalog
            identifiers, dose tiers, and volumes submitted as a structured
            request.
          </li>
          <li>
            <strong className="text-ink">Verification</strong> — buyer
            eligibility and institutional context reviewed before
            quotation.
          </li>
          <li>
            <strong className="text-ink">Quotation</strong> — pricing, lead
            time, and batch availability confirmed in writing.
          </li>
          <li>
            <strong className="text-ink">Fulfilment</strong> — release
            against documented batch references with certificates on file.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Bay Area delivery">
        <p>
          Same-day and next-day delivery is available across the Bay Area
          on select orders. Availability depends on order contents,
          delivery zone, and timing of payment verification. Orders outside
          these zones ship via standard carrier with tracking provided.
        </p>
      </LegalSection>

      <LegalSection title="Packaging">
        <p>
          Shipments are packed in protective, research-appropriate
          packaging suited to each compound's storage requirements.
          Contents, batch references, and handling requirements are
          identified on the enclosed documentation.
        </p>
      </LegalSection>

      <LegalSection title="Storage and handling">
        <p>
          Some compounds require cold, desiccated storage upon arrival
          (product-specific storage requirements are listed on each
          product's specification panel). Please have appropriate storage
          in place before your shipment arrives, and inspect and store
          items promptly on receipt.
        </p>
      </LegalSection>

      <LegalSection title="Tracking">
        <p>
          Once an order ships, tracking is provided through the carrier
          handling the shipment. Order status and tracking can be checked
          any time from the track order page.
        </p>
      </LegalSection>

      <LegalSection title="Shipping restrictions">
        <p>
          We ship only to jurisdictions where receipt of research
          compounds and laboratory equipment is lawful. Buyers are
          responsible for ensuring that receiving a shipment is lawful in
          their jurisdiction and institution before placing an order.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
