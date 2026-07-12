/**
 * DocumentDetail
 * R6 — Documentation Archive Maturity.
 *
 * Per-document detail route at `/documentation/:id`. Reads as a
 * regulatory archive entry: dense provenance metadata, standards
 * references, batch traceability, and cross-links to associated
 * inventory and batch siblings.
 *
 * Layout posture:
 *   - No hero. No oversized imagery.
 *   - Thumbnail is a small archival reference (max-w-[280px], 3:4 aspect).
 *   - Metadata panels carry the hierarchy: Provenance, Reference.
 *   - Level 1 surface on the right column (lg+), hairline dl rows throughout.
 *
 * Cross-linking:
 *   - Associated Inventory → /product/{id} (by abbreviation lookup)
 *   - Related Documents → same batchId siblings, then product siblings
 */

import { Link, useNavigate, useParams } from 'react-router-dom';
import { cn } from '../lib/utils';
import { formatDate } from '../lib/format';
import {
  useDocument,
  useDocumentsByBatch,
  useDocumentsByProduct,
  getDocumentStatus,
} from '../hooks/useDocuments';
import { useProducts } from '../hooks/useProducts';
import { AbbreviationChip } from '../components/catalog/AbbreviationChip';
import { BatchCode, DateStamp, SKUCode } from '../components/ui/identifiers';
import { DocumentCard } from '../components/documents/DocumentCard';
import { ErrorState } from '../components/system/ErrorState';

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { document: doc, error } = useDocument(id);
  const { products } = useProducts();

  const associatedProduct = doc
    ? (products.find((p) => p.abbreviation === doc.productAbbreviation) ?? null)
    : null;

  const batchSiblings  = useDocumentsByBatch(doc?.batchId, id);
  const productSiblings = useDocumentsByProduct(doc?.productAbbreviation);

  const relatedDocs = batchSiblings.length > 0
    ? batchSiblings
    : productSiblings.filter((d) => d.id !== id).slice(0, 4);
  const relatedLabel = batchSiblings.length > 0 ? 'Same Batch' : 'Same Product';

  if (error || !doc) {
    return (
      <ErrorState
        message={error ?? 'Document unavailable.'}
        action={
          <button
            type="button"
            onClick={() => navigate('/documentation')}
            className="text-xs uppercase tracking-widest text-ink/60 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
          >
            Return to archive
          </button>
        }
      />
    );
  }

  const status = getDocumentStatus(doc);

  return (
    <article className="py-[var(--space-8)] pb-[var(--space-24)] lg:pb-[var(--space-8)]">
      {/* Breadcrumb */}
      <nav className="mb-[var(--space-6)] text-xs uppercase tracking-widest text-ink/40">
        <Link to="/documentation" className="hover:text-ink/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30">
          Documentation
        </Link>
        <span className="mx-[var(--space-2)] text-ink/20">/</span>
        <Link to="/documentation" className="hover:text-ink/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30">
          {doc.productName}
        </Link>
        <span className="mx-[var(--space-2)] text-ink/20">/</span>
        <span className="text-ink/60">{doc.documentType}</span>
      </nav>

      {/* Identifier band */}
      <div className="flex items-center flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-2)] mb-[var(--space-4)]">
        <span className="text-[11px] uppercase tracking-[0.25em] text-ink/45">
          {doc.productAbbreviation}
        </span>
        <span className="text-ink/15" aria-hidden="true">·</span>
        <BatchCode value={doc.batchId} className="text-ink/35" />
        {doc.documentVersion && (
          <>
            <span className="text-ink/15" aria-hidden="true">·</span>
            <span className="text-[11px] uppercase tracking-[0.25em] text-ink/35">
              {doc.documentVersion}
            </span>
          </>
        )}
        <span className="text-ink/15" aria-hidden="true">·</span>
        <span
          className={cn(
            'text-[11px] font-mono uppercase tracking-[0.15em]',
            status === 'expired'
              ? 'text-red-400/70'
              : 'text-[var(--color-status-success)]',
          )}
        >
          {status === 'expired' ? 'Expired' : 'Active'}
        </span>
        {doc.documentControlStatus && (
          <>
            <span className="text-ink/15" aria-hidden="true">·</span>
            <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-ink/25">
              {doc.documentControlStatus}
            </span>
          </>
        )}
        {doc.supersedes && (
          <>
            <span className="text-ink/15" aria-hidden="true">·</span>
            <span className="text-[11px] uppercase tracking-[0.2em] text-ink/25">
              Supersedes {doc.supersedes}
            </span>
          </>
        )}
      </div>

      {/* Title block */}
      <h1 className="text-3xl sm:text-4xl font-light text-ink tracking-tight leading-tight mb-[var(--space-2)]">
        {doc.productName}
      </h1>
      <p className="text-lg font-light text-ink/45 tracking-tight mb-[var(--space-8)]">
        {doc.documentType}
      </p>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-[var(--space-10)] gap-y-[var(--space-8)]">

        {/* Preview column — archival reference thumbnail, not hero */}
        <div className="lg:col-span-4">
          <div className="aspect-[3/4] w-full max-w-[280px] overflow-hidden rounded-[14px] bg-display border border-ink/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {doc.thumbnailUrl ? (
              <img
                src={doc.thumbnailUrl}
                alt={`${doc.documentType} preview`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-ink/20 text-[10px] uppercase tracking-widest">
                No preview
              </div>
            )}
          </div>

          {/* File stats — below preview, quiet mono caption */}
          {(doc.pageCount || doc.fileSizeKb) && (
            <div className="mt-[var(--space-3)] flex flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-1)]">
              {doc.pageCount !== undefined && (
                <span className="text-[10px] font-mono tabular-nums uppercase tracking-[0.15em] text-ink/35">
                  {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                </span>
              )}
              {doc.fileSizeKb !== undefined && (
                <span className="text-[10px] font-mono tabular-nums uppercase tracking-[0.15em] text-ink/35">
                  {doc.fileSizeKb} kB
                </span>
              )}
            </div>
          )}
        </div>

        {/* Metadata column — floating module on lg+ */}
        <div className="lg:col-span-8 flex flex-col gap-y-[var(--space-6)] lg:floating-module lg:p-[var(--space-6)]">

          {/* Provenance */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-ink/30 mb-[var(--space-2)]">
              Provenance
            </p>
            <dl className="divide-y divide-ink/[0.05]">
              {doc.issuer && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Issuer</dt>
                  <dd className="text-sm text-ink/70 text-right">{doc.issuer}</dd>
                </div>
              )}
              {doc.issuedBy && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Issued By</dt>
                  <dd className="text-sm text-ink/70 text-right">{doc.issuedBy}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Issued</dt>
                <dd className="text-right">
                  <DateStamp iso={doc.issuedDate} className="text-ink/70" />
                </dd>
              </div>
              {doc.reviewedAt && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Reviewed</dt>
                  <dd className="text-right">
                    <DateStamp iso={doc.reviewedAt} className="text-ink/70" />
                  </dd>
                </div>
              )}
              {doc.expiresAt && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Expires</dt>
                  <dd
                    className={cn(
                      'text-sm font-mono tabular-nums text-right',
                      status === 'expired' ? 'text-red-400/70' : 'text-ink/70',
                    )}
                  >
                    {formatDate(doc.expiresAt)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Reference */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-ink/30 mb-[var(--space-2)]">
              Reference
            </p>
            <dl className="divide-y divide-ink/[0.05]">
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Batch ID</dt>
                <dd className="text-right">
                  <BatchCode value={doc.batchId} className="text-ink/70" />
                </dd>
              </div>
              {doc.standardReference && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Standard</dt>
                  <dd className="text-sm font-mono tabular-nums text-ink/70 text-right">{doc.standardReference}</dd>
                </div>
              )}
              {doc.documentVersion && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Revision</dt>
                  <dd className="text-sm text-ink/70 text-right">{doc.documentVersion}</dd>
                </div>
              )}
              {doc.instrumentId && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-4">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">Instrument</dt>
                  <dd className="text-sm font-mono tabular-nums text-ink/70 text-right">{doc.instrumentId}</dd>
                </div>
              )}
            </dl>
          </div>

        </div>
      </div>

      {/* Associated Inventory — deep-link to the product detail route */}
      {associatedProduct && (
        <section
          className="mt-[var(--space-16)] pt-[var(--space-10)] border-t border-ink/[0.06]"
          aria-label="Associated inventory"
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-4)]">
            Associated Inventory
          </p>
          <Link
            to={`/product/${associatedProduct.id}`}
            className="group research-surface-solid p-[var(--space-4)] inline-flex items-center gap-[var(--space-4)] w-full sm:w-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
          >
            <AbbreviationChip value={associatedProduct.abbreviation} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink group-hover:text-gold transition-colors truncate">
                {associatedProduct.name}
              </p>
              <SKUCode value={associatedProduct.sku} className="text-ink/35" />
            </div>
            <span
              className="text-ink/30 group-hover:text-gold group-hover:translate-x-0.5 transition-[color,transform] duration-150 shrink-0 ml-auto"
              aria-hidden="true"
            >
              →
            </span>
          </Link>
        </section>
      )}

      {/* Related Documents — batch siblings first, then product siblings */}
      {relatedDocs.length > 0 && (
        <section
          className="mt-[var(--space-12)] pt-[var(--space-8)] border-t border-ink/[0.06]"
          aria-label="Related documents"
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-6)]">
            {relatedLabel}
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-3)] sm:gap-[var(--space-4)]">
            {relatedDocs.map((d) => (
              <li key={d.id}>
                <DocumentCard document={d} href={`/documentation/${d.id}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
