/**
 * ProductPage
 * Phase 3 — Product Detail polish.
 * Wave 5 — Surface containment for info column + specs.
 * Wave 7c — AbbreviationChip + family + DoseTierStrip integration.
 * Reconciliation Pass C — Specimen-sheet alignment.
 *
 * The page is reconciled toward a procurement reference document:
 * the operational identifier band (abbreviation + family + SKU)
 * leads the info column ABOVE the descriptive name. The image
 * gallery is preserved but its column-share is reduced (7/5 → 6/6)
 * so metadata carries equal visual weight. The Related strip now
 * delegates to <ProductCard /> rather than duplicating its markup,
 * so the inventory-register propagates automatically.
 *
 * Gold-accent discipline: the only gold accent on the page is the
 * primary inquiry CTA pill. The category eyebrow, the Related
 * eyebrow, and the active gallery thumbnail border have all been
 * pulled into the white/40 register established by Passes A–B.
 *
 * Phase 2 invariants preserved: no glass, no blur, hairline borders
 * only, type-led hierarchy. Wave 5 surface containment (Level 1 info
 * column wrap + Level 2 specs panel on lg+) is preserved exactly.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProduct, useProducts } from '../hooks/useProducts';
import { useCart } from '../hooks/useCart';
import type { Product } from '../types';
import { deriveProductDose } from '../types';
import { AbbreviationChip } from '../components/catalog/AbbreviationChip';
import { DoseTierStrip } from '../components/catalog/DoseTierStrip';
import { ProductCard } from '../components/catalog/ProductCard';
import { SKUCode, LotCode, ProcurementValue } from '../components/ui/identifiers';
import { useDocumentsByProduct } from '../hooks/useDocuments';
import { DocumentCard } from '../components/documents/DocumentCard';
import { ErrorState } from '../components/system/ErrorState';

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

  // Associated documentation — by abbreviation, deep-links to detail routes.
  const productDocs = useDocumentsByProduct(product?.abbreviation);

  function handleAddToInquiry() {
    if (!product) return;
    addToInquiry(product);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  if (error || !product) {
    return (
      <ErrorState
        message={error ?? 'Inventory record could not be resolved.'}
        action={
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-xs uppercase tracking-widest text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
          >
            Go back
          </button>
        }
      />
    );
  }

  const images = product.images ?? [];
  const safeIndex =
    images.length > 0
      ? Math.min(activeImageIndex, images.length - 1)
      : 0;
  const activeImageUrl = images[safeIndex] ?? null;
  const hasGallery = images.length > 1;

  const categoryLabel = product.category.replace(/-/g, ' ');
  const categoryHref = `/${product.category}`;
  const outOfStock = product.stock === 0;

  return (
    <article className="py-[var(--space-8)] pb-[var(--space-24)] lg:pb-[var(--space-8)]">
      {/* Breadcrumb */}
      <nav className="mb-[var(--space-6)] text-xs uppercase tracking-widest text-white/40">
        <Link to="/" className="hover:text-white/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
          Home
        </Link>
        <span className="mx-[var(--space-2)] text-white/20">/</span>
        <Link to={categoryHref} className="hover:text-white/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
          {categoryLabel}
        </Link>
        <span className="mx-[var(--space-2)] text-white/20">/</span>
        <span className="text-white/60">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-[var(--space-10)] gap-y-[var(--space-8)]">
        {/* Image gallery — supporting reference. Equal-share column
            (lg:col-span-6) so the metadata column carries equal
            weight. Flat surfaces only — no glass, no atmospheric. */}
        <div className="lg:col-span-6">
          <div className="aspect-square w-full overflow-hidden bg-[#050505] border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
                      'shrink-0 w-16 h-16 sm:w-20 sm:h-20 overflow-hidden bg-[#050505] border transition-colors',
                      'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35',
                    isActive
                        ? 'border-white'
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

        {/* Info — typeset on mobile, Level 1 solid surface module on lg+ (Wave 5).
            Reconciliation Pass C: the operational identifier band
            (abbreviation + family + SKU) leads ABOVE the descriptive
            name, so the column reads as a specimen sheet rather than
            a product detail page. The category eyebrow that previously
            sat at the top is removed — the breadcrumb already covers
            that information and the gold accent contradicted the
            page's gold-accent discipline. */}
        <div className="lg:col-span-6 flex flex-col lg:research-surface-solid lg:p-[var(--space-6)]">
          {/* Identifier band — leads the info column. Three operational
              tokens: abbreviation chip, family, SKU. Tabular numerals
              on the SKU keep the identifier visually fixed-width. */}
          <div className="flex items-center flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-2)] mb-[var(--space-4)]">
            <AbbreviationChip value={product.abbreviation} />
            <span className="text-[11px] uppercase tracking-[0.25em] text-white/55">
              {product.family}
            </span>
            <span className="text-white/15" aria-hidden="true">·</span>
            <span className="text-[11px] uppercase tracking-[0.25em] text-white/35">
              SKU — <SKUCode value={product.sku} className="text-white/35" />
            </span>
            {product.casNumber && (
              <>
                <span className="text-white/15" aria-hidden="true">·</span>
                <span className="text-[11px] uppercase tracking-[0.25em] text-white/35">
                  CAS — <span className="font-mono tabular-nums text-white/50">{product.casNumber}</span>
                </span>
              </>
            )}
          </div>

          <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight leading-tight mb-[var(--space-4)]">
            {product.name}
          </h1>

          <p className="mb-[var(--space-6)]">
            <ProcurementValue cents={product.priceCents} className="text-base" />
          </p>

          <p className="text-sm text-white/65 leading-relaxed max-w-[52ch] mb-[var(--space-6)]">
            {product.shortDescription}
          </p>

          {/* Wave 7c — dose-tier strip. Renders only when variants[] is non-empty.
              The strip appears between the short description and the specs so
              it reads as compact metadata, not a control. */}
          {product.variants && product.variants.length > 0 && (
            <div className="mb-[var(--space-8)]">
              <p className="text-[11px] uppercase tracking-[0.25em] text-white/35 mb-[var(--space-2)]">
                Available Tiers
              </p>
              <DoseTierStrip
                variants={product.variants}
                activeDose={deriveProductDose(product)}
              />
            </div>
          )}

          {/* Specs — hairline rows on mobile; Level 2 elevated sub-panel on lg+ (Wave 5) */}
          {product.specs.length > 0 && (
            <div className="lg:research-surface-elevated lg:overflow-hidden mb-[var(--space-8)] lg:mb-[var(--space-6)]">
              <dl className="border-t border-white/[0.06]">
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
            </div>
          )}

          {/* Procurement details — operational metadata block */}
          {(product.lotNumber || product.manufacturer || product.countryOfOrigin ||
            product.testingStandard || product.shippingCondition ||
            product.leadTimeDays !== undefined || product.shelfLifeMonths != null) && (
            <div className="mb-[var(--space-8)] lg:mb-[var(--space-6)]">
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/30 mb-[var(--space-2)]">
                Procurement Details
              </p>
              <div className="lg:research-surface-elevated lg:overflow-hidden">
                <dl className="border-t border-white/[0.06]">
                  {product.lotNumber && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Lot No.</dt>
                      <dd className="text-right"><LotCode value={product.lotNumber} className="text-white/70" /></dd>
                    </div>
                  )}
                  {product.manufacturer && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Manufacturer</dt>
                      <dd className="text-sm text-white/70 text-right">{product.manufacturer}</dd>
                    </div>
                  )}
                  {product.countryOfOrigin && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Origin</dt>
                      <dd className="text-sm text-white/70 text-right">{product.countryOfOrigin}</dd>
                    </div>
                  )}
                  {product.testingStandard && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Testing Std.</dt>
                      <dd className="text-sm text-white/70 text-right font-mono tabular-nums">{product.testingStandard}</dd>
                    </div>
                  )}
                  {product.shippingCondition && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Shipping</dt>
                      <dd className="text-sm text-white/70 text-right">{product.shippingCondition}</dd>
                    </div>
                  )}
                  {product.leadTimeDays !== undefined && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Lead Time</dt>
                      <dd className="text-sm text-white/70 text-right font-mono tabular-nums">{product.leadTimeDays} business days</dd>
                    </div>
                  )}
                  {product.shelfLifeMonths != null && (
                    <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-white/[0.06]">
                      <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">Shelf Life</dt>
                      <dd className="text-sm text-white/70 text-right font-mono tabular-nums">{product.shelfLifeMonths} months</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
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
              className="w-full sm:w-auto px-[var(--space-8)] py-[var(--space-4)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium transition-colors duration-150 hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
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

      {/* Related inventory — same family, exclude self, max 3.
          Reconciliation Pass C: the inline duplicate of the old
          ProductCard markup has been removed. The strip now delegates
          to <ProductCard />, so the inventory register propagates
          automatically (no image scale-on-hover, no consumer-shop
          recommendation posture, family eyebrow + SKU caption).
          The eyebrow is `Related` in white/40 — not the old gold. */}
      {relatedProducts.length > 0 && (
        <section
          className="mt-[var(--space-16)] pt-[var(--space-10)] border-t border-white/[0.06]"
          aria-label="Related inventory"
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-[var(--space-6)]">
            Related
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-[var(--space-6)] gap-y-[var(--space-10)]">
            {relatedProducts.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Associated documentation — deep-links to detail routes, not archive index. */}
      {productDocs.length > 0 && (
        <section
          className="mt-[var(--space-12)] pt-[var(--space-8)] border-t border-white/[0.06]"
          aria-label="Associated documentation"
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-[var(--space-6)]">
            Documentation
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)] sm:gap-[var(--space-4)]">
            {productDocs.map((doc) => (
              <li key={doc.id}>
                <DocumentCard document={doc} href={`/documentation/${doc.id}`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Mobile sticky add-to-inquiry — sits above the fixed BottomNav.
          Reconciliation Pass C: bottom offset is `bottom-14` to clear
          the Pass-B-reduced BottomNav (h-14, was h-16). The region is
          mobile-only because BottomNav itself is mobile-only at lg+. */}
      <div
        className="lg:hidden fixed left-0 right-0 bottom-14 z-40 bg-black border-t border-white/[0.06]"
        role="region"
        aria-label="Add to inquiry"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-3)]">
          <button
            type="button"
            onClick={handleAddToInquiry}
            disabled={outOfStock}
            className="w-full px-[var(--space-8)] py-[var(--space-3)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium transition-colors duration-150 hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
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
