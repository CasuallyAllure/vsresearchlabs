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
import {
  useProductOverrides,
  isSkuVisible,
  isVariantPublic,
  doseAvailability,
} from '../../lib/productOverrides';
import { useProducts } from '../../hooks/useProducts';
import { BUNDLE_PROMO, BUNDLE_FEATURED, bundleDiscount } from '../../lib/bundle';
import { Button } from '../ui/Button';
import { AvailabilityBadge } from './AvailabilityBadge';
import { BundlePairModal } from './BundlePairModal';
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
  const [detailOpen, setDetailOpen] = useState(false);
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

  // Dispatch badge for the pair — it can only ship as fast as its SLOWER
  // half, so represent it by the lower KNOWN dispatch tier of the two
  // components (never over-promise 24h when one leg is sourced). Unknowns are
  // ignored; if neither dose is tracked, no badge renders — same honesty rule
  // as AvailabilityBadge everywhere else.
  const tierRank = (state: string) => (state === 'in_stock' ? 2 : state === 'sourced' ? 1 : 0);
  const legs = [
    { sku: productA.sku, dose: doseA, rank: tierRank(doseAvailability(productA.sku, doseA).state) },
    { sku: productB.sku, dose: doseB, rank: tierRank(doseAvailability(productB.sku, doseB).state) },
  ].filter((leg) => leg.rank > 0);
  const dispatchLeg = legs.length
    ? legs.reduce((slower, leg) => (leg.rank < slower.rank ? leg : slower))
    : null;

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
    <>
    {/* Compact two-part slide (matches ProductSpotlightSlide): a capped image
        BAND on mobile / a left image COLUMN on desktop, with price + CTA beside
        it. Keeps the slide short so the carousel doesn't swallow the viewport
        and every slide stays the same height. Content vertically centered so
        there's no dead gap under the CTA. */}
    <section
      aria-label="Paired compound supply"
      className={`flex h-full flex-col md:min-h-[256px] md:flex-row md:items-stretch ${className}`}
    >
      {/* Image — the paired-supply render (two vials on the lab-glass set).
          "Paired supply" chip + the pairing line sit ON it over scrims.
          Mobile: capped band in flow. Desktop: absolutely fills the left
          column (see ProductSpotlightSlide — %-height won't resolve against a
          flex-stretched parent). */}
      {/* Image opens the compound overlay scoped to the pair — so the slide
          reads as an openable card that explains what's in the bundle, not a
          dead picture. A heading can't live inside a button, so the status
          chip is a styled span (the section aria-label already names it). */}
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        aria-label={`See what's in the ${productA.name} + ${productB.name} paired supply`}
        className="relative block w-full shrink-0 overflow-hidden text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 md:w-[42%]"
      >
        <img
          src={BUNDLE_IMAGE}
          alt={`${productA.name} and ${productB.name} research vials — paired supply`}
          className="h-[160px] w-full object-cover sm:h-[184px] md:absolute md:inset-0 md:h-full"
          style={{ objectPosition: '60% 40%' }}
          loading="lazy"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(9,8,6,0.86) 0%, rgba(9,8,6,0.34) 34%, transparent 58%), linear-gradient(to bottom, rgba(9,8,6,0.42) 0%, transparent 26%)',
          }}
        />
        {/* One label, not two: the status chip IS the section heading. */}
        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/35 px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-status-success)] backdrop-blur-sm">
          Paired supply
        </span>
        {/* Expand affordance so the slide clearly reads as openable. */}
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/40 px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/80 backdrop-blur-sm"
        >
          Details ↗
        </span>
        {/* Pairing line — the wording, on the image, over the bottom scrim. */}
        <span className="absolute inset-x-4 bottom-3 block text-[13.5px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
          {productA.name} <span className="text-white/65">{doseA}</span>
          <span className="px-1 text-white/45">+</span>
          {productB.name} <span className="text-white/65">{doseB}</span>
        </span>
      </button>

      {/* Price + disclaimer + CTA, vertically centered on the card surface. */}
      <div className="flex flex-1 flex-col justify-center p-[var(--space-4)] lg:p-[var(--space-5)]">
        {dispatchLeg && (
          <div className="mb-2.5">
            <AvailabilityBadge sku={dispatchLeg.sku} dose={dispatchLeg.dose} />
          </div>
        )}
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
          className="w-full md:w-auto md:min-w-[240px] md:self-start"
          aria-label={`Add ${productA.name} ${doseA} and ${productB.name} ${doseB} to inquiry`}
        >
          {added ? '✓ Added' : 'Add pair to inquiry'}
        </Button>

        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="mt-2.5 inline-flex items-center gap-1.5 self-start text-[11px] uppercase tracking-[0.16em] text-holo/75 transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
        >
          <span>See what's inside</span>
          <span aria-hidden="true" className="text-holo/45">↗</span>
        </button>
      </div>
    </section>

    <BundlePairModal
      open={detailOpen}
      onClose={() => setDetailOpen(false)}
      productA={productA}
      doseA={doseA}
      productB={productB}
      doseB={doseB}
      totalCents={totalCents}
      bundleCents={bundleCents}
      discountCents={discountCents}
      percent={BUNDLE_PROMO.percent}
      onAddPair={handleAddBundle}
    />
    </>
  );
}
