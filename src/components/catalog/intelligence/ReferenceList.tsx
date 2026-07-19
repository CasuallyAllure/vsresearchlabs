/**
 * ReferenceList — canonical dossier reference renderer
 *
 * A numbered reference list, one row per citation, each resolving to a
 * permanent identifier. Precedence is by permanence (PMID → DOI → URL), the
 * same rule `studyCitationHref` applies to study records.
 *
 * Integrity contract: nothing here is authored. Every entry is seeded from a
 * study record whose identifier was resolved against PubMed or a DOI
 * registrar. A reference with no resolvable identifier is not admissible and
 * renders as plain text with no link rather than a link to nowhere.
 *
 * Chrome is inherited — this renders inside `ModuleBody` within an
 * `IntelModule`, and declares no panel, border, or spacing of its own beyond
 * the row rhythm.
 */

import type { CompoundReference } from '../../../types';
import { referenceHref } from '../../../types';

function ExternalLinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/** Short identifier label shown under a citation ("PMID 37366315"). */
function identifierLabel(ref: CompoundReference): string | null {
  if (ref.pmid) return `PMID ${ref.pmid}`;
  if (ref.doi) return `DOI ${ref.doi}`;
  return null;
}

export function ReferenceList({ references }: { references: CompoundReference[] }) {
  if (references.length === 0) return null;

  return (
    <ol className="space-y-2.5">
      {references.map((ref, i) => {
        const href = referenceHref(ref);
        const identifier = identifierLabel(ref);
        return (
          <li key={ref.pmid ?? ref.doi ?? ref.url ?? i} className="flex items-start gap-2.5">
            <span className="font-mono text-ink/20 tabular-nums shrink-0 pt-[3px]" style={{ fontSize: '10px', minWidth: '14px' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ink/62 leading-snug" style={{ fontSize: '11.5px' }}>
                {ref.citation}
              </p>
              {identifier && (
                <p className="mt-1 font-mono text-ink/32 tabular-nums" style={{ fontSize: '10px' }}>
                  {identifier}
                </p>
              )}
            </div>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink/22 hover:text-ink/65 transition-colors shrink-0 mt-[3px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 rounded-sm"
                aria-label={`Open reference: ${ref.citation}`}
              >
                <ExternalLinkIcon />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
