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
    <article className="research-surface-solid group flex gap-[var(--space-4)] p-[var(--space-4)] h-full">
      {/* Thumbnail — small, document-aspect, quiet placeholder. */}
      <div className="shrink-0 w-20 sm:w-24 aspect-[3/4] overflow-hidden bg-display border border-ink/[0.09]">
        {document.thumbnailUrl ? (
          <img
            src={document.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            aria-hidden="true"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-ink/20 text-[10px] uppercase tracking-widest">
            Doc
          </div>
        )}
      </div>

      {/* Metadata column — stacked, restrained typographic hierarchy. */}
      <div className="flex flex-col min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink/45 mb-[var(--space-1)] truncate">
          {document.documentType}{document.documentVersion ? ` · ${document.documentVersion}` : ''}
        </p>
        <h3 className="text-sm font-medium text-ink truncate group-hover:text-gold transition-colors">
          {document.productName}
        </h3>
        {document.issuer && (
          <p className="text-[10px] text-ink/35 truncate">
            {document.issuer}
          </p>
        )}
        <p className="mt-[var(--space-1)] text-[11px] text-ink/55 truncate">
          Batch{' '}
          <BatchCode value={document.batchId} className="text-ink/55" />
          <span className="text-ink/20" aria-hidden="true"> · </span>
          <DateStamp iso={document.issuedDate} className="text-ink/45" />
        </p>
        {document.standardReference && (
          <p className="mt-[var(--space-1)] text-[10px] text-ink/30 truncate font-mono">
            {document.standardReference}
          </p>
        )}

        {href && (
          <span className="mt-auto pt-[var(--space-3)] inline-flex items-center gap-[var(--space-2)] text-[10px] uppercase tracking-[0.25em] text-ink/55 group-hover:text-ink transition-colors">
            <span>View document</span>
            <span
              aria-hidden="true"
              className="text-ink/30 group-hover:text-gold group-hover:translate-x-0.5 transition-[color,transform] duration-150"
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
