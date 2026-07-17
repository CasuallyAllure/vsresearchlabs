/**
 * bundle — the standing "Retatrutide + GHK-Cu" offer: 20% off every complete
 * pair, applied automatically at checkout.
 *
 * Client-side this module only powers DISPLAY (the catalog bundle tile and the
 * cart's discount preview). The actual money is computed in place-order, which
 * independently detects the pair and materializes the reduction as a synthetic
 * order_coupons row (code BUNDLE, kind 'fixed', source 'promo') — the client
 * never sends a discounted price, so the price-mismatch check stays honest.
 * Keep BUNDLE_PROMO in sync with BUNDLE_PROMO in place-order/index.ts.
 *
 * Owner rules (2026-07-16):
 *   • Any dose of each qualifies — the discount is a percentage, so it scales.
 *   • Every complete pair counts (3 Reta + 3 GHK = three bundles).
 *   • FINAL price — nothing stacks: codes are rejected, and the account
 *     discount / reward voucher / B2G1 are suppressed. Wholesale outranks it.
 *   • The discount is taken on the buyer's HIGHEST-priced qualifying units.
 */

export interface BundlePromo {
  code: string;
  label: string;
  /** Retatrutide. */
  skuA: string;
  /** GHK-Cu. */
  skuB: string;
  percent: number;
}

export const BUNDLE_PROMO: BundlePromo = {
  code: 'BUNDLE',
  label: 'Retatrutide + GHK-Cu bundle',
  skuA: 'VSR-RS-RTT-005',
  skuB: 'VSR-RS-GHK',
  percent: 20,
};

/** The doses the offer is merchandised with — the pair actually on the shelf
 *  (Retatrutide 10mg · GHK-Cu 100mg as of 2026-07-16). The DISCOUNT accepts any
 *  dose; these only drive what the bundle tile shows and adds to the cart. */
export const BUNDLE_FEATURED = {
  doseA: '10mg',
  doseB: '100mg',
} as const;

export interface BundleLine {
  sku?: string;
  unitCents: number;
  quantity: number;
}

export interface BundleResult {
  /** Complete pairs found (0 = the offer doesn't apply). */
  pairs: number;
  /** Cents off — 20% of the paired units' value. */
  discountCents: number;
}

/** Qualifying units for a sku, grouped by unit price, dearest first. */
function groupsFor(lines: BundleLine[], sku: string) {
  return lines
    .filter((l) => l.sku === sku && l.unitCents > 0 && l.quantity > 0)
    .map((l) => ({ unit: l.unitCents, qty: l.quantity }))
    .sort((a, b) => b.unit - a.unit);
}

/** Value of the top `n` units across the (dearest-first) groups. */
function topValue(groups: { unit: number; qty: number }[], n: number): number {
  let need = n;
  let val = 0;
  for (const g of groups) {
    if (need <= 0) break;
    const take = Math.min(need, g.qty);
    val += take * g.unit;
    need -= take;
  }
  return val;
}

/**
 * The bundle discount for a cart. Mirrors place-order exactly — pairs are
 * capped by the lesser of the two SKUs' total quantities, and the discount is
 * taken on the highest-priced qualifying units of each.
 */
export function bundleDiscount(lines: BundleLine[]): BundleResult {
  const aGroups = groupsFor(lines, BUNDLE_PROMO.skuA);
  const bGroups = groupsFor(lines, BUNDLE_PROMO.skuB);
  const totalQty = (gs: { qty: number }[]) => gs.reduce((s, g) => s + g.qty, 0);
  const pairs = Math.min(totalQty(aGroups), totalQty(bGroups));
  if (pairs <= 0) return { pairs: 0, discountCents: 0 };
  const pairedValue = topValue(aGroups, pairs) + topValue(bGroups, pairs);
  return {
    pairs,
    discountCents: Math.round((pairedValue * BUNDLE_PROMO.percent) / 100),
  };
}
