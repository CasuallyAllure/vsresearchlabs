/**
 * NewlyCatalogedSpotlight — the "recently added to the catalog" hero slide
 * that sits alongside BundleOfferTile in the featured-supply carousel.
 *
 * Featured ONLY the GLOW Blend (BPC-157 · GHK-Cu · TB-500, sku VSR-RS-GLWC).
 * Mirrors BundleOfferTile's hero layout (image + chip + title on the image,
 * copy + CTA on the card surface below) so the two slides read as siblings.
 *
 * AVAILABILITY IS READ, NEVER ASSERTED — same rule as before. The dispatch
 * chip comes from the shared <AvailabilityBadge>, which resolves
 * `doseAvailability(sku, dose)`:
 *
 *   in_stock (on_hand / inbound > 0) → "24 Hour Shipping"
 *   sourced  (tracked, no 24h supply) → "Standard Shipping"
 *   unknown  (no per-dose row)        → nothing at all
 *
 * The module renders nothing until the overrides have loaded cleanly, the SKU
 * is visible, and the featured dose is publicly listed — a half-loaded store
 * or a hidden dose must never render a claim (or an add control) it can't
 * back up.
 *
 * NO PRICE IS EVER SHOWN on this slide (owner decision — GLOW is
 * inquiry-first). The "Add to inquiry" button only wires the direct add when
 * `effectiveTierPriceCents` resolves to a real, positive number; if pricing
 * ever comes back null/≤0 for this dose, the button opens the compound
 * overlay instead of ever adding a $0 line — mirrors BundleOfferTile's
 * $0-safety invariant without ever displaying the number itself.
 *
 * Rendered as slide 2 inside FeaturedSupplyCarousel, which owns the single
 * card chrome (`floating-module`) for the whole carousel — this component is
 * bare content (no own border/background/radius) so its hero image bleeds to
 * the carousel box's edges.
 */

import { useRef, useState } from 'react';
import type { Product } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents } from '../../lib/pricing';
import { useProductOverrides, isSkuVisible, isVariantPublic } from '../../lib/productOverrides';
import { AvailabilityBadge } from './AvailabilityBadge';
import { Button } from '../ui/Button';

/** The single most-recently-cataloged compound this slide features. */
const FEATURED_SLUG = 'glow-blend-cu';

/** Hero render — the GLOW vial on the lab-glass set, matching the paired-
 *  supply slide's photographic treatment. */
const GLOW_IMAGE = '/vials/glow-blend-pair.webp';

interface NewlyCatalogedSpotlightProps {
  products: Product[];
  onInspect: (id: string) => void;
  /** Layout classes from the parent (width / snap / flex). */
  className?: string;
}

/**
 * Splits "GLOW Blend (BPC-157 · GHK-Cu · TB-500)" into a short title and its
 * constituent list, so a long blend name reads as a title + a smaller mono
 * detail line instead of one long run.
 */
function splitCompoundName(name: string): { title: string; detail: string | null } {
  const match = name.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!match) return { title: name, detail: null };
  return { title: match[1].trim(), detail: match[2].trim() };
}

export function NewlyCatalogedSpotlight({
  products,
  onInspect,
  className = '',
}: NewlyCatalogedSpotlightProps) {
  // Subscribe so an admin stock/visibility/price edit re-renders live, exactly
  // as CompoundTile and BundleOfferTile do.
  useProductOverrides((s) => s.bySku);
  useProductOverrides((s) => s.variantBySku);
  const overridesLoaded = useProductOverrides((s) => s.loaded);
  const overridesError = useProductOverrides((s) => s.error);

  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const [added, setAdded] = useState(false);
  const flashTimer = useRef<number | null>(null);

  // No clean inventory read → no module. Everything below states a dispatch
  // tier or wires an add — a half-loaded store would state either wrongly.
  if (!overridesLoaded || overridesError) return null;

  const product = products.find((p) => p.slug === FEATURED_SLUG);
  if (!product) return null;
  if (!isSkuVisible(product.sku)) return null;

  const dose = product.variants?.[0]?.dose;
  if (!dose) return null;
  if (!isVariantPublic(product.sku, dose)) return null;

  const { title, detail } = splitCompoundName(product.name);
  const priceCents = effectiveTierPriceCents(product, dose);
  const canAddDirectly = priceCents != null && priceCents > 0;

  function handlePrimaryAction() {
    if (!canAddDirectly) {
      onInspect(product!.id);
      return;
    }
    const line = variantProduct(product!, dose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) updateQuantity(line.id, existing.quantity + 1);
    else add(line);
    setAdded(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setAdded(false), 1100);
  }

  return (
    <section aria-label="Newly cataloged compound" className={`flex flex-col ${className}`}>
      {/* Hero — the GLOW vial render. The "Newly cataloged" chip and the
          title sit ON the image over legibility scrims, mirroring
          BundleOfferTile; the explanation and CTA read on the card surface
          below. Clicking the image opens the compound overlay — a separate
          control from the Add button below (no nested buttons). */}
      <button
        type="button"
        onClick={() => onInspect(product.id)}
        aria-label={`Inspect ${product.name}`}
        className="relative block w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
      >
        <img
          src={GLOW_IMAGE}
          alt="GLOW Blend research vial — newly cataloged"
          className="w-full object-cover"
          style={{ aspectRatio: '16 / 11', objectPosition: '50% 42%' }}
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
        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/35 px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-white/85 backdrop-blur-sm">
          Newly cataloged
        </span>
        <span className="absolute inset-x-4 bottom-3">
          <span className="block text-[14px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            {title}
          </span>
          {detail && (
            <span className="mt-0.5 block font-mono text-[11px] text-white/70">{detail}</span>
          )}
        </span>
      </button>

      {/* Copy + availability + CTA on the card surface. */}
      <div className="flex flex-1 flex-col p-[var(--space-4)] lg:p-[var(--space-5)]">
        <p className="max-w-[48ch] text-[12px] leading-relaxed text-ink/70">
          A single-vial research blend of three of the most-requested peptides — BPC-157,
          GHK-Cu, and TB-500 — newly added to the catalog for recovery and tissue-repair
          research models.
        </p>

        <div className="mt-3">
          <AvailabilityBadge sku={product.sku} dose={dose} />
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handlePrimaryAction}
          className="mt-4 w-full"
          aria-label={`Add ${product.name} ${dose} to inquiry`}
        >
          {added ? '✓ Added' : 'Add to inquiry'}
        </Button>
      </div>
    </section>
  );
}
