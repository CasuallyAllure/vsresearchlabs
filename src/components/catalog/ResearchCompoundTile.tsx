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
 *
 * Density (shared CatalogDensity vocabulary with the store catalog):
 *   detail  — the presentation above, full description.
 *   grid    — the same card, tightened: 2-line description, less padding.
 *   dense   — a catalog index LINE: name · abbreviation · system ·
 *             classification. No card, no artwork bay, no description.
 * Every density still carries the compound's research domain, and none of
 * them carries a commerce control.
 */

import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isVariantPublic } from '../../lib/productOverrides';
import { CLASSIFICATION_LABELS } from '../../lib/compoundIntelligence';
import { researchDomainFor, RESEARCH_DOMAIN_SHORT_LABELS } from '../../lib/researchDomain';
import type { CatalogDensity } from './ClassificationFilter';

interface ResearchCompoundTileProps {
  product: Product;
  /** Tap anywhere on the tile to open the intelligence overlay. */
  onInspect?: (id: string) => void;
  /** Layout density from the library's layout picker (default: detail). */
  density?: CatalogDensity;
}

/** The compound's biological system, rendered as a quiet monochrome pill. */
function DomainChip({ product, title }: { product: Product; title?: boolean }) {
  const domain = researchDomainFor(product.researchClassification);
  return (
    <span
      data-testid="research-domain-chip"
      title={title ? 'Biological system studied' : undefined}
      className="inline-flex shrink-0 items-center rounded-full border border-ink/15 bg-ink/[0.04] px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] text-ink/55"
    >
      {RESEARCH_DOMAIN_SHORT_LABELS[domain]}
    </span>
  );
}

export function ResearchCompoundTile({ product, onInspect, density = 'detail' }: ResearchCompoundTileProps) {
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

  const classificationLabel = product.researchClassification
    ? CLASSIFICATION_LABELS[product.researchClassification] ?? product.researchClassification
    : null;

  // ── Dense: a catalog index line, not a shrunken card ──
  if (density === 'compact') {
    return (
      <button
        type="button"
        data-testid="research-tile-compact"
        onClick={() => onInspect?.(product.id)}
        aria-label={`Read the intelligence dossier for ${product.name}`}
        className="floating-module is-interactive group flex min-h-[44px] w-full items-center gap-3 px-3.5 py-2.5 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] leading-snug text-ink">
          {product.name}
        </span>
        <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40 sm:inline">
          {product.abbreviation}
        </span>
        <DomainChip product={product} title />
        {classificationLabel && (
          <span className="hidden max-w-[22ch] shrink-0 truncate text-[11px] text-ink/40 lg:inline">
            {classificationLabel}
          </span>
        )}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className="shrink-0 text-ink/30 transition-colors group-hover:text-ink/60"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    );
  }

  const tightened = density === 'standard';

  return (
    <button
      type="button"
      data-testid={tightened ? 'research-tile-standard' : 'research-tile-detail'}
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
      <div className={`flex flex-1 flex-col pt-1 ${tightened ? 'px-3 pb-1.5' : 'px-3.5 pb-2'}`}>
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
        <h3 className={`truncate font-normal leading-snug text-ink ${tightened ? 'text-[13px]' : 'text-[14px]'}`}>
          {product.name}
        </h3>
        {/* Which biological system the compound is studied in. */}
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <DomainChip product={product} title />
          {!tightened && classificationLabel && (
            <span className="min-w-0 truncate text-[11px] text-ink/40">{classificationLabel}</span>
          )}
        </div>
        {product.shortDescription && (
          <p className={`mt-1.5 text-[12px] leading-relaxed text-ink/55 ${tightened ? 'line-clamp-2' : 'line-clamp-3'}`}>
            {product.shortDescription}
          </p>
        )}
      </div>

      {/* Quiet informational footer — price + open affordance. No cart. */}
      <div className={`mt-auto flex items-center justify-between gap-2 border-t border-ink/[0.05] pt-2 ${tightened ? 'px-3 pb-2.5' : 'px-3.5 pb-3'}`}>
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
