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
 *   │ [HPLC · ≥98%]          │  ← purity badge, overlaid top-left
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
import { isMemberPriceEligible } from '../../lib/memberPricing';
import { MemberPrice } from './MemberPrice';
import { useProductOverrides, isVariantPublic, is24hrDose, doseAvailability } from '../../lib/productOverrides';
import { ShippingVan, DoseChip, SourcedDoseSegment } from './DoseTierChips';
import { Tooltip } from '../ui/Tooltip';
import { usePromoSettings, b2g1TooltipContent } from '../../lib/promoSettings';

const SOURCED_SHIP_PLAIN = 'Standard shipping — sourced to order, arrives in 7–10 business days.';

interface CompoundTileProps {
  product: Product;
  /** Tap the image/identity block to open the intelligence overlay. */
  onInspect?: (id: string) => void;
  /** When true, the dose chips list ONLY 24-hour doses (in-stock filter on). */
  only24hrDoses?: boolean;
  /** Detail layout — full description plus a compact spec sheet. */
  detailed?: boolean;
}

export function CompoundTile({ product, onInspect, only24hrDoses, detailed }: CompoundTileProps) {
  const imageUrl = product.images?.[0] ?? null;

  // Subscribe to overrides so admin price/stock changes propagate live.
  useProductOverrides((s) => s.bySku[product.sku] ?? null);
  useProductOverrides((s) => s.variantBySku);
  usePromoSettings((s) => s.b2g1Enabled);
  usePromoSettings((s) => s.b2g1EndsAt);
  usePromoSettings((s) => s.b2g1ExcludedSkus);

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
    <article className="compound-tile floating-module is-interactive overflow-hidden flex flex-col group">
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
                className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.1em]"
                style={{
                  color: '#fff',
                  borderColor: 'rgba(255,255,255,0.26)',
                  backgroundColor: 'rgba(20,20,20,0.5)',
                  backdropFilter: 'blur(2px)',
                }}
                title={`Stated purity specification (HPLC): ${puritySpec.value}`}
              >
                HPLC · {puritySpec.value}
              </span>
            )}
          </div>
        </div>

        {/* Identity — the name (all-caps brand label) and the description live
            together on ONE recessed glass plate, spanning the same width as the
            image above so nothing reads squished. */}
        <div className="px-1.5 pt-1.5 pb-2">
          <div className="tile-spec-plate rounded-[var(--radius-field)] px-2.5 py-2">
            <div className="flex items-center justify-center gap-1.5 min-w-0">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-ink leading-tight truncate text-center">
                {product.name}
              </h3>
              {product.nickname && (
                // text-ink/65 — /45 composited to 2.86:1 on the spec plate,
                // well under WCAG 1.4.3 AA (4.5:1) for text this small. /65 is
                // the first step that clears it (5.28:1) on every light surface.
                <span
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] px-1.5 py-[1px] rounded-full border border-ink/15 text-ink/65"
                >
                  {product.nickname}
                </span>
              )}
            </div>
            {product.shortDescription && (
              <p
                // text-ink/65 — /60 landed at 4.49:1 on the spec plate, just
                // under the 4.5:1 AA line. /65 → 5.28:1.
                className={`mt-1.5 border-t border-ink/[0.07] pt-1.5 text-[10.5px] leading-relaxed text-ink/65 ${
                  detailed ? '' : 'line-clamp-4'
                }`}
              >
                {product.shortDescription}
              </p>
            )}
            {/* Detail layout: a compact spec sheet under the description —
                the data the grid tiles have no room for. */}
            {detailed && product.specs.length > 0 && (
              <dl className="mt-1.5 space-y-0.5 border-t border-ink/[0.07] pt-1.5">
                {product.specs.slice(0, 4).map((spec) => (
                  <div key={spec.label} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-ink/40">
                      {spec.label}
                    </dt>
                    <dd className="min-w-0 truncate text-right font-mono text-[11px] text-ink/65">
                      {spec.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </button>

      {/* Buy controls — outside the tap target, seated in their own footer
          plate so the dose chip, price, and Add button have a defined home
          instead of floating in the tile. Same inset as the identity plate. */}
      <div className="px-1.5 pb-1.5 pt-1 mt-auto">
       <div className="tile-spec-plate rounded-[var(--radius-field)] px-2.5 py-2">
        {variants.length > 0 && (() => {
          // 24-hour doses render as standalone chips in their own row.
          // Sourced doses (7–10 business day sourcing) are grouped into a
          // single bordered box: a segmented row of dose picks on top,
          // separated by a hairline footer that labels the whole group —
          // so the shipping window reads as belonging to every dose inside,
          // not a loose trailing label next to the chips.
          const interactive = variants.length > 1;
          const withState = variants.map((v, i) => ({
            v,
            i,
            state: doseAvailability(product.sku, v.dose).state,
          }));
          const fastDoses = withState.filter((o) => o.state === 'in_stock');
          const sourcedDoses = withState.filter((o) => o.state === 'sourced');

          return (
            <div className="flex flex-col gap-1.5">
              {fastDoses.length > 0 && (
                <div
                  role={interactive ? 'radiogroup' : undefined}
                  aria-label={interactive ? 'Select dose' : undefined}
                  className="flex flex-wrap items-center gap-1"
                  onClick={interactive ? (e) => e.stopPropagation() : undefined}
                >
                  {fastDoses.map(({ v, i }) => (
                    <DoseChip
                      key={v.dose}
                      sku={product.sku}
                      dose={v.dose}
                      compact
                      interactive={interactive}
                      isActive={i === tierIndex}
                      onClick={interactive ? (e) => { e.stopPropagation(); setTierIndex(i); } : undefined}
                    />
                  ))}
                </div>
              )}

              {sourcedDoses.length > 0 && (
                <div
                  className="rounded-[var(--radius-field)] border border-ink/15 overflow-hidden"
                  onClick={interactive ? (e) => e.stopPropagation() : undefined}
                >
                  <div
                    role={interactive ? 'radiogroup' : undefined}
                    aria-label={interactive ? 'Select sourced dose' : undefined}
                    className="flex items-stretch"
                  >
                    {sourcedDoses.map(({ v, i }, idx) => (
                      <SourcedDoseSegment
                        key={v.dose}
                        dose={v.dose}
                        isActive={i === tierIndex}
                        interactive={interactive}
                        hasDivider={idx > 0}
                        onClick={interactive ? (e) => { e.stopPropagation(); setTierIndex(i); } : undefined}
                      />
                    ))}
                  </div>
                  {/* Hover/tap the 7–10-day footer to reveal the slow-ship
                      promo (owner: no sticker on the tile — the promo lives
                      on this chip only). Checkout enforces it server-side. */}
                  <div className="border-t border-ink/12 py-1 text-center">
                    <Tooltip
                      content={b2g1TooltipContent(product.sku) ?? SOURCED_SHIP_PLAIN}
                      ariaId={`b2g1-${product.sku}`}
                    >
                      <span className="inline-flex cursor-help items-center justify-center gap-1 font-mono text-[10px] uppercase leading-none tracking-[0.16em] text-ink/45 underline decoration-dotted decoration-ink/30 underline-offset-2">
                        Standard Shipping
                        <ShippingVan />
                      </span>
                    </Tooltip>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        <div
          className={`flex items-center justify-between gap-2 ${
            variants.length > 0 ? 'mt-2 border-t border-ink/[0.07] pt-2' : ''
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-mono tabular-nums text-[13px] font-medium text-ink leading-none whitespace-nowrap">
              {formatPrice(priceCents)}
            </span>
            <MemberPrice baseCents={priceCents} eligible={isMemberPriceEligible(product)} />
          </span>

          <button
            type="button"
            onClick={handleAdd}
            aria-label={`Add ${product.name} ${activeDose} to inquiry`}
            className={[
              'tile-add-btn shrink-0 min-h-[44px] min-w-[48px] inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] font-normal leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 disabled:opacity-40 disabled:cursor-not-allowed',
              added ? 'is-added' : '',
            ].join(' ')}
          >
            {added ? '✓ Added' : 'Add'}
          </button>
        </div>
       </div>
      </div>
    </article>
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
