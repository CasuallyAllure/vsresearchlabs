// COPY STATUS: model-drafted — requires owner review before launch. Do not treat as legal advice.

/**
 * Privacy — /privacy
 *
 * Honest, conservative privacy notice. Scope is deliberately narrow: we only
 * describe what the site and backend actually do (verified against src/ and
 * index.html — no analytics/tracking pixels found in this codebase as of
 * this writing), the processors actually wired up (Supabase, Resend,
 * Cloudflare/Turnstile), and plain retention/deletion language.
 */

import { LegalPage, LegalSection } from './LegalPage';

export function Privacy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title={
        <>
          <span className="text-ink/85">Privacy </span>
          <span className="text-ink">policy.</span>
        </>
      }
      intro="How VS Research Labs collects, uses, and protects information submitted through this site."
      lastUpdated="July 2026"
    >
      <LegalSection title="Information we collect">
        <p>
          We collect the information you give us directly: contact details
          (name, email, phone), order or inquiry information (products,
          quantities, shipping address), and order history tied to that
          contact information. If you create an account, we store the
          profile details you provide. We do not collect information from
          you beyond what is needed to respond to an inquiry or fulfill an
          order.
        </p>
      </LegalSection>

      <LegalSection title="Why we collect it">
        <p>
          Information is used to fulfill inquiries and orders, respond to
          messages sent through the contact form, verify buyer eligibility
          where applicable, and maintain order records for support and
          accounting purposes. We do not use your information for anything
          beyond these operational purposes.
        </p>
      </LegalSection>

      <LegalSection title="Who processes it">
        <p>
          We rely on a small set of service providers to operate the site
          and fulfill orders:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-ink">Supabase</strong> — database and
            authentication for order records, inquiries, and customer
            accounts.
          </li>
          <li>
            <strong className="text-ink">Resend</strong> — transactional
            email (order confirmations, inquiry responses, account
            notifications).
          </li>
          <li>
            <strong className="text-ink">Cloudflare</strong> — site hosting
            and bot protection (Turnstile) on forms.
          </li>
        </ul>
        <p>
          We do not use advertising trackers, marketing pixels, or
          third-party analytics on this site. Any logs we keep are
          operational — for security, debugging, and fraud prevention — not
          for tracking or profiling visitors.
        </p>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We keep information for as long as it is needed for business
          records — order history, accounting, and support continuity. We
          do not keep data indefinitely for its own sake, and we do not
          retain information beyond what a reasonable business record
          requires.
        </p>
      </LegalSection>

      <LegalSection title="Requesting deletion">
        <p>
          To request that we delete your personal information, reach out
          through the contact page. We will honor deletion requests except
          where we are required to retain records for legal, accounting, or
          fraud-prevention purposes.
        </p>
      </LegalSection>

      <LegalSection title="No sale of personal data">
        <p>
          We do not sell, rent, or trade personal information to any third
          party for any purpose.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
