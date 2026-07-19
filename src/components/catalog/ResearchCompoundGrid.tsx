/**
 * ResearchCompoundGrid
 *
 * Grid container for the Research Intelligence Library. Mirrors
 * ProductGrid's loading / error / empty contract but renders the
 * education-first ResearchCompoundTile (no commerce controls) instead
 * of the store's purchase tiles. Kept separate from ProductGrid so the
 * procurement surfaces are untouched.
 *
 * Columns ramp with the layout picker's density (the same Detail / Grid /
 * Dense vocabulary the store catalog uses):
 *   detail  — 1 → 2 → 3 columns, roomy enough for a 3-line description.
 *   grid    — a tighter card gallery.
 *   dense   — a single-column index of compact rows.
 */

import type { Product } from '../../types';
import { ResearchCompoundTile, ResearchCompoundTileSkeleton } from './ResearchCompoundTile';
import { EmptyState } from '../system/EmptyState';
import { ErrorState } from '../system/ErrorState';
import type { CatalogDensity } from './ClassificationFilter';

interface ResearchCompoundGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  onInspect?: (id: string) => void;
  /** Layout density from the library's layout picker (default: detail). */
  density?: CatalogDensity;
}

const SKELETON_COUNT = 6;
const GRID_BY_DENSITY: Record<CatalogDensity, string> = {
  detail: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-[var(--space-5)] gap-y-[var(--space-6)]',
  standard: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-[var(--space-3)] gap-y-[var(--space-4)]',
  compact: 'grid grid-cols-1 gap-y-[var(--space-2)]',
};

export function ResearchCompoundGrid({
  products,
  loading,
  error,
  emptyLabel = 'No compounds match the active filters.',
  onInspect,
  density = 'detail',
}: ResearchCompoundGridProps) {
  const grid = GRID_BY_DENSITY[density];

  if (loading) {
    return (
      <ul className={grid} aria-busy="true" aria-label="Loading intelligence records">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <li key={i}>
            <ResearchCompoundTileSkeleton />
          </li>
        ))}
      </ul>
    );
  }

  if (error) {
    return <ErrorState message="Intelligence records could not be retrieved." />;
  }

  if (products.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <ul className={grid}>
      {products.map((product) => (
        <li key={product.id}>
          <ResearchCompoundTile product={product} onInspect={onInspect} density={density} />
        </li>
      ))}
    </ul>
  );
}
