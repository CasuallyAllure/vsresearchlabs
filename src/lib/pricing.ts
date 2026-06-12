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

/** Format cents as a whole-dollar string, e.g. 10500 → "$105". */
export function formatPrice(cents: number | null): string {
  if (cents == null) return '—';
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}
