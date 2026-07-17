/**
 * DocumentationPreview
 * Wave 9 — Documentation Library Foundation.
 *
 * Landing-page-specific section that renders the first 3 documents
 * from the mock documentation set, alongside a quiet "View all
 * documentation" chevron link routing to `/documentation`.
 *
 * Slot:
 *   Sits between PositioningBlock and Categories on `/`. Establishes
 *   that documentation is a first-class trust system (not a footer
 *   afterthought) before the catalog discovery rows begin.
 *
 * Surface posture (anti-drift):
 *   - Section container is fully flat with `border-b border-ink/[0.06]`
 *     hairline only. No glass, no elevated panels, no atmospheric
 *     styling.
 *   - Cards inside `DocumentGallery` use Level 1 solid surfaces with
 *     hairline borders. No hover lift, no shadow theatrics.
 *
 * Voice posture:
 *   - Eyebrow tier matches the Categories "Catalog" eyebrow (white/40).
 *   - Display heading is one tier below the hero h1 — same as
 *     PositioningBlock — so the page rhythm stays calm.
 *   - Single dry sentence of context, not a marketing pitch.
 *   - "View all documentation" caption-tier link with chevron, NOT a
 *     CTA button.
 */

import { Link } from 'react-router-dom';
import documents from '../../data/documents.json';
import type { Document } from '../../types';
import { DocumentGallery } from '../documents/DocumentGallery';

const PREVIEW_COUNT = 3;

export function DocumentationPreview() {
  const all = documents as unknown as Document[];
  const preview = all.slice(0, PREVIEW_COUNT);

  return (
    <section
      className="-mx-[var(--page-gutter)] border-b border-ink/[0.06]"
      aria-label="Documentation preview"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-16)] sm:py-[var(--space-20)]">
        {/* Heading band — eyebrow + display + dry context line. */}
        <div className="mb-[var(--space-8)] sm:mb-[var(--space-10)]">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-4)]">
            Documentation
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-light text-ink tracking-tight leading-[1.1] max-w-[24ch] mb-[var(--space-5)]">
            Batch-tracked
            <br />
            research archive.
          </h2>
          <p className="text-base sm:text-lg text-ink/55 leading-relaxed max-w-[58ch]">
            Certificates of analysis, purity reports, and calibration
            records are filed against the same batch identifiers used in
            the catalog. Documentation is referenced, not advertised.
          </p>
        </div>

        {/* Gallery — first 3 documents, cards link to the full library. */}
        <DocumentGallery documents={preview} cardHref="/documentation" />

        {/* View-all affordance — caption-tier chevron link only. */}
        <div className="mt-[var(--space-8)] sm:mt-[var(--space-10)]">
          <Link
            to="/documentation"
            className="inline-flex items-center gap-[var(--space-2)] text-[11px] uppercase tracking-[0.3em] text-ink/55 hover:text-ink transition-colors group focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
          >
            <span>View all documentation</span>
            <span
              aria-hidden="true"
              className="text-ink/35 group-hover:text-gold group-hover:translate-x-0.5 transition-[color,transform] duration-150"
            >
              →
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
