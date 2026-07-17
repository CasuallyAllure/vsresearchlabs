/**
 * CompactProductTile
 *
 * Dense catalog tile sized for the mobile gallery grid (2 cols on
 * phone, 3 on small tablet, 4 on tablet, 5+ on desktop). Carries the
 * minimum interactive surface the user can act on without leaving
 * the catalog:
 *
 *   ┌────────────────┐
 *   │   thumbnail    │
 *   │  (square top)  │
 *   ├────────────────┤
 *   │ FAMILY · ABBR  │  ← eyebrow
 *   │ Compound name  │  ← 1-line truncated
 *   │ [ tier select ]│  ← native <select> for thumb-friendly tap
 *   │ $price    [+] │  ← live price + add to inquiry
 *   └────────────────┘
 *
 * Tapping the thumbnail or name opens the compound-intelligence
 * overlay via `onInspect`. The tier select and Add button do NOT
 * propagate — they update / submit inquiry state without opening
 * the overlay.
 */

import { useState, useRef } from 'react';
import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isSkuInStock, isVariantPublic, doseAvailability } from '../../lib/productOverrides';

const STOCK_GREEN = 'var(--color-status-success)';
const SOURCED_GRAY = 'var(--color-accent-teal-light)';

interface CompactProductTileProps {
  product: Product;
  /** Tap the body to open the intelligence overlay. */
  onInspect?: (id: string) => void;
}

