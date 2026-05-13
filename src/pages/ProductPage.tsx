/**
 * ProductPage
 * Phase 3 — Product Detail polish.
 *
 * Adds:
 *  • Image gallery with thumbnail row (hidden when ≤ 1 image)
 *  • Related products strip (same category, exclude self, max 3)
 *  • Mobile sticky add-to-inquiry that sits above the BottomNav
 *
 * Phase 2 invariants preserved: no glass surfaces, no blur, hairline
 * borders only, type-led hierarchy.
 *
 * Inventory-only: no new components or files. The related strip
 * inlines the same flat-image-led card markup used by ProductGrid.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProduct, useProducts } from '../hooks/useProducts';
import { useCart } from '../hooks/useCart';
import type { Product } from '../types';

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addToInquiry = useCart((s) => s.add);

  const { product, error } = useProduct(id);
  const [added, setAdded] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Reset gallery selection whenever the product (route) changes.
  useEffect(() => {
    setActiveImageIndex(0);
  }, [product?.id]);

  // Pull category siblings; filter out the current product.
  const sameCategory = useProducts(product?.category).products;
  const relatedProducts: Product[] = useMemo(() => {
    if (!product) return [];
    return sameCategory.filter((p) => p.id !== product.id).slice(0, 3);
  }, [product, sameCategory]);

  function handleAddToInquiry() {
    if (!product) return;
    addToInquiry(product);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  if (error || !product) {
    return (
      <div className="py-[var(--space-12)] text-center">
        <p className="text-red-400 text-sm mb-[var(--space-4)]">
          {error ?? 'Product unavailable.'}
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-xs uppercase tracking-widest text-white/60 hover:text-white"
        >
          Go back
        </button>
      </div>
    );
  }

  const images = product.images ?? [];
  const safeIndex =
    images.length > 0
      ? Math.min(activeImageIndex, images.length - 1)
      : 0;
  const activeImageUrl = images[safeIndex] ?? null;
  const hasGallery = images.length > 1;

  const priceLabel =
    product.priceCents !== null && product.priceCents > 0
      ? `$${(product.priceCents / 100).toFixed(2)}`
      : 'Inquire for pricing';
  const categoryLabel = product.category.replace(/-/g, ' ');
  const categoryHref = `/${product.category}`;
  const outOfStock = product.stock === 0;

  return (
    <article className="py-[var(--space-8)] pb-[var(--space-24)] lg:pb-[var(--space-8)]">
      {/* Breadcrumb */}
      <nav className="mb-[var(--space-6)] text-xs uppercase tracking-widest text-white/40">
        <Link to="/" className="hover:text-white/70">
          Home
        </Link>
        <span className="mx-[var(--space-2)] text-white/20">/</span>
        <Link to={categoryHref} className="hover:text-white/70">
          {categoryLabel}
        </Link>
        <span className="mx-[var(--space-2)] text-white/20">/</span>
        <span className="text-white/60">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-[var(--space-10)] gap-y-[var(--space-8)]">
        {/* Image gallery — primary + thumbnails, flat surfaces only */}
        <div className="lg:col-span-7">
          <div className="aspect-square w-full overflow-hidden bg-base-800 border border-white/[0.06]">
            {activeImageUrl ? (
              <img
                src={activeImageUrl}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-white/20 text-xs uppercase tracking-widest">
                No image
              </div>
            )}
          </div>

          {hasGallery && (
            <div
              className="mt-[var(--space-3)] flex gap-[var(--space-3)] overflow-x-auto"
              role="tablist"
              aria-label="Product images"
            >
              {images.map((url, idx) => {
                const isActive = idx === safeIndex;
                return (
                  <button
                    key={url + idx}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-label={`View image ${idx + 1} of ${images.length}`}
                    onClick={() => setActiveImageIndex(idx)}
                    className={[
                      'shrink-0 w-16 h-16 sm:w-20 sm:h-20 overflow-hidden bg-base-800 border transition-colors',
                      isActive
                        ? 'border-gold'
                        : 'border-white/[0.06] hover:border-white/20',
                    ].join(' ')}
                  >
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Info — typeset, no panels */}
        <div className="lg:col-span-5 flex flex-col">
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
            {categoryLabel}
          </p>

          <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight leading-tight mb-[var(--space-3)]">
            {product.name}
          </h1>

          <p className="text-[11px] uppercase tracking-[0.25em] text-white/35 mb-[var(--space-6)]">
            SKU — {product.sku}
          </p>

          <p className="text-xl font-light text-white mb-[var(--space-6)]">
            {priceLabel}
          </p>

          <p className="text-sm text-white/65 leading-relaxed max-w-[52ch] mb-[var(--space-8)]">
            {product.shortDescription}
          </p>

          {/* Specs — hairline rows, no panel */}
          {product.specs.length > 0 && (
            <dl className="border-t border-white/[0.06] mb-[var(--space-8)]">
              {product.specs.map((spec) => (
                <div
                  key={spec.label}
                  className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]"
                >
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                    {spec.label}
                  </dt>
                  <dd className="text-sm text-white/80 text-right">
                    {spec.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* Long description */}
          <p className="text-sm text-white/55 leading-relaxed max-w-[60ch] mb-[var(--space-10)] whitespace-pre-line">
            {product.longDescription}
          </p>

          <div className="mt-auto">
            <button
              type="button"
              onClick={handleAddToInquiry}
              disabled={outOfStock}
              className="w-full sm:w-auto px-[var(--space-8)] py-[var(--space-4)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium transition-all duration-200 hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {added ? 'Added to Inquiry' : 'Add to Inquiry'}
            </button>
            {outOfStock && (
              <p className="mt-[var(--space-3)] text-xs text-white/40">
                Currently unavailable.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Related products — same category, exclude self, max 3 */}
      {relatedProducts.length > 0 && (
        <section
          className="mt-[var(--space-16)] pt-[var(--space-10)] border-t border-white/[0.06]"
          aria-label="Related products"
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-6)]">
            Related
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-[var(--space-6)] gap-y-[var(--space-10)]">
            {relatedProducts.map((p) => {
              const thumb = p.images?.[0] ?? null;
              return (
                <li key={p.id}>
                  <Link to={`/product/${p.id}`} className="group block">
                    <div className="aspect-square w-full bg-base-800 border border-white/[0.06] overflow-hidden">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={p.name}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-white/20 text-xs uppercase tracking-widest">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="pt-[var(--space-4)]">
                      <h3 className="text-sm font-normal text-white tracking-tight leading-snug truncate group-hover:text-gold transition-colors">
                        {p.name}
                      </h3>
                      {p.shortDescription && (
                        <p className="mt-[var(--space-1-5)] text-xs text-white/45 line-clamp-2 leading-relaxed">
                          {p.shortDescription}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Mobile sticky add-to-inquiry — sits above the fixed BottomNav (h-16) */}
      <div
        className="lg:hidden fixed left-0 right-0 bottom-16 z-40 bg-black border-t border-white/[0.06]"
        role="region"
        aria-label="Add to inquiry"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-3)]">
          <button
            type="button"
            onClick={handleAddToInquiry}
            disabled={outOfStock}
            className="w-full px-[var(--space-8)] py-[var(--space-3)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium transition-all duration-200 hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {outOfStock
              ? 'Currently unavailable'
              : added
              ? 'Added to Inquiry'
              : 'Add to Inquiry'}
          </button>
        </div>
      </div>
    </article>
  );
}
