/**
 * ProductSpotlightSlide — a single-product hero slide for the featured-supply
 * carousel. Shared by the "newly cataloged" (GLOW) and Korean Glutathione
 * slides so the layout, gating, pricing, and add-to-cart behavior live in one
 * place instead of forking per compound.
 *
 * AVAILABILITY IS READ, NEVER ASSERTED. Two badge modes:
 *
 *   'availability' — the standard <AvailabilityBadge> (24 Hour Shipping /
 *                     Standard Shipping / nothing), same rule everywhere else
 *                     in the catalog.
 *   'limited'       — a refined green "Limited availability" pill when the
 *                     dose is genuinely `sourced`, or `in_stock` with low
 *                     on-hand (≤ LOW_STOCK_THRESHOLD). Ample on-hand supply
 *                     falls back to the normal 24-hour badge (never asserts
 *                     false scarcity); `unknown` renders nothing.
 *
 * The module renders nothing until the overrides have loaded cleanly, the SKU
 * is visible, and the featured dose is publicly listed — a half-loaded store
 * or a hidden dose must never render a claim (or an add control) it can't
 * back up.
 *
 * PRICE comes from `effectiveTierPriceCents` — never hardcoded — in the same
 * mono hierarchy BundleOfferTile uses. The "Add to inquiry" button only wires
 * the direct add when the price resolves to a real, positive number; if
 * pricing ever comes back null/≤0 for this dose, the button opens the
 * compound overlay instead of ever adding a $0 line.
 *
 * Rendered inside FeaturedSupplyCarousel, which owns the single card chrome
 * (`floating-module`) for the whole carousel — this component is bare
 * content (no own border/background/radius) so its hero image bleeds to the
 * carousel box's edges.
 */

import { useRef, useState } from 'react';
import type { Product } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import {
  useProductOverrides,
  isSkuVisible,
  isVariantPublic,
  doseAvailability,
} from '../../lib/productOverrides';
import { AvailabilityBadge } from './AvailabilityBadge';
import { Button } from '../ui/Button';

export type SpotlightBadgeMode = 'availability' | 'limited';

/** At or below this on-hand count, an in-stock dose still reads as "limited"
 *  rather than the normal 24-hour badge — a real, data-driven scarcity
 *  signal, not a fabricated one. */
const LOW_STOCK_THRESHOLD = 5;

interface ProductSpotlightSlideProps {
  products: Product[];
  /** Product slug to feature — looked up from `products`. */
  slug: string;
  /** The dose tier this slide prices, badges, and adds to cart. */
  dose: string;
  heroImage: string;
  /** Chip text on the hero image (e.g. "Newly cataloged", "Antioxidant · Reduced form"). */
  eyebrow: string;
  description: string;
  /** @default 'availability' */
  badge?: SpotlightBadgeMode;
  /** object-position for the hero <img>. @default '50% 42%' */
  heroObjectPosition?: string;
  onInspect: (id: string) => void;
  /** Layout classes from the parent (width / snap / flex). */
  className?: string;
}

/**
 * Splits "GLOW Blend (BPC-157 · GHK-Cu · TB-500)" into a short title and its
 * constituent list, so a long blend name reads as a title + a smaller mono
 * detail line instead of one long run. Names with no parenthetical (e.g.
 * "Korean Glutathione") pass through unchanged.
 */
function splitCompoundName(name: string): { title: string; detail: string | null } {
  const match = name.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!match) return { title: name, detail: null };
  return { title: match[1].trim(), detail: match[2].trim() };
}

function LimitedAvailabilityBadge({ sku, dose }: { sku: string; dose: string }) {
  // Subscribe to the exact (sku, dose) row so an admin stock edit re-renders
  // this badge live, same as AvailabilityBadge.
  const variantOverride = useProductOverrides((s) => s.variantBySku[sku]?.[dose]);
  const availability = doseAvailability(sku, dose);

  if (availability.state === 'unknown') return null;

  const onHand = variantOverride?.on_hand ?? 0;
  const isLowStock =
    availability.state === 'in_stock' && onHand > 0 && onHand <= LOW_STOCK_THRESHOLD;

  if (availability.state === 'sourced' || isLowStock) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.13em]"
        style={{
          borderColor: 'color-mix(in srgb, var(--color-status-success) 35%, transparent)',
          color: 'var(--color-status-success)',
          backgroundColor: 'var(--color-status-successMuted)',
          opacity: 0.85,
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1 w-1 rounded-full"
          style={{ backgroundColor: 'var(--color-status-success)' }}
        />
        Limited availability
      </span>
    );
  }

  // Ample on-hand supply — the normal 24-hour badge, never false scarcity.
  return <AvailabilityBadge sku={sku} dose={dose} />;
}

