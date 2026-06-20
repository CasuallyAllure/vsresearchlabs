/**
 * DocumentSlot — fixed-slot documentation architecture
 *
 * Renders the four canonical document slot rows for a product:
 *   - Certificate of Analysis (COA)
 *   - HPLC Analysis
 *   - Mass Spectrometry
 *   - Sterility Report
 *
 * Always renders ALL FOUR slots, even when no documents exist yet. The
 * documentation architecture is visible before files exist — the user
 * immediately understands which document types this product supports.
 *
 * When a Document is on file for a slot, the row renders as a clickable
 * card with thumbnail, title, issue date, and view action. When the slot
 * is empty, it renders as "Awaiting Upload" — a structural placeholder
 * that names the future action without faking content.
 *
 * Future upload action wiring belongs in admin/auth work (not this pass).
 * The button is structural-only here.
 *
 * No backend, no auth, no fabricated data.
 */

import { Link } from 'react-router-dom';
import type { Document, DocumentTypeLabel } from '../../types';
import { DateStamp } from '../ui/identifiers';

/**
 * Canonical four-slot manifest. Order is fixed: COA → HPLC → Mass Spec
 * → Sterility. New document types added later go into the manifest by
 * editing this file in one place.
 */
interface SlotDef {
  /** Display label shown on the slot header. */
  label: string;
  /** Short identifier shown as the slot abbreviation chip. */
  abbreviation: string;
  /** Document.documentType values that fill this slot. */
  documentTypes: DocumentTypeLabel[];
}

const SLOTS: SlotDef[] = [
  {
    label: 'Certificate of Analysis',
    abbreviation: 'COA',
    documentTypes: ['Certificate of Analysis'],
  },
  {
    label: 'HPLC Analysis',
    abbreviation: 'HPLC',
    documentTypes: ['HPLC Purity Report'],
  },
  {
    label: 'Mass Spectrometry',
    abbreviation: 'MS',
    documentTypes: ['Mass Spectrometry Report'],
  },
  {
    label: 'Sterility Report',
    abbreviation: 'STERILITY',
    documentTypes: ['Sterility Certificate'],
  },
];

interface DocumentSlotProps {
  /** All documents associated with this product (typically from `useDocumentsByProduct`). */
  documents: Document[];
}

export function DocumentSlot({ documents }: DocumentSlotProps) {
  return (
    <ul className="space-y-[var(--space-3)]" aria-label="Product documentation slots">
      {SLOTS.map((slot) => {
        const match = documents.find((d) =>
          slot.documentTypes.includes(d.documentType as DocumentTypeLabel),
        );
        return (
          <li key={slot.abbreviation}>
            {match ? (
              <FilledSlot slot={slot} document={match} />
            ) : (
              <EmptySlot slot={slot} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Filled slot ────────────────────────────────────────────────────────── */

function FilledSlot({ slot, document }: { slot: SlotDef; document: Document }) {
  return (
    <Link
      to={`/documentation/${document.id}`}
      className="block rounded-[4px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
      aria-label={`${slot.label} for ${document.productName} — view document`}
    >
      <article
        className="group flex items-center gap-[var(--space-4)] p-[var(--space-3)] transition-colors"
        style={{
          backgroundColor: 'var(--color-interactive-secondary)',
          border: '1px solid var(--color-border-subtle)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-interactive-secondary)';
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-interactive-secondary)';
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)';
        }}
      >
        {/* Thumbnail — small document-aspect plate */}
        <div className="shrink-0 w-14 aspect-[3/4] overflow-hidden bg-display border border-ink/[0.09]">
          {document.thumbnailUrl ? (
            <img
              src={document.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              aria-hidden="true"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-ink/22">
                {slot.abbreviation}
              </span>
            </div>
          )}
        </div>

        {/* Metadata column */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex items-baseline gap-[var(--space-2)] flex-wrap">
            <span
              className="font-mono text-[9px] uppercase tabular-nums tracking-[0.2em] text-ink/55"
              style={{
                padding: '1px 5px',
                borderRadius: '2px',
                border: '1px solid var(--color-border-subtle)',
                backgroundColor: 'var(--color-interactive-secondary)',
              }}
            >
              {slot.abbreviation}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-ink/45 truncate">
              {slot.label}
            </span>
          </div>
          <p className="mt-[var(--space-1)] text-[11.5px] text-ink/70 truncate">
            {document.productName}
            {document.documentVersion && (
              <span className="ml-2 text-ink/35 font-mono">
                {document.documentVersion}
              </span>
            )}
          </p>
          <p className="mt-[var(--space-1)] text-[10px] text-ink/40 truncate">
            Issued <DateStamp iso={document.issuedDate} className="text-ink/55" />
            {document.issuer && (
              <>
                <span className="mx-1 text-ink/20" aria-hidden="true">·</span>
                <span className="text-ink/45">{document.issuer}</span>
              </>
            )}
          </p>
        </div>

        {/* View action */}
        <span
          aria-hidden="true"
          className="shrink-0 text-ink/30 transition-colors group-hover:text-gold"
          style={{ fontSize: '14px' }}
        >
          →
        </span>
      </article>
    </Link>
  );
}

/* ── Empty slot — "Awaiting Upload" ─────────────────────────────────────── */

function EmptySlot({ slot }: { slot: SlotDef }) {
  return (
    <article
      className="flex items-center gap-[var(--space-4)] p-[var(--space-3)]"
      style={{
        backgroundColor: 'transparent',
        border: '1px dashed var(--color-border-subtle)',
      }}
      aria-label={`${slot.label} — awaiting upload`}
    >
      {/* Empty thumbnail plate */}
      <div className="shrink-0 w-14 aspect-[3/4] flex items-center justify-center bg-display/40 border border-ink/[0.05]">
        <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-ink/22">
          {slot.abbreviation}
        </span>
      </div>

      {/* Metadata column */}
      <div className="flex flex-1 min-w-0 flex-col">
        <div className="flex items-baseline gap-[var(--space-2)] flex-wrap">
          <span
            className="font-mono text-[9px] uppercase tabular-nums tracking-[0.2em] text-ink/35"
            style={{
              padding: '1px 5px',
              borderRadius: '2px',
              border: '1px solid var(--color-border-subtle)',
              backgroundColor: 'var(--color-interactive-secondary)',
            }}
          >
            {slot.abbreviation}
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-ink/35 truncate">
            {slot.label}
          </span>
        </div>
        <p className="mt-[var(--space-1)] text-[11px] text-ink/35">
          Awaiting Upload
        </p>
      </div>

      {/* Status indicator — no action, structural only */}
      <span
        className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-ink/22"
        aria-hidden="true"
      >
        Pending
      </span>
    </article>
  );
}
