/**
 * ProductGrid
 * Wave 2 — Module Containment
 *
 * Grid layout container. Cards are now bounded surface modules; see
 * `src/components/catalog/ProductCard.tsx`. The grid orchestrates
 * columns and the loading state; the card owns its visual containment.
 *
 * Loading state renders a 6-card skeleton grid in the same layout so the
 * page does not collapse to a single line of text while data arrives
 * (per docs/COMPOSITION_SYSTEM_BLUEPRINT.md §5.2 "6-card skeleton grid").
 */

import type { Product } from '../types';
import { ProductCard, ProductCardSkeleton } from './catalog/ProductCard';
import { CompactProductTile, CompactProductTileSkeleton } from './catalog/CompactProductTile';
import { EmptyState } from './system/EmptyState';
import { ErrorState } from './system/ErrorState';

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  onInspect?: (id: string) => void;
  /** When true, each card renders a tiny in-stock / out-of-stock pip. */
  showStock?: boolean;
  /** When true, each card carries an interactive tier picker, live price, and Add button. */
  showPurchase?: boolean;
  /** Dense grid mode: small tiles with inline dose select + price + add.
   *  Columns: 2 mobile → 3 sm → 4 md → 5 lg. Click body opens overlay. */
  compact?: boolean;
}

const SKELETON_COUNT_DEFAULT = 6;
const SKELETON_COUNT_COMPACT = 10;

const COMPACT_GRID = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3';
const DEFAULT_GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-[var(--space-6)] gap-y-[var(--space-10)]';

export function ProductGrid({
  products,
  loading,
  error,
  emptyLabel = 'No products available.',
  onInspect,
  showStock,
  showPurchase,
  compact,
}: ProductGridProps) {
  const grid = compact ? COMPACT_GRID : DEFAULT_GRID;
  const skeletonCount = compact ? SKELETON_COUNT_COMPACT : SKELETON_COUNT_DEFAULT;

  if (loading) {
    return (
      <ul className={grid} aria-busy="true" aria-label="Loading inventory">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <li key={i}>
            {compact ? <CompactProductTileSkeleton /> : <ProductCardSkeleton />}
          </li>
        ))}
      </ul>
    );
  }

  if (error) {
    return <ErrorState message="Inventory could not be retrieved." />;
  }

  if (products.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <ul className={grid}>
      {products.map((product) => (
        <li key={product.id}>
          {compact ? (
            <CompactProductTile product={product} onInspect={onInspect} />
          ) : (
            <ProductCard product={product} onInspect={onInspect} showStock={showStock} showPurchase={showPurchase} />
          )}
        </li>
      ))}
    </ul>
  );
}
