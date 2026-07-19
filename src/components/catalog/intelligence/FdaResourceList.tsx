/**
 * FdaResourceList — verified regulatory / registry resources
 *
 * Renders the primary-source records behind a compound's regulatory status:
 * the Drugs@FDA approval record, the current DailyMed prescribing label, and
 * registered ClinicalTrials.gov studies.
 *
 * Integrity contract: every URL in the data was fetched and confirmed to name
 * the correct active ingredient before it was recorded. A compound with no
 * approved counterpart and no registered trial carries an empty array and this
 * module does not render at all — the absence is the accurate statement, and
 * it is deliberately not padded with a search query standing in for a record.
 *
 * Chrome is inherited from `IntelModule` / `ModuleBody`.
 */

import type { FdaResource, FdaResourceKind } from '../../../types';

/** Short provenance label for the source register a resource belongs to. */
const KIND_LABEL: Record<FdaResourceKind, string> = {
  'drugs-at-fda': 'Drugs@FDA',
  'dailymed': 'DailyMed',
  'clinical-trial': 'ClinicalTrials.gov',
  'fda-guidance': 'FDA Guidance',
};

function ExternalLinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function FdaResourceList({ resources }: { resources: FdaResource[] }) {
  if (resources.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {resources.map((resource) => (
        <li key={resource.url}>
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2.5 rounded-[var(--radius-field)] px-2.5 py-2 transition-colors hover:bg-ink/[0.035] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
            style={{ border: '1px solid var(--color-border-subtle)' }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-ink/30 uppercase" style={{ fontSize: '10px', letterSpacing: '0.18em' }}>
                {KIND_LABEL[resource.kind]}
              </p>
              <p className="mt-1 text-ink/62 leading-snug group-hover:text-ink/80 transition-colors" style={{ fontSize: '11.5px' }}>
                {resource.label}
              </p>
            </div>
            <span className="text-ink/22 group-hover:text-ink/65 transition-colors shrink-0 mt-[3px]" aria-hidden="true">
              <ExternalLinkIcon />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
