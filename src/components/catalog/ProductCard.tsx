/**
 * ProductCard
 * Wave 2 — Module Containment
 * Wave 7c — AbbreviationChip + DoseTierStrip integration
 * Reconciliation Pass C — Inventory-register alignment.
 *
 * Bounded Level-1 solid-surface module. Operational metadata leads, the
 * image is supporting, motion is a hairline tint shift on the title.
 *
 * Two modes:
 *   - default: the whole card is one tap target (navigate to /product/:id
 *     or open the intelligence overlay via `onInspect`). Tiers render as
 *     read-only "also available in" pills.
 *   - showPurchase: the head (image + identity) stays the tap target, and
 *     a footer carries an INTERACTIVE tier picker, a live price that
 *     updates with the selected tier, and an Add-to-inquiry button — so a
 *     tier can be chosen and added without opening the card.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isSkuInStock, isVariantPublic } from '../../lib/productOverrides';
import { AvailabilityBadge } from './AvailabilityBadge';
import { AbbreviationChip } from './AbbreviationChip';
import { TierStrip } from './intelligence/TierStrip';

const STOCK_GREEN = 'var(--color-status-success)';
const SOURCED_GRAY = 'var(--color-accent-teal-light)';

interface ProductCardProps {
  product: Product;
  /** When provided, card click opens the intelligence overlay instead of navigating. */
  onInspect?: (id: string) => void;
  /** When true, renders a tiny in-stock / out-of-stock pip on the card. */
  showStock?: boolean;
  /** When true, the card carries an interactive tier picker, live price, and Add button. */
  showPurchase?: boolean;
}

