/**
 * BundleOfferTile — the standing "Retatrutide + GHK-Cu" pairing offer,
 * merchandised at the top of the biopeptide catalog.
 *
 * Copy + a fast add. The 20% reduction itself is computed and
 * applied server-side (place-order detects the pair automatically); this
 * tile only PREVIEWS that math via the shared `bundleDiscount` helper from
 * `lib/bundle.ts` — it never sends a discounted price of its own.
 *
 * Renders nothing when the offer can't be shown honestly: either product
 * missing from the catalog, either featured dose not publicly priced/visible,
 * or either price unresolved. No $0 or broken bundle ever renders.
 *
 * Rendered as slide 1 inside FeaturedSupplyCarousel, which owns the single
 * card chrome (`floating-module`) for the whole carousel — this component is
 * bare content (no own border/background/radius) so its hero image bleeds to
 * the carousel box's edges.
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

/** Paired-supply hero render (the two vials on the lab-glass set). Archived
 *  master lives in Product Labels/VS Research Labs/Retatrutide + GHK-Cu Pair. */
const BUNDLE_IMAGE = '/vials/reta-ghk-pair.webp';

interface BundleOfferTileProps {
  /** Layout classes from the parent (width / snap / flex / spacing). The tile
   *  owns no outer margin so it composes into a row or stands alone. */
  className?: string;
}

export function BundleOfferTile({ className = '' }: BundleOfferTileProps) {
  // Subscribe so an admin price/visibility edit propagates live, same as
  // CompoundTile's override subscriptions.
  useProductOverrides((s) => s.bySku);
  useProductOverrides((s) => s.variantBySku);
  // Render NOTHING until the admin overrides have actually loaded WITHOUT
  // error. `loaded` alone flips true even on a failed fetch, so gating on it
  // wasn't enough: when the override call failed (seen on Safari desktop),
  // effectiveTierPriceCents fell through to the lib/pricing placeholder formula
  // and the tile advertised a fabricated "$960 → $768, save $192" bundle. Gate
  // on a clean load AND real per-dose price data for both SKUs — a quiet tile
  // beats a lying price.
  const overridesLoaded = useProductOverrides((s) => s.loaded);
  const overridesError = useProductOverrides((s) => s.error);
  const variantBySku = useProductOverrides((s) => s.variantBySku);

  const { products } = useProducts('biopeptide-research-supplies');
  const productA = products.find((p) => p.sku === BUNDLE_PROMO.skuA);
  const productB = products.find((p) => p.sku === BUNDLE_PROMO.skuB);

  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const [added, setAdded] = useState(false);
  const flashTimer = useRef<number | null>(null);

  if (!overridesLoaded || overridesError) return null;
  if (!productA || !productB) return null;
  if (!isSkuVisible(productA.sku) || !isSkuVisible(productB.sku)) return null;

  const { doseA, doseB } = BUNDLE_FEATURED;
  if (!isVariantPublic(productA.sku, doseA) || !isVariantPublic(productB.sku, doseB)) return null;

  // Require GENUINE per-dose price data for both featured doses — not the
  // lib/pricing formula fallback. Without this, an empty/failed override load
  // would still resolve a fabricated price and advertise a bogus bundle.
  const hasRealPriceA = variantBySku[productA.sku]?.[doseA]?.price_cents != null;
  const hasRealPriceB = variantBySku[productB.sku]?.[doseB]?.price_cents != null;
  if (!hasRealPriceA || !hasRealPriceB) return null;

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
    <section aria-label="Paired compound supply" className={`flex flex-col ${className}`}>
      {/* Hero — the paired-supply render (the two vials on the lab-glass set,
          matching the entrance/Lab aesthetic). The "Paired supply" chip and
          the pairing line sit ON the image over legibility scrims; the price
          and CTA read crisply on the card surface below. */}
      <div className="relative">
        <img
          src={BUNDLE_IMAGE}
          alt={`${productA.name} and ${productB.name} research vials — paired supply`}
          className="w-full object-cover"
          style={{ aspectRatio: '16 / 11', objectPosition: '60% 40%' }}
          loading="lazy"
        />
        {/* Bottom + top scrims for chip / title legibility over any framing. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(9,8,6,0.86) 0%, rgba(9,8,6,0.34) 34%, transparent 58%), linear-gradient(to bottom, rgba(9,8,6,0.42) 0%, transparent 26%)',
          }}
        />
        {/* One label, not two: the status chip IS the section heading. */}
        <h2 className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/35 px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-status-success)] backdrop-blur-sm">
          Paired supply
        </h2>
        {/* Pairing line — the wording, on the image, over the bottom scrim. */}
        <p className="absolute inset-x-4 bottom-3 text-[14px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
          {productA.name} <span className="text-white/65">{doseA}</span>
          <span className="px-1 text-white/45">+</span>
          {productB.name} <span className="text-white/65">{doseB}</span>
        </p>
      </div>

      {/* Price + disclaimer + CTA on the card surface. */}
      <div className="flex flex-1 flex-col p-[var(--space-4)] lg:p-[var(--space-5)]">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-mono text-[13px] tabular-nums text-ink/40 line-through">
            {formatPrice(totalCents)}
          </span>
          <span className="font-mono text-[22px] font-semibold tabular-nums leading-none text-ink">
            {formatPrice(bundleCents)}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-ink/50">
            {BUNDLE_PROMO.percent}% pairing reduction ({formatPrice(discountCents)})
          </span>
        </div>

        <p className="mb-4 mt-2 max-w-[48ch] text-[10.5px] leading-relaxed text-ink/45">
          Applied automatically when both compounds are on the same requisition. Final price —
          not combinable with discount codes.
        </p>

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleAddBundle}
          className="mt-auto w-full"
          aria-label={`Add ${productA.name} ${doseA} and ${productB.name} ${doseB} to inquiry`}
        >
          {added ? '✓ Added' : 'Add pair to inquiry'}
        </Button>
      </div>
    </section>
  );
}
