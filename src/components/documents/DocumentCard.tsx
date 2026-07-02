/**
 * DocumentCard
 * Wave 9 — Documentation Library Foundation.
 *
 * Renders a single procurement document as a Level 1 solid surface
 * with archival metadata hierarchy. Used inside `DocumentGallery` on
 * both the Landing preview and the full `/documentation` route.
 *
 * Layout posture (anti-drift):
 *   - Horizontal composition: small document-aspect thumbnail on the
 *     left, stacked metadata on the right. Reads as a folder-index
 *     entry, NOT a product hero card.
 *   - Thumbnail uses A4-style 3:4 aspect with `object-cover` against a
 *     `bg-base-800` plate so the placeholder renders without ceremony.
 *   - Surface is `.research-surface-solid` — Level 1, hairline border,
 *     no glass, no backdrop-blur. No shadow lift on hover; the surface
 *     utility's intrinsic restrained hover is the only affordance.
 *   - Metadata hierarchy from quietest to loudest: document-type
 *     eyebrow → product name (primary) → batch & date caption →
 *     "View document" inline action.
 *
 * Voice posture:
 *   - Document type is the eyebrow (procedural framing).
 *   - Product name is the primary (links the doc to the inventory).
 *   - Batch + date sits as a tabular-nums caption (archival).
 *   - "View document" is a caption-tier inline action with chevron —
 *     restrained, NOT a CTA button.
 *
 * Future-compat:
 *   - `href` is optional. Wave 9 routes everything to `/documentation`
 *     since per-document viewers are deferred. When `href` is omitted,
 *     the card renders without an action affordance.
 */

import { Link } from 'react-router-dom';
import type { Document } from '../../types';
import { BatchCode, DateStamp } from '../ui/identifiers';

interface DocumentCardProps {
  document: Document;
  /**
   * Optional target href for the whole card. When provided, the
   * primary surface becomes a `<Link>`. Caller-controlled so the
   * Landing preview can route to `/documentation` while a future
   * detail experience can route to per-document URLs.
   */
  href?: string;
}

export function DocumentCard({ document, href }: DocumentCardProps) {

  const inner = (
    <article className="research-surface-solid group flex h-full items-stretch overflow-hidden">
      {/* Document plate — full-height, flush to the card's left edge with a
          registration tick. Reads as a filed record, not a thumbnail card. */}
      <div className="relative w-20 shrink-0 self-stretch overflow-hidden border-r border-ink/[0.09] bg-display sm:w-24">
        {document.thumbnailUrl ? (
          <img
            src={document.thumbnailUrl}
            alt={`${document.documentType} for ${document.productName}`}
            className="h-full w-full object-cover opacity-90 transition-opacity duration-300 group-hover:opacity-100"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-widest text-ink/20">
            Doc
          </div>
        )}
        <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t border-ink/25" />
      </div>

      {/* Metadata column — eyebrow → serif product name → archival caption. */}
      <div className="flex min-w-0 flex-1 flex-col p-[var(--space-4)]">
        <p className="mb-[var(--space-1)] truncate text-[10px] uppercase tracking-[0.2em] text-ink/45">
          {document.documentType}{document.documentVersion ? ` · ${document.documentVersion}` : ''}
        </p>
        <h3 className="truncate font-serif text-[19px] font-normal leading-tight text-ink transition-colors group-hover:text-gold">
          {document.productName}
        </h3>
        {document.issuer && (
          <p className="truncate text-[10px] text-ink/35">
            {document.issuer}
          </p>
        )}
        <p className="mt-[var(--space-2)] truncate text-[11px] text-ink/55">
          Batch{' '}
          <BatchCode value={document.batchId} className="text-gold/80" />
          <span className="text-ink/20" aria-hidden="true"> · </span>
          <DateStamp iso={document.issuedDate} className="text-ink/45" />
        </p>
        {document.standardReference && (
          <p className="mt-[var(--space-1)] truncate font-mono text-[10px] text-ink/30">
            {document.standardReference}
          </p>
        )}

        {href && (
          <span className="mt-auto inline-flex items-center gap-[var(--space-2)] pt-[var(--space-3)] text-[10px] uppercase tracking-[0.25em] text-ink/55 transition-colors group-hover:text-ink">
            <span>View document</span>
            <span
              aria-hidden="true"
              className="text-ink/30 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-gold"
            >
              →
            </span>
          </span>
        )}
      </div>
    </article>
  );

  if (!href) return inner;

  return (
    <Link
      to={href}
      className="block rounded-[4px] focus:outline-none focus-visible:[&>article]:ring-1 focus-visible:[&>article]:ring-ink/25"
      aria-label={`${document.documentType} — ${document.productName}, batch ${document.batchId}`}
    >
      {inner}
    </Link>
  );
}
