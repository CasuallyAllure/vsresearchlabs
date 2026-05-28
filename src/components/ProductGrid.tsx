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
import { EmptyState } from './system/EmptyState';
import { ErrorState } from './system/ErrorState';

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  onInspect?: (id: string) => void;
}

const SKELETON_COUNT = 6;

export function ProductGrid({
  products,
  loading,
  error,
  emptyLabel = 'No products available.',
  onInspect,
}: ProductGridProps) {
  if (loading) {
    return (
      <ul
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-[var(--space-6)] gap-y-[var(--space-10)]"
        aria-busy="true"
        aria-label="Loading inventory"
      >
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <li key={i}>
            <ProductCardSkeleton />
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
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-[var(--space-6)] gap-y-[var(--space-10)]">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} onInspect={onInspect} />
        </li>
      ))}
    </ul>
  );
}
