/**
 * DocumentGallery
 * Wave 9 — Documentation Library Foundation.
 *
 * Responsive container for `DocumentCard` instances. Used in two
 * places with identical visual rhythm:
 *
 *   1. Landing's `DocumentationPreview` slot — first 3 documents.
 *   2. The full `/documentation` route — every document in the dataset.
 *
 * Responsive cadence:
 *   - mobile (default) : vertical stack, gap-3
 *   - sm  (≥640px)     : 2-column grid
 *   - lg  (≥1024px)    : 3-column grid
 *
 * Mirrors the editorial spacing rhythm used by Landing — calm, never
 * dense. Cards do not stretch to fill remaining horizontal space; the
 * grid's `auto-rows-fr` keeps every card in a row sharing the same
 * height for clean column alignment.
 *
 * No glass, no elevated hover theatrics, no atmospheric styling. The
 * cards carry their own Level 1 surface. The gallery itself is a
 * pure layout container.
 */

import type { Document } from '../../types';
import { DocumentCard } from './DocumentCard';
import { EmptyState } from '../system/EmptyState';

interface DocumentGalleryProps {
  documents: Document[];
  /**
   * Optional fixed href applied to every card. Takes lower priority than
   * `makeCardHref`. Wave 9 Landing callers pass `/documentation` to route
   * all preview cards to the archive index.
   */
  cardHref?: string;
  /**
   * Per-document href factory. When provided, takes precedence over
   * `cardHref`. R6 archive callers pass `(doc) => /documentation/${doc.id}`
   * to route each card to its detail page.
   */
  makeCardHref?: (doc: Document) => string;
  /** Empty-state caption when `documents` is empty. */
  emptyLabel?: string;
}

export function DocumentGallery({
  documents,
  cardHref,
  makeCardHref,
  emptyLabel = 'No documentation available.',
}: DocumentGalleryProps) {
  if (documents.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <ul
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-3)] sm:gap-[var(--space-4)] auto-rows-fr"
      role="list"
    >
      {documents.map((doc) => {
        const href = makeCardHref ? makeCardHref(doc) : cardHref;
        return (
          <li key={doc.id} className="h-full">
            <DocumentCard document={doc} href={href} />
          </li>
        );
      })}
    </ul>
  );
}
