/**
 * Pricing — every figure traces to admin-entered data, never to a formula.
 *
 * This module used to derive a placeholder from the dose's mg magnitude
 * whenever no override had loaded. That made a transient Supabase failure
 * indistinguishable from a real price: an $87 blend rendered as $790, an
 * admin-set $60 compound as $470, on the live storefront, with nothing to
 * signal the number was invented. Absent data now yields null and callers
 * show no price, which is recoverable; a confident wrong price is not.
 */

import type { Product } from '../types/product';
import { variantPriceCents } from './productOverrides';

/**
 * The product's own catalog price. Real for single-config items that carry
 * one (lab equipment, consumables, the oral canister); null for anything
 * priced per dose, which resolves through {@link effectiveTierPriceCents}.
 */
export function catalogPriceCents(product: Product): number | null {
  return product.priceCents ?? null;
}

/**
 * Effective price for a dose: the admin override (per-dose, else per-sku, set
 * via the bulk import) wins, else the product's own catalog price, else null.
 *
 * Null means "we do not know this price" — render it as unknown and refuse to
 * sell at it. It must never be papered over with a derived stand-in.
 */
export function effectiveTierPriceCents(product: Product, dose: string): number | null {
  return variantPriceCents(product.sku, dose) ?? catalogPriceCents(product);
}

/** Format cents as a whole-dollar string, e.g. 10500 → "$105". */
export function formatPrice(cents: number | null): string {
  if (cents == null) return '—';
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

/**
 * Format cents with exact dollars and cents, e.g. 7395 → "$73.95", 7300 → "$73".
 * Used where the amount isn't a whole dollar (e.g. a 15%-off member price) so the
 * displayed figure equals the cents the buyer is actually charged, never rounded.
 */
export function formatPriceExact(cents: number | null): string {
  if (cents == null) return '—';
  const whole = cents / 100;
  const hasCents = cents % 100 !== 0;
  return (
    '$' +
    whole.toLocaleString('en-US', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}