export function CompactProductTile({ product, onInspect }: CompactProductTileProps) {
  const imageUrl = product.images?.[0] ?? null;

  // Subscribe to overrides so admin changes propagate immediately.
  useProductOverrides((s) => s.bySku[product.sku] ?? null);
  // Re-render when variant prices change.
  useProductOverrides((s) => s.variantBySku);
  const stocked = isSkuInStock(product.sku);
  // Only render variants with an admin-set price — no-price doses stay
  // hidden from the public catalog.
  const allVariants = product.variants ?? [];
  const variants = allVariants.filter((v) => isVariantPublic(product.sku, v.dose));

  const [tierIndex, setTierIndex] = useState(0);
  const activeDose = variants[tierIndex]?.dose ?? deriveProductDose(product);
  // effectiveTierPriceCents reads (per-dose override → per-sku override →
  // formula fallback) so the master sheet's prices flow through to the
  // tile. Previously this used tierPriceCents (formula only), which is
  // why AICAR rendered at $470 instead of the admin-set $60.
  const priceCents = effectiveTierPriceCents(product, activeDose);

  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const [added, setAdded] = useState(false);
  const flashTimer = useRef<number | null>(null);

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    const line = variantProduct(product, activeDose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) updateQuantity(line.id, existing.quantity + 1);
    else add(line);
    setAdded(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setAdded(false), 1100);
  }

  function handleTileClick() {
    if (onInspect) onInspect(product.id);
  }

  return (
    <article className="research-surface-solid overflow-hidden flex flex-col group">
      {/* Tappable head: image + identity → inspect overlay */}
      <button
        type="button"
        onClick={handleTileClick}
        className="text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 flex-1 flex flex-col"
        aria-label={`Inspect ${product.name}`}
      >
        <div className="relative aspect-square w-full overflow-hidden bg-display">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-ink/20 text-[10px] uppercase tracking-[0.2em]">
              No image
            </div>
          )}
          {/* Ship-tier pip — top-right corner. Green = 24-hour, gray = sourced
              (7-10 business days). Never a hard "out of stock" — every peptide
              is orderable. */}
          <span
            aria-label={stocked ? '24 Hour Shipping' : 'Standard shipping (7–10 business days)'}
            className="absolute right-1.5 top-1.5 inline-block h-[7px] w-[7px] rounded-full"
            style={{
              backgroundColor: stocked ? STOCK_GREEN : SOURCED_GRAY,
              boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.3)',
            }}
          />
        </div>

        {/* Identity — compact 2-line, with optional gold nickname pip */}
        <div className="px-2 pt-1.5 pb-1">
          <div className="flex items-center gap-1 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 truncate">
              {product.abbreviation} · {product.family.split(' ')[0]}
            </p>
            {product.nickname && (
              <span
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] px-1.5 py-[1px] rounded-full border"
                style={{
                  color: 'var(--color-accent-gold-dark)',
                  borderColor: 'color-mix(in srgb, var(--color-accent-gold-dark) 40%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-gold-dark) 10%, transparent)',
                }}
              >
                {product.nickname}
              </span>
            )}
          </div>
          <p className="text-[11px] font-normal text-ink leading-tight truncate">
            {product.name}
          </p>
        </div>
      </button>

      {/* Buy controls — outside the tap target */}
      <div className="px-2 pb-2 pt-1 border-t border-ink/[0.05] mt-auto">
        {variants.length > 1 && (
          <div
            role="radiogroup"
            aria-label="Select dose"
            className="flex flex-wrap gap-1 mb-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {variants.map((v, i) => {
              const isActive = i === tierIndex;
              const av = doseAvailability(product.sku, v.dose);
              const isFast = av.state === 'in_stock' && av.fast;
              const doseTxt = v.dose.replace(/\s+/g, '').toUpperCase();
              return (
                <button
                  key={v.dose}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={(e) => { e.stopPropagation(); setTierIndex(i); }}
                  title={isFast ? `${v.dose} · 24 hour shipping` : v.dose}
                  // min-h-[24px] — WCAG 2.2 SC 2.5.8 (AA). Chips are a few px
                  // apart in a wrap row, so the hit area can't be expanded past
                  // the box without neighbours overlapping and a stray tap
                  // selecting the wrong dose (= the wrong price).
                  className="inline-flex items-center justify-center min-h-[24px] font-mono leading-none px-2 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.14em',
                    backgroundColor: isActive ? 'var(--color-content-primary)' : 'var(--color-interactive-secondary)',
                    color: isActive ? 'var(--color-surface-base)' : 'var(--color-content-secondary)',
                    borderColor: isActive ? 'var(--color-content-primary)' : 'rgb(var(--c-ink) / 0.12)',
                  }}
                >
                  {doseTxt}
                  {isFast && (
                    <span
                      className="ml-1"
                      style={{
                        // The light mint (active branch) is a fixed contrast
                        // tint tuned for the pill's inverted dark fill
                        // (var(--color-content-primary)) and has no matching
                        // status token — left as-is. Inactive branch routes
                        // through the theme-aware success token.
                        color: isActive ? 'rgba(155,196,163,1)' : 'var(--color-status-success)',
                        fontSize: '10px',
                        letterSpacing: '0.16em',
                      }}
                    >
                      · 24 HR
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-1">
          <span className="font-mono tabular-nums text-[10.5px] text-ink/85 leading-none whitespace-nowrap">
            {formatPrice(priceCents)}
          </span>
          <button
            type="button"
            onClick={handleAdd}
            aria-label={`Add ${product.name} ${activeDose} to inquiry`}
            className={[
              // min-h-[44px]: the primary action, and isolated enough to carry a
              // full 44px box — its only close neighbour is the (inert) price.
              'shrink-0 inline-flex items-center justify-center min-h-[44px] rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] font-normal leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 disabled:opacity-40 disabled:cursor-not-allowed',
              // Theme-bound teal-light token (was a hardcoded hex) — never
              // hardcode the near-black ink hex here or the label goes
              // invisible on dark.
              added
                ? 'bg-teal-light/[0.16] border-teal-light/45 text-teal-light'
                : 'bg-ink/[0.05] border-ink/[0.14] text-ink/[0.78] hover:bg-ink/[0.09] hover:text-ink',
            ].join(' ')}
          >
            {added ? '✓' : '+ Add'}
          </button>
        </div>
      </div>
    </article>
  );
}

export function CompactProductTileSkeleton() {
  return (
    <article className="research-surface-solid overflow-hidden" aria-hidden="true">
      <div className="aspect-square w-full bg-ink/[0.06] animate-pulse" />
      <div className="px-2 py-2 space-y-1.5">
        <div className="h-2 bg-ink/[0.06] rounded animate-pulse w-1/2" />
        <div className="h-2.5 bg-ink/[0.06] rounded animate-pulse w-3/4" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-full" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-2/3" />
      </div>
    </article>
  );
}
