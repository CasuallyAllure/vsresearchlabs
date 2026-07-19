/**
 * Documentation
 * R6 — Documentation Archive Maturity.
 *
 * Full archive surface at `/documentation`. Upgrades the Wave 9
 * foundation gallery into a retrieval-oriented archive:
 *   - Filter by document type (COA, HPLC, MS, Sterility, Endotoxin, Cal)
 *   - Filter by issuer (QC Division, Metrology Services)
 *   - Each card routes to its per-document detail page
 *
 * Filter posture: PillTabs only — no dropdowns, no sidebars.
 * Motion scope: color-only state transitions on filter pills (PillTabs
 * intrinsic). No layout animation, no staggered reveals.
 *
 * Preserves Wave 9 invariants: Level 0 surface, hairline borders,
 * no glass on this page, type-led hierarchy.
 */

import { useState } from 'react';
import {
  useDocuments,
  useDocumentFilterOptions,
  hasSamplePlaceholders,
} from '../hooks/useDocuments';
import { PillTabs } from '../components/ui/PillTabs';
import { DocumentGallery } from '../components/documents/DocumentGallery';
import { SampleArchiveNotice } from '../components/documents/SampleArchiveNotice';
import { ArchivePreparationVeil } from '../components/documents/ArchivePreparationVeil';

const TYPE_SHORT: Record<string, string> = {
  'Certificate of Analysis':  'COA',
  'HPLC Purity Report':       'HPLC',
  'Mass Spectrometry Report': 'MS',
  'Sterility Certificate':    'Sterility',
  'Endotoxin Test Report':    'Endotoxin',
  'Calibration Certificate':  'Calibration',
};

const ISSUER_SHORT: Record<string, string> = {
  'VS Research Labs QC Division': 'QC Division',
  'VSR Metrology Services':       'Metrology',
};

export function Documentation() {
  const [activeType,   setActiveType]   = useState('all');
  const [activeIssuer, setActiveIssuer] = useState('all');

  const { types, issuers } = useDocumentFilterOptions();
  const { documents, total } = useDocuments({
    type:   activeType   !== 'all' ? activeType   : undefined,
    issuer: activeIssuer !== 'all' ? activeIssuer : undefined,
  });

  const typeTabs = [
    { id: 'all', label: 'All' },
    ...types.map((t) => ({ id: t, label: TYPE_SHORT[t] ?? t })),
  ];

  const issuerTabs = [
    { id: 'all', label: 'All Issuers' },
    ...issuers.map((i) => ({ id: i, label: ISSUER_SHORT[i] ?? i })),
  ];

  const isFiltered    = activeType !== 'all' || activeIssuer !== 'all';
  const visibleCount  = documents.length;
  const isSampleArchive = hasSamplePlaceholders(documents);

  return (
    <section className="pt-[var(--space-4)] pb-[var(--space-8)]">
      {/* Header */}
      <header className="mb-[var(--space-4)] pb-[var(--space-4)] border-b border-ink/[0.06]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Documentation
        </p>
        <h1 className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Batch </span>
          <span className="font-light text-ink">archive.</span>
        </h1>
        {/* Deck states the archive's intended structure, not a completed
            fact — the dataset behind it is still illustrative. */}
        <p className="holo-text-body mt-[var(--space-3)] max-w-[60ch] text-[13px] leading-relaxed">
          How batch-tracked certificates and reports will be filed as they
          are issued — against the same procurement abbreviations and batch
          identifiers used in inventory. Reference, not promotion.
        </p>
        <p
          className="holo-text-caption mt-[var(--space-3)] text-[10px] uppercase tracking-[0.2em]"
          aria-live="polite"
          aria-atomic="true"
        >
          {isFiltered
            ? `${visibleCount} of ${total} ${total === 1 ? 'document' : 'documents'}`
            : `${total} ${total === 1 ? 'document' : 'documents'}`}
        </p>
      </header>

      {/* Honesty disclosure — the words behind the blur below. */}
      {isSampleArchive && <SampleArchiveNotice />}

      {/* Archive filters — PillTabs only, two rows */}
      <div className="mb-[var(--space-8)] flex flex-col gap-[var(--space-3)]">
        <PillTabs
          tabs={typeTabs}
          activeId={activeType}
          onChange={setActiveType}
          ariaLabel="Filter by document type"
        />
        {issuers.length > 0 && (
          <PillTabs
            tabs={issuerTabs}
            activeId={activeIssuer}
            onChange={setActiveIssuer}
            ariaLabel="Filter by issuer"
          />
        )}
      </div>

      {/* Gallery — each card routes to its detail page. While the archive is
          illustrative the cards render blurred behind the shared seal; they
          stay reachable (`interactive`) because the detail route carries the
          same veil and the same disclosure. */}
      <ArchivePreparationVeil active={isSampleArchive} interactive>
        <DocumentGallery
          documents={documents}
          makeCardHref={(doc) => `/documentation/${doc.id}`}
          emptyLabel="No documents match the active filters."
        />
      </ArchivePreparationVeil>
    </section>
  );
}
