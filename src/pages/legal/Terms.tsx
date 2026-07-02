// COPY STATUS: model-drafted — requires owner review before launch. Do not treat as legal advice.

/**
 * Terms — /terms
 *
 * Research-use-only terms of sale. Reuses the research-use-only language
 * from src/components/landing/LegalDisclaimer.tsx, folds in a conservative
 * returns/refunds section, and states the inquiry-based ordering model
 * plainly. No invented certifications, guarantees, or jurisdiction-specific
 * clauses.
 */

import { LegalPage, LegalSection } from './LegalPage';

export function Terms() {
  return (
    <LegalPage
      eyebrow="Legal"
      title={
        <>
          <span className="text-ink/85">Terms of </span>
          <span className="text-ink">sale.</span>
        </>
      }
      intro="The terms that govern inquiries, quotations, and orders placed through VS Research Labs."
      lastUpdated="July 2026"
    >
      <LegalSection title="Research use only">
        <p>
          All products listed on this site are sold strictly for in vitro
          research and laboratory reference use. Products are not intended
          for diagnosis, treatment, cure, or prevention of any disease, and
          are not intended for human or animal consumption.
        </p>
        <p>
          Buyers represent that all materials are procured for legitimate
          research, educational, or industrial purposes by qualified
          personnel operating within an appropriate institutional or
          laboratory setting. Compliance with all applicable federal,
          state, and local regulations governing the receipt, handling,
          storage, and disposition of research materials is the buyer's
          responsibility.
        </p>
      </LegalSection>

      <LegalSection title="Inquiry-based ordering">
        <p>
          Our catalog operates on an inquiry model. Submitting an inquiry or
          an order request through this site is not a binding acceptance —
          it is a request for a quotation. VS Research Labs may decline any
          inquiry, in whole or in part, without further explanation.
        </p>
        <p>
          Pricing is confirmed by written invoice, not by any price shown
          during browsing. An order is considered accepted only once an
          invoice has been issued and payment has been verified.
        </p>
      </LegalSection>

      <LegalSection title="Payment terms">
        <p>
          Orders are processed after payment verification. Fulfillment
          begins once payment against the issued invoice has cleared. We
          reserve the right to request additional verification before
          processing an order.
        </p>
      </LegalSection>

      <LegalSection title="Returns and refunds">
        <p>
          Because of the nature of research compounds, they are not
          returnable once shipped, except where the shipment was affected
          by a shipping error, or the item received was damaged or
          incorrect. Any such issue must be reported promptly upon receipt
          so we can investigate and make it right.
        </p>
        <p>
          Laboratory equipment returns are evaluated case-by-case; reach out
          via the contact page and we'll work through the specifics with
          you.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          Products are provided on an as-is basis for the research
          purposes described above. To the fullest extent permitted by law,
          VS Research Labs is not liable for any indirect, incidental, or
          consequential damages arising from the use, handling, or storage
          of products purchased through this site. Our total liability for
          any claim relating to an order is limited to the amount paid for
          that order.
        </p>
      </LegalSection>

      <LegalSection title="Buyer responsibility">
        <p>
          Buyers are solely responsible for ensuring that their purchase,
          receipt, and use of any product complies with all laws and
          regulations applicable in their jurisdiction and institution. VS
          Research Labs reserves the right to verify buyer eligibility,
          request institutional documentation, or decline any inquiry
          without further explanation.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
