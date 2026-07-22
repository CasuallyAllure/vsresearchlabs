/**
 * Pricing — placeholder source of truth.
 *
 * Real per-tier pricing is not wired in yet. Until it is, a tier's price
 * is derived from its mg magnitude so the tiers show a clear, sensible
 * differential (more mg → higher price), with a small per-compound
 * variation in the per-mg rate so compounds aren't all identical. Swap
 * `tierPriceCents` for a real price lookup when the catalog carries
 * per-variant prices — every caller updates automatically.
 */

import type { Product } from '../types/product';
import { variantPriceCents } from './productOverrides';

function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Placeholder price in cents for a given dose tier (e.g. "10mg").
 * Returns the product's own `priceCents` (or null) when the dose has no
 * mg magnitude, e.g. "30 mL".
 */
export function tierPriceCents(product: Product, dose: string): number | null {
  const m = /([\d.]+)\s*mg/i.exec(dose);
  if (!m) return product.priceCents ?? null;
  const mg = parseFloat(m[1]);
  if (!Number.isFinite(mg) || mg <= 0) return product.priceCents ?? null;
  const perMg = 7 + (hashKey(product.id) % 6); // $7–$12 / mg, stable per compound
  const base = 20;
  return Math.round(base + mg * perMg) * 100;
}

/**
 * Effective price for a dose: an admin override (set per-dose, or per-sku, via
 * the bulk import) wins; otherwise the placeholder formula above. This is what
 * the catalog should display so a price edited in the master sheet shows live.
 */
export function effectiveTierPriceCents(product: Product, dose: string): number | null {
  const override = variantPriceCents(product.sku, dose);
  if (override != null) return override;
  return tierPriceCents(product, dose);
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
