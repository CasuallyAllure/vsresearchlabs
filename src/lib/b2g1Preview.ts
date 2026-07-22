/**
 * b2g1Preview — client-side mirror of the automatic B2G1 (buy-2-get-1-free)
 * promo, for CART PREVIEW ONLY. place-order re-resolves everything here
 * authoritatively; nothing computed in this module is ever billed.
 *
 * Mirrors supabase/functions/place-order/promoPlan.ts buildPromoPlans() close
 * enough to preview what will actually be charged:
 *   - a line qualifies only when it resolves to a KNOWN (sku, dose) variant
 *     carrying an admin-set price (product_variant_stock.price_cents via
 *     productOverrides.variantPriceCents) — a dose with no tracked row, or no
 *     admin price, has no server truth to discount from and shows nothing.
 *   - the dose must have NO 24-hour supply (doseAvailability === 'sourced'),
 *     matching the server's isSlow test.
 *   - the promo must be live for the sku (usePromoSettings.isB2G1Active).
 *   - a line at pack quantity (>= the wholesale half-kit floor) competes with
 *     B2G1 on VALUE, exactly like buildPromoPlans' per-line arbitration —
 *     whichever is worth more to THIS buyer wins the line. A wholesale WIN
 *     ANYWHERE in the cart is a FINAL PRICE order-wide (place-order's
 *     hasWholesale gate): it suppresses B2G1 on every other line too, even
 *     lines that didn't themselves reach pack quantity.
 *
 * One approximation, flagged rather than guessed around: the server's
 * wholesale eligibility also requires product_variant_stock.wholesale_eligible
 * (migration 063) — a DB flag never fetched client-side. This mirrors the
 * same approximation src/lib/wholesale.ts already uses for the catalog's own
 * pack tiles: "resolves to a known, priced variant" stands in for the flag.
 * In practice every tracked compound dose is wholesale-eligible (only lab
 * equipment/supplies are excluded, and those never resolve to a known variant
 * here either, so they're excluded the same way). Caller must still gate this
 * against the bundle promo (a separate final price — see bundle.ts) since
 * that suppression lives at the call site, not in this module.
 *
 * NEVER over-promises: any line whose eligibility can't be confidently
 * determined client-side (no admin price loaded, unknown/untracked variant)
 * shows nothing here, matching offerFor()'s `return null` fallbacks.
 */

import type { Product } from '../types';
import { deriveProductDose } from '../types';
import { doseAvailability, variantPriceCents } from './productOverrides';
import { isB2G1Active } from './promoSettings';
import { WHOLESALE_PACKS } from './wholesale';

/** Buy-2-get-1: one free unit per group of 3. Keep in sync with B2G1_GROUP in
 *  supabase/functions/place-order/promoPlan.ts. */
export const B2G1_GROUP = 3;

const WHOLESALE_CASE = WHOLESALE_PACKS.find((p) => p.key === 'case')!;
const WHOLESALE_HALF = WHOLESALE_PACKS.find((p) => p.key === 'half')!;
/** Smallest wholesale pack size — the same floor src/lib/cartActions.ts uses
 *  to decide a line is bought as a case. */
const WHOLESALE_MIN_PACK = Math.min(...WHOLESALE_PACKS.map((p) => p.size));

/** Wholesale pack value for `qty` units at `unit` cents — full cases first,
 *  then at most one half kit from the remainder. Mirrors
 *  promoPlan.wholesalePackValue()'s `value` output exactly. */
function wholesalePackValueCents(qty: number, unit: number): number {
  const cases = Math.floor(qty / WHOLESALE_CASE.size);
  const rem = qty - cases * WHOLESALE_CASE.size;
  const halfKits = rem >= WHOLESALE_HALF.size ? 1 : 0;
  return (
    cases * Math.round((WHOLESALE_CASE.size * unit * WHOLESALE_CASE.percent) / 100) +
    halfKits * Math.round((WHOLESALE_HALF.size * unit * WHOLESALE_HALF.percent) / 100)
  );
}

