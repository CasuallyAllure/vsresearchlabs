/**
 * CompoundTile
 *
 * Enriched catalog tile for the biopeptide "compound sections" layout
 * (BiopeptideResearchSupplies). Sibling to CompactProductTile — that
 * component stays the dense 2–5 column tile used by the other catalog
 * pages; this one is roomier (1–3 columns) so it has room for a purity
 * badge and a one-line description.
 *
 *   ┌────────────────────────┐
 *   │ [Certified · ≥98%]     │  ← purity badge, overlaid top-left
 *   │        thumbnail        │
 *   ├────────────────────────┤
 *   │ FAMILY · ABBR           │  ← eyebrow
 *   │ Compound name            │
 *   │ short description text…  │  ← 2-line clamp
 *   │ [ dose ]  [ dose ]       │  ← dose pills
 *   │ $price        [24 HR]   │  ← price + availability badge
 *   │ [     + Add to cart    ]│
 *   └────────────────────────┘
 *
 * Tapping the image/identity block opens the intelligence overlay via
 * `onInspect`. The dose pills and Add button live outside that tap
 * target so they act without opening the overlay — same contract as
 * CompactProductTile.
 */

import { useState, useRef } from 'react';
import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isVariantPublic, is24hrDose, doseAvailability } from '../../lib/productOverrides';
import { AvailabilityBadge } from './AvailabilityBadge';

interface CompoundTileProps {
  product: Product;
  /** Tap the image/identity block to open the intelligence overlay. */
  onInspect?: (id: string) => void;
  /** When true, the dose chips list ONLY 24-hour doses (in-stock filter on). */
  only24hrDoses?: boolean;
}

export function CompoundTile({ product, onInspect, only24hrDoses }: CompoundTileProps) {
  const imageUrl = product.images?.[0] ?? null;

  // Subscribe to overrides so admin price/stock changes propagate live.
  useProductOverrides((s) => s.bySku[product.sku] ?? null);
  useProductOverrides((s) => s.variantBySku);

  // Only render variants with an admin-set price — no-price doses stay
  // hidden from the public catalog (same rule as CompactProductTile).
  const allVariants = product.variants ?? [];
  const publicVariants = allVariants.filter((v) => isVariantPublic(product.sku, v.dose));
  // With the in-stock filter on, narrow the dose picker to 24-hour doses
  // only; fall back to the full public list if that would leave nothing
  // (defensive — the page-level filter already guarantees at least one).
  const only24hr = publicVariants.filter((v) => is24hrDose(product.sku, v.dose));
  const variants = only24hrDoses && only24hr.length > 0 ? only24hr : publicVariants;

  // Default the active dose to the first 24-hour dose when one exists, so a
  // stocked product never opens on a sourced dose (e.g. Semaglutide 2mg).
  const [manualTierIndex, setManualTierIndex] = useState<number | null>(null);
  const defaultTierIndex = (() => {
    const idx = variants.findIndex((v) => is24hrDose(product.sku, v.dose));
    return idx >= 0 ? idx : 0;
  })();
  const tierIndex = manualTierIndex !== null && manualTierIndex < variants.length ? manualTierIndex : defaultTierIndex;
  const setTierIndex = setManualTierIndex;
  const activeDose = variants[tierIndex]?.dose ?? deriveProductDose(product);
  const priceCents = effectiveTierPriceCents(product, activeDose);

  const puritySpec = product.specs.find((s) => s.label === 'Purity (HPLC)');

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
    <article className="floating-module is-interactive overflow-hidden flex flex-col group">
      {/* Tappable head: purity badge + image + identity + description → inspect overlay */}
      <button
        type="button"
        onClick={handleTileClick}
        className="text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 flex flex-col"
        aria-label={`Inspect ${product.name}`}
      >
        <div className="p-1.5">
          <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-procurement)] bg-display">
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
            {puritySpec && (
              <span
                className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]"
                style={{
                  color: '#fff',
                  borderColor: 'rgba(255,255,255,0.28)',
                  backgroundColor: 'rgba(20,20,20,0.55)',
                  backdropFilter: 'blur(2px)',
                }}
                title={`Purity (HPLC): ${puritySpec.value}`}
              >
                Certified · {puritySpec.value}
              </span>
            )}
          </div>
        </div>

        {/* Identity — name + one-line description */}
        <div className="px-3.5 pt-1 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 truncate">
              {product.abbreviation} · {product.family.split(' ')[0]}
            </p>
            {product.nickname && (
              <span
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] px-1.5 py-[1px] rounded-[2px] border"
                style={{
                  color: '#7E8288',
                  borderColor: 'rgba(140,144,148,0.40)',
                  backgroundColor: 'rgba(140,144,148,0.10)',
                }}
              >
                {product.nickname}
              </span>
            )}
          </div>
          <h3 className="text-[14px] font-normal text-ink leading-snug truncate">
            {product.name}
          </h3>
          {product.shortDescription && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink/55 line-clamp-2">
              {product.shortDescription}
            </p>
          )}
        </div>
      </button>

      {/* Buy controls — outside the tap target */}
      <div className="px-3.5 pb-3.5 pt-1.5 border-t border-ink/[0.05] mt-auto">
        {variants.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Select dose"
            className="flex flex-wrap gap-1 mb-2"
            onClick={(e) => e.stopPropagation()}
          >
            {variants.map((v, i) => (
              <DoseChip
                key={v.dose}
                sku={product.sku}
                dose={v.dose}
                interactive
                isActive={i === tierIndex}
                onClick={(e) => { e.stopPropagation(); setTierIndex(i); }}
              />
            ))}
          </div>
        ) : variants.length === 1 ? (
          // Single-dose products still need their dose visible — a static
          // (non-radiogroup) chip, since there's nothing to pick between.
          <div className="flex flex-wrap gap-1 mb-2">
            <DoseChip sku={product.sku} dose={variants[0].dose} isActive={false} />
          </div>
        ) : null}

        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-mono tabular-nums text-[13px] text-ink/90 leading-none whitespace-nowrap">
              {formatPrice(priceCents)}
            </span>
            <AvailabilityBadge sku={product.sku} dose={activeDose} />
          </div>

          <button
            type="button"
            onClick={handleAdd}
            aria-label={`Add ${product.name} ${activeDose} to inquiry`}
            className={[
              'shrink-0 min-h-[40px] min-w-[40px] inline-flex items-center justify-center gap-1 rounded-full border px-3 text-[10px] uppercase tracking-[0.14em] font-normal leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 disabled:opacity-40 disabled:cursor-not-allowed',
              added
                ? 'bg-[#868A90]/[0.16] border-[#868A90]/45 text-[#868A90]'
                : 'bg-transparent border-ink/[0.16] text-ink/[0.7] hover:bg-ink/[0.06] hover:text-ink',
            ].join(' ')}
          >
            {added ? '✓' : '+ Add'}
          </button>
        </div>
      </div>
    </article>
  );
}

