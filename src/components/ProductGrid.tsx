/**
 * ProductGrid
 * Phase 4 — VS Research Labs
 *
 * Single-file gallery grid. Card subcomponent is inlined (no separate file
 * per the v1 minimal-build constraint). Click a card to navigate to the
 * product detail route.
 */

import { Link } from 'react-router-dom';
import type { Product } from '../types';

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
}

export function ProductGrid({
  products,
  loading,
  error,
  emptyLabel = 'No products available.',
}: ProductGridProps) {
  if (loading) {
    return (
      <div className="py-[var(--space-12)] text-center text-white/40 text-sm">
        Loading products…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-[var(--space-12)] text-center text-red-400 text-sm">
        Failed to load products: {error}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="py-[var(--space-12)] text-center text-white/40 text-sm">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-[var(--space-6)] gap-y-[var(--space-10)]">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// ProductCard (inline)
// ---------------------------------------------------------------------------

interface ProductCardProps {
  product: Product;
}

function ProductCard({ product }: ProductCardProps) {
  const imageUrl = product.images?.[0] ?? null;

  return (
    <Link to={`/product/${product.id}`} className="group block">
      {/* Image — the visual mass; flat surface, hairline border, no blur */}
      <div className="aspect-square w-full bg-base-800 border border-white/[0.06] overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-white/20 text-xs uppercase tracking-widest">
            No image
          </div>
        )}
      </div>

      {/* Body — type-only, sits on the page surface */}
      <div className="pt-[var(--space-4)]">
        <h3 className="text-sm font-normal text-white tracking-tight leading-snug truncate group-hover:text-gold transition-colors">
          {product.name}
        </h3>
        {product.description && (
          <p className="mt-[var(--space-1-5)] text-xs text-white/45 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        )}
      </div>
    </Link>
  );
}