export interface B2G1PreviewLine {
  /** Index into the items array passed to computeB2G1Preview. */
  idx: number;
  freeUnits: number;
  valueCents: number;
}

export interface B2G1CartPreview {
  /** Lines that win B2G1 over wholesale, in input order. Empty when the
   *  promo isn't live, no line qualifies, or a wholesale line elsewhere
   *  suppressed the whole order (see suppressedByWholesale). */
  lines: B2G1PreviewLine[];
  /** Sum of all lines' valueCents. */
  totalCents: number;
  /** True when at least one cart line wins wholesale pack pricing over
   *  B2G1 — a final price that suppresses B2G1 for the WHOLE order, mirroring
   *  place-order's hasWholesale gate. Callers should also suppress the
   *  account-discount preview when this is true, same as the server. */
  suppressedByWholesale: boolean;
}

/**
 * Compute the B2G1 preview for a cart. Does NOT know about the bundle promo —
 * callers must additionally skip/zero this when a bundle applies (bundle.ts),
 * exactly as place-order checks wholesale before bundle before B2G1.
 */
export function computeB2G1Preview(
  items: ReadonlyArray<{ product: Product; quantity: number }>,
  isMember: boolean,
): B2G1CartPreview {
  let suppressedByWholesale = false;
  const candidates: B2G1PreviewLine[] = [];

  items.forEach((item, idx) => {
    const sku = item.product.sku;
    const qty = item.quantity;
    if (!sku || qty < B2G1_GROUP) return;

    const dose = deriveProductDose(item.product);
    const avail = doseAvailability(sku, dose);
    if (avail.state === 'unknown') return; // no server row to promo off

    const unit = variantPriceCents(sku, dose);
    if (unit == null || unit <= 0) return; // no admin price — no server truth

    // B2G1 value — slow-ship (sourced) only, promo live for this sku.
    const isSlow = avail.state === 'sourced';
    const b2g1Value = isSlow && isB2G1Active(sku) ? Math.floor(qty / B2G1_GROUP) * unit : 0;

    // Wholesale value — account-gated, pack-quantity gated. Ship speed does
    // NOT gate it (a case is sourced whole regardless of the dose's retail
    // stock), matching wholesale.ts / promoPlan.ts.
    const packValue = isMember && qty >= WHOLESALE_MIN_PACK
      ? wholesalePackValueCents(qty, unit)
      : 0;

    if (packValue > 0 && packValue >= b2g1Value) {
      suppressedByWholesale = true;
      return;
    }
    if (b2g1Value > 0) {
      candidates.push({ idx, freeUnits: Math.floor(qty / B2G1_GROUP), valueCents: b2g1Value });
    }
  });

  if (suppressedByWholesale) {
    return { lines: [], totalCents: 0, suppressedByWholesale: true };
  }
  return {
    lines: candidates,
    totalCents: candidates.reduce((sum, l) => sum + l.valueCents, 0),
    suppressedByWholesale: false,
  };
}

/**
 * Per-line nudge for a slow-ship, B2G1-eligible line sitting at qty 1 or 2:
 * "Add {n} more — third unit free". Returns null when the line doesn't
 * qualify (fast ship, untracked/unpriced variant, excluded sku, promo not
 * live, or qty already at/above the B2G1 group size).
 *
 * Callers should additionally hide this whenever a final-price order
 * (bundle or wholesale, via computeB2G1Preview's suppressedByWholesale) has
 * suppressed B2G1 entirely — this helper only knows about ONE line, not the
 * cart's overall precedence.
 */
export function b2g1NudgeCaption(item: { product: Product; quantity: number }): string | null {
  const sku = item.product.sku;
  const qty = item.quantity;
  if (!sku || qty < 1 || qty >= B2G1_GROUP) return null;
  if (!isB2G1Active(sku)) return null;

  const dose = deriveProductDose(item.product);
  if (doseAvailability(sku, dose).state !== 'sourced') return null;

  const unit = variantPriceCents(sku, dose);
  if (unit == null || unit <= 0) return null;

  return `Add ${B2G1_GROUP - qty} more — third unit free`;
}
