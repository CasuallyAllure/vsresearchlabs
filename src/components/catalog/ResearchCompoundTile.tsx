/**
 * ResearchCompoundTile
 *
 * Education-first tile for the Research Intelligence Library
 * ("Compounds on record", /research). Sibling to CompoundTile and
 * CompactProductTile — but this surface answers "what is this
 * compound?", not "buy this". So it deliberately drops every commerce
 * control the store tiles carry: no Add button, no dose picker, no
 * 24-hour / shipping pips. The whole tile is one tap target that opens
 * the shared CompoundIntelligenceOverlay, where buying (identical to
 * the store) lives.
 *
 *   ┌────────────────────────┐
 *   │  ╭──────────────────╮  │  ← compound floating on a glass square
 *   │  │    specimen       │  │
 *   │  ╰──────────────────╯  │
 *   │ FAMILY · ABBR           │  ← eyebrow
 *   │ Compound name            │
 *   │ short description text…  │  ← 3-line clamp, never leaks the box
 *   │ from $price   View →     │  ← quiet price + open affordance
 *   └────────────────────────┘
 *
 * Price uses the canonical price path (effectiveTierPriceCents) and is
 * informational only — it reads as the lowest publicly-priced dose so
 * the education surface can still answer "roughly what does a unit
 * cost" without turning into a checkout row.
 */

import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isVariantPublic } from '../../lib/productOverrides';

interface ResearchCompoundTileProps {
  product: Product;
  /** Tap anywhere on the tile to open the intelligence overlay. */
  onInspect?: (id: string) => void;
}

export function ResearchCompoundTile({ product, onInspect }: ResearchCompoundTileProps) {
  const imageUrl = product.images?.[0] ?? null;

  // Subscribe to admin overrides so the informational price recomputes
  // live when a dose price is set / cleared.
  useProductOverrides((s) => s.variantBySku);
  useProductOverrides((s) => s.bySku[product.sku] ?? null);

  // Lowest publicly-priced dose → "from $X". Falls back to the derived
  // product dose (formula price) when no variant carries an admin price,
  // so the tile always shows a figure without exposing a dose picker.
  const publicVariants = (product.variants ?? []).filter((v) => isVariantPublic(product.sku, v.dose));
  const prices = publicVariants
    .map((v) => effectiveTierPriceCents(product, v.dose))
    .filter((c): c is number => c != null);
  const priceCents = prices.length > 0 ? Math.min(...prices) : effectiveTierPriceCents(product, deriveProductDose(product));
  const showFrom = prices.length > 1 && Math.min(...prices) !== Math.max(...prices);

  return (
    <button
      type="button"
      onClick={() => onInspect?.(product.id)}
      aria-label={`Read the intelligence dossier for ${product.name}`}
      className="floating-module is-interactive group flex w-full flex-col overflow-hidden text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
    >
      {/* Specimen floats on an inset glass square. Concentric radius:
          module 20px − 8px padding shell. */}
      <div className="p-2">
        <div
          className="relative aspect-square w-full overflow-hidden rounded-[calc(var(--radius-module)-8px)]"
          style={{
            backgroundColor: 'var(--color-surface-sunken)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-ink/20">
              No image
            </div>
          )}
        </div>
      </div>

      {/* Identity + description — everything clamped so no word leaks. */}
      <div className="flex flex-1 flex-col px-3.5 pb-2 pt-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40">
            {product.abbreviation} · {product.family.split(' ')[0]}
          </p>
          {product.nickname && (
            <span
              className="shrink-0 rounded-full border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{
                color: 'var(--color-accent-gold-dark)',
                borderColor: 'rgba(140,144,148,0.40)',
                backgroundColor: 'rgba(140,144,148,0.10)',
              }}
            >
              {product.nickname}
            </span>
          )}
        </div>
        <h3 className="truncate text-[14px] font-normal leading-snug text-ink">
          {product.name}
        </h3>
        {product.shortDescription && (
          <p className="mt-1 text-[12px] leading-relaxed text-ink/55 line-clamp-3">
            {product.shortDescription}
          </p>
        )}
      </div>

      {/* Quiet informational footer — price + open affordance. No cart. */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink/[0.05] px-3.5 pb-3 pt-2">
        <span className="whitespace-nowrap font-mono tabular-nums text-[12px] leading-none text-ink/70">
          {showFrom && <span className="text-ink/40">from </span>}
          {formatPrice(priceCents)}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-ink/45 transition-colors group-hover:text-ink/70">
          View
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
    </button>
  );
}

export function ResearchCompoundTileSkeleton() {
  return (
    <div className="floating-module overflow-hidden" aria-hidden="true">
      <div className="p-2">
        <div className="aspect-square w-full rounded-[calc(var(--radius-module)-8px)] bg-ink/[0.06] animate-pulse" />
      </div>
      <div className="px-3.5 pb-3.5 pt-1 space-y-2">
        <div className="h-2 w-1/2 rounded bg-ink/[0.06] animate-pulse" />
        <div className="h-3 w-3/4 rounded bg-ink/[0.06] animate-pulse" />
        <div className="h-3 w-full rounded bg-ink/[0.06] animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-ink/[0.06] animate-pulse" />
      </div>
    </div>
  );
}
