// COPY STATUS: model-drafted — requires owner review before launch. Do not treat as legal advice.

/**
 * About — /about
 *
 * Short, honest company page. Reuses the "Operating standards" copy from
 * src/pages/Landing.tsx (STANDARDS array) verbatim. Deliberately excludes
 * team members, founding story, certifications, and customer counts per
 * scope.
 */

import { Link } from 'react-router-dom';
import { LegalPage, LegalSection } from './LegalPage';

export function About() {
  return (
    <LegalPage
      eyebrow="Company"
      title={
        <>
          <span className="text-ink/85">About </span>
          <span className="text-ink">VS Research Labs.</span>
        </>
      }
      intro="A research-supply company operating out of Northern California."
      lastUpdated="July 2026"
    >
      <LegalSection title="Who we are">
        <p>
          VS Research Labs operates under Velari Systems LLC, based in
          Northern California. We supply peptides, nootropics,
          skincare-grade compounds, and laboratory equipment for research
          use.
        </p>
      </LegalSection>

      <LegalSection title="How we work">
        <p>
          Our catalog runs on an inquiry-led procurement model: requests are
          submitted, verified, quoted, and fulfilled against documented
          batch references — not sold off an open storefront checkout.
        </p>
      </LegalSection>

      <LegalSection title="Operating standards">
        <ul className="space-y-3">
          <li>
            <p>
              Certificates of analysis and batch confirmation are available
              before request — not produced after the fact.
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink/40">
              Documentation
            </p>
          </li>
          <li>
            <p>
              Batch references stay consistent session over session, so
              intake records reconcile in minutes, not a cycle.
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink/40">
              Traceability
            </p>
          </li>
          <li>
            <p>
              Inquiries — including repeat dose tiers and custom volumes —
              are quoted within one business day.
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink/40">
              Turnaround
            </p>
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Get in touch">
        <p>
          For procurement questions, documentation requests, or anything
          else, reach us through the{' '}
          <Link
            to="/contact"
            className="text-ink underline underline-offset-4 decoration-ink/20 hover:decoration-ink/60 transition-colors"
          >
            contact page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