interface DoseChipProps {
  sku: string;
  dose: string;
  isActive: boolean;
  /** Radio-button behavior (dose picker). Omit for a static single-dose label. */
  interactive?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

/** One dose pill — interactive (radio, part of the multi-dose picker) or
 *  static (single-dose products, which still need their dose visible). */
function DoseChip({ sku, dose, isActive, interactive, onClick }: DoseChipProps) {
  const av = doseAvailability(sku, dose);
  const isFast = av.state === 'in_stock' && av.fast;
  const doseTxt = dose.replace(/\s+/g, '').toUpperCase();
  const style = {
    fontSize: '10px',
    letterSpacing: '0.14em',
    backgroundColor: isActive ? 'var(--color-content-primary)' : 'var(--color-interactive-secondary)',
    color: isActive ? 'var(--color-surface-base)' : 'var(--color-content-secondary)',
    borderColor: isActive ? 'var(--color-content-primary)' : 'rgb(var(--c-ink) / 0.12)',
  } as const;
  const content = (
    <>
      {doseTxt}
      {isFast && (
        <span
          className="ml-1"
          style={{
            color: isActive ? 'rgba(155,196,163,1)' : '#2E7D5B',
            fontSize: '10px',
            letterSpacing: '0.16em',
          }}
        >
          · 24 HR
        </span>
      )}
    </>
  );

  if (!interactive) {
    return (
      <span
        className="font-mono leading-none px-2 py-1 rounded-full border"
        style={style}
        title={isFast ? `${dose} · 24 hour shipping` : dose}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      title={isFast ? `${dose} · 24 hour shipping` : dose}
      className="font-mono leading-none px-2 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
      style={style}
    >
      {content}
    </button>
  );
}

export function CompoundTileSkeleton() {
  return (
    <article className="floating-module overflow-hidden" aria-hidden="true">
      <div className="p-1.5">
        <div className="aspect-square w-full rounded-[var(--radius-procurement)] bg-ink/[0.06] animate-pulse" />
      </div>
      <div className="px-3.5 pb-3.5 pt-1 space-y-2">
        <div className="h-2 bg-ink/[0.06] rounded animate-pulse w-1/2" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-3/4" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-full" />
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-2/3" />
      </div>
    </article>
  );
}
