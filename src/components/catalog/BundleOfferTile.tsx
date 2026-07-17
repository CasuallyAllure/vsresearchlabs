/**
 * BundleOfferTile — the standing "Retatrutide + GHK-Cu" pairing offer,
 * merchandised at the top of the biopeptide catalog.
 *
 * Pure marketing + a fast add. The 20% discount itself is computed and
 * applied server-side (place-order detects the pair automatically); this
 * tile only PREVIEWS that math via the shared `bundleDiscount` helper from
 * `lib/bundle.ts` — it never sends a discounted price of its own.
 *
 * Renders nothing when the offer can't be shown honestly: either product
 * missing from the catalog, either featured dose not publicly priced/visible,
 * or either price unresolved. No $0 or broken bundle ever renders.
 */

import { useRef, useState } from 'react';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isSkuVisible, isVariantPublic } from '../../lib/productOverrides';
import { useProducts } from '../../hooks/useProducts';
import { BUNDLE_PROMO, BUNDLE_FEATURED, bundleDiscount } from '../../lib/bundle';
import { Button } from '../ui/Button';
import type { Product } from '../../types';

export function BundleOfferTile() {
  // Subscribe so an admin price/visibility edit propagates live, same as
  // CompoundTile's override subscriptions.
  useProductOverrides((s) => s.bySku);
  useProductOverrides((s) => s.variantBySku);
  // Render NOTHING until the admin overrides have actually loaded. Without
  // this gate, effectiveTierPriceCents falls through to the placeholder
  // formula in lib/pricing for the first paint (and forever if the fetch
  // fails) — which advertised a fabricated "$960 → $768, save $192" bundle on
  // production. A quiet tile beats a lying price.
  const overridesLoaded = useProductOverrides((s) => s.loaded);

  const { products } = useProducts('biopeptide-research-supplies');
  const productA = products.find((p) => p.sku === BUNDLE_PROMO.skuA);
  const productB = products.find((p) => p.sku === BUNDLE_PROMO.skuB);

  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const [added, setAdded] = useState(false);
  const flashTimer = useRef<number | null>(null);

  if (!overridesLoaded) return null;
  if (!productA || !productB) return null;
  if (!isSkuVisible(productA.sku) || !isSkuVisible(productB.sku)) return null;

  const { doseA, doseB } = BUNDLE_FEATURED;
  if (!isVariantPublic(productA.sku, doseA) || !isVariantPublic(productB.sku, doseB)) return null;

  const priceA = effectiveTierPriceCents(productA, doseA);
  const priceB = effectiveTierPriceCents(productB, doseB);
  if (priceA == null || priceB == null || priceA <= 0 || priceB <= 0) return null;

  const totalCents = priceA + priceB;
  const { discountCents } = bundleDiscount([
    { sku: productA.sku, unitCents: priceA, quantity: 1 },
    { sku: productB.sku, unitCents: priceB, quantity: 1 },
  ]);
  if (discountCents <= 0) return null;
  const bundleCents = totalCents - discountCents;

  const imageA = productA.images?.[0] ?? null;
  const imageB = productB.images?.[0] ?? null;

  // Exact handleAdd pattern from CompoundTile.tsx, applied to both lines.
  function addLine(product: Product, dose: string) {
    const line = variantProduct(product, dose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) updateQuantity(line.id, existing.quantity + 1);
    else add(line);
  }

  function handleAddBundle() {
    addLine(productA!, doseA);
    addLine(productB!, doseB);
    setAdded(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setAdded(false), 1100);
  }

  return (
    <section
      aria-label="Bundle offer"
      className="floating-module mb-[var(--space-4)] overflow-hidden"
    >
      <div className="flex flex-col gap-[var(--space-4)] p-[var(--space-4)] sm:flex-row sm:items-center sm:gap-[var(--space-5)] sm:p-[var(--space-5)]">
        {/* Vial pairing — the "+" between the two thumbnails reads as the pair. */}
        <div className="flex shrink-0 items-center justify-center gap-2 self-center sm:self-auto">
          <BundleThumb src={imageA} alt={productA.name} />
          <span aria-hidden="true" className="shrink-0 font-mono text-[15px] text-ink/30">
            +
          </span>
          <BundleThumb src={imageB} alt={productB.name} />
        </div>

        {/* Copy + price + CTA */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-ink/10 bg-[color:var(--color-status-successMuted)] px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-status-success)]">
              {BUNDLE_PROMO.percent}% off
            </span>
            <h2 className="text-[10.5px] uppercase tracking-[0.24em] text-ink/45">
              Bundle offer
            </h2>
          </div>

          <p className="text-[13px] leading-snug text-ink/85">
            {productA.name} <span className="text-ink/45">{doseA}</span>
            <span className="px-1 text-ink/30">+</span>
            {productB.name} <span className="text-ink/45">{doseB}</span>
          </p>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-mono text-[13px] tabular-nums text-ink/40 line-through">
              {formatPrice(totalCents)}
            </span>
            <span className="font-mono text-[19px] font-semibold tabular-nums text-ink leading-none">
              {formatPrice(bundleCents)}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-status-success)]">
              Save {formatPrice(discountCents)}
            </span>
          </div>

          <p className="mt-2 max-w-[48ch] text-[10.5px] leading-relaxed text-ink/45">
            Applied automatically at checkout when both are in your cart — final price, can't
            combine with promo codes.
          </p>

          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleAddBundle}
            className="mt-3"
            aria-label={`Add ${productA.name} ${doseA} and ${productB.name} ${doseB} to inquiry`}
          >
            {added ? '✓ Added' : 'Add bundle'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function BundleThumb({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div className="tile-spec-plate h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius-procurement)] sm:h-[92px] sm:w-[92px]">
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.16em] text-ink/20">
          No image
        </div>
      )}
    </div>
  );
}
