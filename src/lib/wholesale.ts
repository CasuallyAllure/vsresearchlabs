/**
 * wholesale — the standing wholesale/business offer, sold in two pack sizes
 * of the same compound + dose:
 *
 *   • Full case — 10 vials, 40% off
 *   • Half kit  —  5 vials, 27% off
 *
 * Client-side this module only powers DISPLAY (catalog tiles, eligibility
 * filters) and the add-to-cart quantity. The actual money is computed in
 * place-order, which independently detects slow-ship lines with pack-size
 * quantities and materializes the reduction as a synthetic order_coupons row
 * (code WHOLESALE, source 'promo') — the client never sends a discounted
 * price, so the price-mismatch check stays honest. Keep WHOLESALE_PACKS in
 * sync with WHOLESALE_CASE / WHOLESALE_HALF in place-order/index.ts.
 *
 * Eligibility mirrors the owner's rule: EVERY publicly-priced dose is
 * sellable by the case, including doses that ship in 24 hours at retail.
 * Wholesale sources the whole case, so ALL pack orders ship 7–10 business
 * days regardless of a dose's retail stock status — the tiles never badge a
 * wholesale dose "24 HR".
 */

import type { Product } from '../types';
import { doseAvailability, isVariantPublic } from './productOverrides';
import { effectiveTierPriceCents } from './pricing';

export interface WholesalePack {
  key: 'case' | 'half';
  /** Vials per pack. */
  size: number;
  /** Percent off the pack's regular value. */
  percent: number;
  label: string;
  /** Short noun for buttons/notes ("case", "kit"). */
  noun: string;
}

export const WHOLESALE_PACKS: WholesalePack[] = [
  { key: 'case', size: 10, percent: 40, label: 'Full case', noun: 'case' },
  { key: 'half', size: 5, percent: 27, label: 'Half kit', noun: 'kit' },
];

export const WHOLESALE_TOOLTIP =
  'For years we supplied laboratories strictly business-to-business — that program ' +
  'is now open to every industry. The same compounds, at wholesale: a full case ' +
  '(10 vials) at 40% off — a $60 vial comes to $36 — or a half kit (5 vials) at 27% off, ' +
  'applied automatically at checkout for account holders. Wholesale orders ship ' +
  'standard, 7–10 business days.';

/** Doses this product can sell wholesale: every publicly-priced, real variant
 *  dose with a usable per-vial price — 24-hour in-stock and 7–10-day sourced
 *  alike (untracked non-variant doses AND priceless doses are excluded; a case
 *  can't be sold at $0). Ship speed does NOT gate eligibility; wholesale sources
 *  the whole case at 7–10 business days regardless. */
export function wholesaleDoses(product: Product): string[] {
  return (product.variants ?? [])
    .map((v) => v.dose)
    .filter(
      (dose) =>
        isVariantPublic(product.sku, dose) &&
        doseAvailability(product.sku, dose).state !== 'unknown' &&
        (effectiveTierPriceCents(product, dose) ?? 0) > 0,
    );
}

/** True when the product has at least one pack-sellable dose. */
export function isWholesaleEligible(product: Product): boolean {
  return wholesaleDoses(product).length > 0;
}

export interface WholesalePackPricing {
  /** Admin-set single-vial price (the mandatory effective price path). */
  unitCents: number;
  /** size × unit — the undiscounted pack value. */
  regularCents: number;
  /** The percent taken off at checkout. */
  discountCents: number;
  /** What the buyer actually pays for the pack. */
  packCents: number;
  /** What each vial effectively costs at pack pricing — the number a
   *  business buyer compares against the single-vial price. */
  perVialCents: number;
}

/** Per-vial money formatter — the shared formatPrice rounds to whole dollars
 *  (catalog convention), but a pack price ÷ vials can land on cents and
 *  rounding them away would misstate the deal ($62.40 ≠ $62). Whole-dollar
 *  values stay clean ("$62"), fractional ones keep both digits ("$62.40"). */
export function formatPerVial(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? '$' + dollars.toLocaleString('en-US')
    : '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Pack pricing for one (product, dose, pack), or null when the dose has no
 *  admin-set price (never show a $0 pack). */
export function wholesalePackPricing(
  product: Product,
  dose: string,
  pack: WholesalePack,
): WholesalePackPricing | null {
  const unitCents = effectiveTierPriceCents(product, dose);
  if (unitCents == null || unitCents <= 0) return null;
  const regularCents = unitCents * pack.size;
  const discountCents = Math.round((regularCents * pack.percent) / 100);
  const packCents = regularCents - discountCents;
  return {
    unitCents,
    regularCents,
    discountCents,
    packCents,
    perVialCents: Math.round(packCents / pack.size),
  };
}
