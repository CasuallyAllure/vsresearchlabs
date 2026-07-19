/**
 * NewlyCatalogedSpotlight — the "recently added to the catalog" module that
 * sits beside BundleOfferTile at the top of the biopeptide catalog.
 *
 * AVAILABILITY IS READ, NEVER ASSERTED. Every dispatch-tier statement on this
 * module comes from the SAME runtime source the rest of the catalog reads:
 * the Supabase per-dose override store (`lib/productOverrides`). The chip is
 * rendered by the shared <AvailabilityBadge>, which resolves
 * `doseAvailability(sku, dose)`:
 *
 *   in_stock (on_hand / inbound > 0) → "24 Hour Shipping"
 *   sourced  (tracked, no 24h supply) → "Standard Shipping"
 *   unknown  (no per-dose row)        → nothing at all
 *
 * So a compound with no supply data renders with NO dispatch claim rather
 * than a fabricated one, and the whole module renders nothing until the
 * overrides have loaded cleanly (a failed load would otherwise read as
 * "everything is sourced", which is itself a claim we can't support).
 *
 * Tapping a row opens the shared CompoundIntelligenceOverlay via `onInspect`
 * — the page owns that state. There is deliberately no add-to-cart affordance
 * here: adding requires `variantProduct(product, dose)` and the dose picker
 * belongs to the tile/overlay, so the safe path is to let the user add from
 * the overlay.
 */

import type { Product } from '../../types';
import { useProductOverrides, isSkuVisible, isVariantPublic } from '../../lib/productOverrides';
import { AvailabilityBadge } from './AvailabilityBadge';

/** Slugs of the compounds most recently added to the biopeptide catalog. */
const FEATURED_SLUGS = ['glow-blend-ghk', 'glow-blend-cu', 'klow-blend'] as const;

interface NewlyCatalogedSpotlightProps {
  products: Product[];
  onInspect: (id: string) => void;
  /** Layout classes from the parent (width / snap / flex). */
  className?: string;
}

interface FeaturedEntry {
  product: Product;
  dose: string;
}

export function NewlyCatalogedSpotlight({
  products,
  onInspect,
  className = '',
}: NewlyCatalogedSpotlightProps) {
  // Subscribe so an admin stock/visibility edit re-renders the dispatch chips
  // live, exactly as CompoundTile and BundleOfferTile do.
  useProductOverrides((s) => s.bySku);
  useProductOverrides((s) => s.variantBySku);
  const overridesLoaded = useProductOverrides((s) => s.loaded);
  const overridesError = useProductOverrides((s) => s.error);

  // No clean inventory read → no module. Everything below states a dispatch
  // tier, and a half-loaded store would state it wrongly.
  if (!overridesLoaded || overridesError) return null;

  const entries: FeaturedEntry[] = [];
  for (const slug of FEATURED_SLUGS) {
    const product = products.find((p) => p.slug === slug);
    if (!product) continue;
    if (!isSkuVisible(product.sku)) continue;
    const dose = product.variants?.[0]?.dose;
    if (!dose) continue;
    // A dose the catalog itself would hide never gets spotlighted.
    if (!isVariantPublic(product.sku, dose)) continue;
    entries.push({ product, dose });
  }

  if (entries.length === 0) return null;

  return (
    <section
      aria-label="Newly cataloged compounds"
      className={`floating-module overflow-hidden ${className}`}
    >
      <div className="p-[var(--space-4)] sm:p-[var(--space-5)]">
        <h2 className="text-[10.5px] uppercase tracking-[0.24em] text-ink/45">Newly cataloged</h2>

        <p className="mt-2 max-w-[48ch] text-[12px] leading-snug text-ink/70">
          Recently added to the biopeptide catalog. Dispatch tier is stated per compound.
        </p>

        <ul className="mt-2 divide-y divide-ink/[0.05]">
          {entries.map(({ product, dose }) => (
            <li key={product.id}>
              <SpotlightRow product={product} dose={dose} onInspect={onInspect} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Splits "GLOW Blend (TB-500 · BPC-157 · GHK)" into a short title and its
 * constituent list, so a long blend name wraps as two calm lines instead of
 * one truncated run.
 */
function splitCompoundName(name: string): { title: string; detail: string | null } {
  const match = name.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!match) return { title: name, detail: null };
  return { title: match[1].trim(), detail: match[2].trim() };
}

interface SpotlightRowProps {
  product: Product;
  dose: string;
  onInspect: (id: string) => void;
}

function SpotlightRow({ product, dose, onInspect }: SpotlightRowProps) {
  const { title, detail } = splitCompoundName(product.name);
  const image = product.images?.[0] ?? null;

  return (
    <button
      type="button"
      onClick={() => onInspect(product.id)}
      aria-label={`Inspect ${product.name}`}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-[var(--radius-field)] py-2.5 text-left transition-colors hover:bg-ink/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25"
    >
      <span className="tile-spec-plate flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-procurement)]">
        {image ? (
          <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span aria-hidden="true" className="font-mono text-[10px] text-ink/25">
            {product.abbreviation ?? '—'}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-snug text-ink/85" title={product.name}>
          {title}
        </span>
        {detail && (
          <span className="mt-0.5 block truncate font-mono text-[10px] text-ink/45" title={detail}>
            {detail}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] tabular-nums text-ink/50">{dose}</span>
          <AvailabilityBadge sku={product.sku} dose={dose} />
        </span>
      </span>
    </button>
  );
}