export function ProductCard({ product, onInspect, showStock, showPurchase }: ProductCardProps) {
  const imageUrl = product.images?.[0] ?? null;
  // Subscribe to admin overrides so price/stock recompute when they load.
  useProductOverrides((s) => s.variantBySku);
  useProductOverrides((s) => s.bySku);
  const stocked = isSkuInStock(product.sku);
  // Filter to publicly-priced variants. Unpriced doses live in the catalog
  // seed for admin import / future stocking, but stay invisible to buyers
  // until the master sheet assigns them a price.
  const allVariants = product.variants ?? [];
  const variants = allVariants.filter((v) => isVariantPublic(product.sku, v.dose));

  const [tierIndex, setTierIndex] = useState(0);
  const activeDose = variants[tierIndex]?.dose ?? deriveProductDose(product);
  const priceCents = effectiveTierPriceCents(product, activeDose);

  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const [added, setAdded] = useState(false);

  function handleAdd() {
    const line = variantProduct(product, activeDose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) updateQuantity(line.id, existing.quantity + 1);
    else add(line);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }

  const stockPip = showStock ? (
    <span
      aria-label={stocked ? '24 Hour Shipping' : 'Standard shipping (7–10 business days)'}
      title={stocked ? '24 Hour Shipping' : 'Standard shipping (7–10 business days)'}
      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] uppercase tracking-[0.12em]"
      style={{
        color: stocked ? STOCK_GREEN : SOURCED_GRAY,
        backgroundColor: 'rgba(0,0,0,0.55)',
        border: `0.5px solid ${(stocked ? STOCK_GREEN : SOURCED_GRAY)}66`,
        backdropFilter: 'blur(2px)',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[5px] w-[5px] rounded-full"
        style={{
          backgroundColor: stocked ? STOCK_GREEN : SOURCED_GRAY,
        }}
      />
      {stocked ? '24 Hour' : 'Sourced'}
    </span>
  ) : null;

  const imageBlock = (
    <div className="p-1">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[10px] bg-display">
        {imageUrl ? (
          <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-ink/20 text-xs uppercase tracking-widest">
            No image
          </div>
        )}
        {stockPip}
      </div>
    </div>
  );

  const identity = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.25em] text-ink/40">
          {product.family}
        </p>
        {product.nickname && (
          <span
            className="text-[10px] uppercase tracking-[0.22em] px-1.5 py-0.5 rounded-full border"
            style={{
              color: 'var(--color-content-secondary)',
              borderColor: 'var(--color-border-default)',
              backgroundColor: 'var(--color-interactive-secondary)',
            }}
          >
            “{product.nickname}”
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <AbbreviationChip value={product.abbreviation} />
        <h3 className="text-sm font-normal text-ink truncate min-w-0 flex-1 group-hover:text-gold transition-colors">
          {product.name}
        </h3>
      </div>
      <p className="text-[11px] tracking-wide text-ink/40 truncate">
        <span className="text-ink/55 tabular-nums">{product.sku}</span>
        {product.shortDescription && (
          <>
            <span className="mx-1.5 text-ink/25" aria-hidden="true">·</span>
            <span>{product.shortDescription}</span>
          </>
        )}
      </p>
    </>
  );

  // ── Purchase mode — head navigates, footer is the buy control ──────────
  if (showPurchase) {
    const head = (
      <>
        {imageBlock}
        <div className="border-t border-ink/[0.06] px-4 pt-3 pb-2 space-y-1.5">
          {identity}
        </div>
      </>
    );
    return (
      <div className="research-surface-solid overflow-hidden group rounded-[var(--radius-procurement)]">
        {onInspect ? (
          <button
            type="button"
            onClick={() => onInspect(product.id)}
            className="block w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
          >
            {head}
          </button>
        ) : (
          <Link
            to={`/product/${product.id}`}
            className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
          >
            {head}
          </Link>
        )}

        {/* Buy controls — outside the tap target so they don't navigate. */}
        <div className="px-4 pb-3 pt-1.5">
          {variants.length > 0 && (
            <>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.22em] text-ink/30">
                Tier
              </p>
              <TierStrip
                mode="select"
                size="sm"
                sku={product.sku}
                variants={variants}
                selectedIndex={tierIndex}
                onSelect={setTierIndex}
              />
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <AvailabilityBadge sku={product.sku} dose={activeDose} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-ink/[0.05] pt-2.5">
            <span className="font-mono tabular-nums leading-none text-ink/90" style={{ fontSize: '12.5px' }}>
              {formatPrice(priceCents)}
            </span>
            <button
              type="button"
              onClick={handleAdd}
              aria-label={`Add ${product.name} ${activeDose} to inquiry`}
              className="min-h-[40px] inline-flex items-center justify-center rounded-full uppercase tracking-[0.14em] font-normal transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
              style={{
                padding: '0 14px',
                fontSize: '10px',
                backgroundColor: added ? 'color-mix(in srgb, var(--color-accent-teal-light) 14%, transparent)' : 'var(--color-interactive-secondary)',
                border: added ? '1px solid color-mix(in srgb, var(--color-accent-teal-light) 40%, transparent)' : '1px solid var(--color-border-default)',
                color: added ? 'var(--color-accent-teal-light)' : 'var(--color-content-secondary)',
              }}
            >
              {added ? '✓ Added' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Default mode (unchanged) — whole card navigates / inspects ─────────
  return (
    <Link
      to={`/product/${product.id}`}
      onClick={onInspect ? (e) => { e.preventDefault(); onInspect(product.id); } : undefined}
      className="block rounded-[var(--radius-procurement)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
    >
      <div className="research-surface-solid is-interactive overflow-hidden group">
        {imageBlock}
        <div className="border-t border-ink/[0.06] px-4 py-3 space-y-1.5">
          {identity}
          {variants.length > 0 && (
            <TierStrip sku={product.sku} variants={variants} activeDose={activeDose} className="pt-0.5" />
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * ProductCardSkeleton
 *
 * Renders within identical bounds to `ProductCard` so the loading state
 * occupies the grid without layout shift.
 */
export function ProductCardSkeleton() {
  return (
    <div className="research-surface-solid overflow-hidden" aria-hidden="true">
      <div className="p-1">
        <div className="aspect-[4/3] w-full rounded-[10px] bg-display animate-pulse" />
      </div>
      <div className="border-t border-ink/[0.06] px-4 py-3 space-y-2">
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-1/3" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-3/4" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-1/2" />
      </div>
    </div>
  );
}