export function ProductSpotlightSlide({
  products,
  slug,
  dose,
  heroImage,
  eyebrow,
  description,
  badge = 'availability',
  heroObjectPosition = '50% 42%',
  onInspect,
  className = '',
}: ProductSpotlightSlideProps) {
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

  const product = products.find((p) => p.slug === slug);
  if (!product) return null;
  if (!isSkuVisible(product.sku)) return null;
  if (!isVariantPublic(product.sku, dose)) return null;

  const { title, detail } = splitCompoundName(product.name);
  const detailLine = detail ? `${detail} · ${dose}` : dose;
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
    // Compact two-part slide: a capped image BAND on mobile / a left image
    // COLUMN on desktop, content beside it. A full-width image on the ~1100px
    // desktop column rendered ~750px tall ("takes the whole screen"); the
    // side-by-side layout keeps every slide short so the catalog shows beneath.
    // Content is vertically centered so equal-height slides carry no dead gap.
    <section
      aria-label={`${title} spotlight`}
      className={`flex h-full flex-col md:min-h-[256px] md:flex-row md:items-stretch ${className}`}
    >
      {/* Image — eyebrow chip + title sit ON it over legibility scrims (the
          chip carries its own opaque backdrop so it reads over any photo,
          light or dark). Clicking opens the compound overlay — a separate
          control from the Add button (no nested buttons). */}
      <button
        type="button"
        onClick={() => onInspect(product.id)}
        aria-label={`Inspect ${product.name}`}
        className="relative block w-full shrink-0 overflow-hidden text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 md:w-[42%]"
      >
        {/* Mobile: a capped band in flow. Desktop: absolutely fills the left
            column (a %-height <img> won't resolve against a flex-stretched
            parent, so it fell back to its square intrinsic size and clipped to
            a dark top band — absolute inset-0 fills reliably). */}
        <img
          src={heroImage}
          alt={`${title} research vial`}
          className="h-[160px] w-full object-cover sm:h-[184px] md:absolute md:inset-0 md:h-full"
          style={{ objectPosition: heroObjectPosition }}
          loading="lazy"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(9,8,6,0.9) 0%, rgba(9,8,6,0.42) 32%, transparent 60%), linear-gradient(to bottom, rgba(9,8,6,0.5) 0%, transparent 28%)',
          }}
        />
        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/40 px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-white/85 backdrop-blur-sm">
          {eyebrow}
        </span>
        {/* Expand affordance so the slide clearly reads as openable. */}
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/40 px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/80 backdrop-blur-sm"
        >
          Details ↗
        </span>
        <span className="absolute inset-x-4 bottom-3">
          <span className="block text-[14px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
            {title}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-white/70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
            {detailLine}
          </span>
        </span>
      </button>

      {/* Copy + availability + price + CTA, vertically centered on the card. */}
      <div className="flex flex-1 flex-col justify-center p-[var(--space-4)] lg:p-[var(--space-5)]">
        <p className="line-clamp-2 max-w-[54ch] text-[12px] leading-relaxed text-ink/70">
          {description}
        </p>

        <div className="mt-2.5">
          {badge === 'limited' ? (
            <LimitedAvailabilityBadge sku={product.sku} dose={dose} />
          ) : (
            <AvailabilityBadge sku={product.sku} dose={dose} />
          )}
        </div>

        {priceCents != null && priceCents > 0 && (
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-semibold tabular-nums leading-none text-ink">
              {formatPrice(priceCents)}
            </span>
          </div>
        )}

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handlePrimaryAction}
          className="mt-3.5 w-full md:w-auto md:min-w-[240px] md:self-start"
          aria-label={`Add ${product.name} ${dose} to inquiry`}
        >
          {added ? '✓ Added' : 'Add to inquiry'}
        </Button>

        <button
          type="button"
          onClick={() => onInspect(product.id)}
          className="mt-2.5 inline-flex items-center gap-1.5 self-start text-[11px] uppercase tracking-[0.16em] text-holo/75 transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
        >
          <span>See full record</span>
          <span aria-hidden="true" className="text-holo/45">↗</span>
        </button>
      </div>
    </section>
  );
}
