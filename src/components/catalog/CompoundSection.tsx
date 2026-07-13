/**
 * CompoundSection
 *
 * One category group in the grouped biopeptide catalog. Renders a
 * section header — a small monochrome flask icon, the classification
 * label, and a right-aligned compound count pill — followed by a
 * roomier grid (1–3 columns) of CompoundTile so each tile has space
 * for its purity badge and one-line description. Pure presentational
 * component: grouping/filtering logic lives in the page.
 */

import type { Product } from '../../types';
import { CompoundTile } from './CompoundTile';

interface CompoundSectionProps {
  /** researchClassification key, or a fallback key for uncategorized products. */
  sectionKey: string;
  label: string;
  products: Product[];
  onInspect?: (id: string) => void;
  /** When true, each tile's dose chips list ONLY 24-hour doses. */
  only24hrDoses?: boolean;
}

function FlaskIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-ink/45"
    >
      <path d="M9 2h6" />
      <path d="M10 2v6.2a2 2 0 0 1-.27 1L4.5 18a2.5 2.5 0 0 0 2.1 3.9h10.8a2.5 2.5 0 0 0 2.1-3.9L14.27 9.2a2 2 0 0 1-.27-1V2" />
      <path d="M6.5 14.5h11" />
    </svg>
  );
}

export function CompoundSection({ sectionKey, label, products, onInspect, only24hrDoses }: CompoundSectionProps) {
  if (products.length === 0) return null;

  return (
    <section aria-labelledby={`compound-section-${sectionKey}`} className="mb-[var(--space-8)] last:mb-0">
      <header className="mb-[var(--space-4)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskIcon />
          <h2
            id={`compound-section-${sectionKey}`}
            className="truncate text-[13px] font-medium text-ink/85 sm:text-[14px]"
          >
            {label}
          </h2>
        </div>
        <span className="shrink-0 rounded-full border border-ink/15 bg-ink/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-ink/50">
          {products.length} {products.length === 1 ? 'compound' : 'compounds'}
        </span>
      </header>

      <ul className="grid grid-cols-1 gap-x-[var(--space-5)] gap-y-[var(--space-5)] sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.id}>
            <CompoundTile product={product} onInspect={onInspect} only24hrDoses={only24hrDoses} />
          </li>
        ))}
      </ul>
    </section>
  );
}
