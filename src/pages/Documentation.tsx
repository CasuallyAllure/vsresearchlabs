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
import { useDocuments, useDocumentFilterOptions } from '../hooks/useDocuments';
import { PillTabs } from '../components/ui/PillTabs';
import { DocumentGallery } from '../components/documents/DocumentGallery';

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

  return (
    <section className="py-[var(--space-8)]">
      {/* Header */}
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-[var(--space-3)]">
          Documentation
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
          Archive
        </h1>
        <p className="mt-[var(--space-3)] text-sm text-white/55 max-w-[60ch] leading-relaxed">
          Batch-tracked certificates and reports across the active
          catalog. Filed against the same procurement abbreviations and
          batch identifiers used in inventory. Reference, not promotion.
        </p>
        <p
          className="mt-[var(--space-3)] text-[11px] uppercase tracking-[0.2em] text-white/40"
          aria-live="polite"
          aria-atomic="true"
        >
          {isFiltered
            ? `${visibleCount} of ${total} ${total === 1 ? 'document' : 'documents'}`
            : `${total} ${total === 1 ? 'document' : 'documents'}`}
        </p>
      </header>

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

      {/* Gallery — each card routes to its detail page */}
      <DocumentGallery
        documents={documents}
        makeCardHref={(doc) => `/documentation/${doc.id}`}
        emptyLabel="No documents match the active filters."
      />
    </section>
  );
}
