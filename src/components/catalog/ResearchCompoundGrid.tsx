/**
 * ResearchCompoundGrid
 *
 * Grid container for the Research Intelligence Library. Mirrors
 * ProductGrid's loading / error / empty contract but renders the
 * education-first ResearchCompoundTile (no commerce controls) instead
 * of the store's purchase tiles. Kept separate from ProductGrid so the
 * procurement surfaces are untouched.
 *
 * Columns: 1 mobile → 2 sm → 3 lg — roomy enough for the compound to
 * float on its glass square and for a 3-line description to breathe,
 * matching the store's enriched tile density rather than the dense
 * 5-column shopping gallery.
 */

import type { Product } from '../../types';
import { ResearchCompoundTile, ResearchCompoundTileSkeleton } from './ResearchCompoundTile';
import { EmptyState } from '../system/EmptyState';
import { ErrorState } from '../system/ErrorState';

interface ResearchCompoundGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  onInspect?: (id: string) => void;
}

const SKELETON_COUNT = 6;
const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-[var(--space-5)] gap-y-[var(--space-6)]';

export function ResearchCompoundGrid({
  products,
  loading,
  error,
  emptyLabel = 'No compounds match the active filters.',
  onInspect,
}: ResearchCompoundGridProps) {
  if (loading) {
    return (
      <ul className={GRID} aria-busy="true" aria-label="Loading intelligence records">
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
    <ul className={GRID}>
      {products.map((product) => (
        <li key={product.id}>
          <ResearchCompoundTile product={product} onInspect={onInspect} />
        </li>
      ))}
    </ul>
  );
}
