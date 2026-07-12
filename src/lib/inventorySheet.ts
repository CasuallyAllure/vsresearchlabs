/**
 * inventorySheet — shared spec for the "one row per SKU×dose" inventory
 * sheet used by both AdminImport (blank price_usd, for editing) and
 * AdminInventory (price_usd pre-filled with the live price, for export).
 *
 * Single source of truth for the columns + row-building logic so the two
 * pages can never drift out of round-trip sync with each other.
 */

import type { Product } from '../types/product';
import { tierPriceCents } from './pricing';
import type { Column } from './exporters';

/** One row of the sheet (current live values pre-filled).
 *  The sheet is one row per dose; product-level fields (hidden, clip) repeat. */
export interface TemplateRow {
  sku: string;
  name: string;
  klass: string;
  dose: string;
  current_price: number | null; // reference only — ignored on import
  cost_usd: number | null;      // admin-only COGS (never public)
  on_hand: number | null;
  price_usd: number | null;
  lead_days: number | null;     // blank = local stock; N = order-on-demand (ships in N days)
  hidden: string;
  reorder_at: number | null;
  video_url: string;
  video_title: string;
  video_description: string;
  video_thumbnail: string;
}

/** Per-sku override row (product_stock) — product-level fields. */
export interface StockLike {
  on_hand: number;
  reorder_at: number | null;
  hidden: boolean;
  price_cents_override: number | null;
  video_url: string | null;
  video_title: string | null;
  video_description: string | null;
  video_thumbnail: string | null;
}

/** Per-dose override row (product_variant_stock) — price + stock per strength. */
export interface VariantLike {
  on_hand: number;
  reorder_at: number | null;
  price_cents: number | null;
  cost_cents: number | null;
  lead_days: number | null;
}

// ── Sheet columns (headers are the exact import keys → clean round-trip) ──────

export const INVENTORY_COLUMNS: Column<TemplateRow>[] = [
  { header: 'sku', value: (r) => r.sku },
  { header: 'name', value: (r) => r.name },
  { header: 'class', value: (r) => r.klass },
  { header: 'dose', value: (r) => r.dose },
  { header: 'current_price', value: (r) => r.current_price, type: 'currency' },
  { header: 'cost_usd', value: (r) => r.cost_usd, type: 'currency' },
  { header: 'on_hand', value: (r) => r.on_hand, type: 'number' },
  { header: 'price_usd', value: (r) => r.price_usd, type: 'currency' },
  { header: 'lead_days', value: (r) => r.lead_days, type: 'number' },
  { header: 'hidden', value: (r) => r.hidden },
  { header: 'reorder_at', value: (r) => r.reorder_at, type: 'number' },
  { header: 'video_url', value: (r) => r.video_url },
  { header: 'video_title', value: (r) => r.video_title },
  { header: 'video_description', value: (r) => r.video_description },
  { header: 'video_thumbnail', value: (r) => r.video_thumbnail },
];

interface BuildInventoryRowsParams {
  products: Product[];
  stockBySku: Record<string, StockLike>;
  variantBySku: Record<string, Record<string, VariantLike>>;
  /** true → pre-fill price_usd with the current live price (export);
   *  false → leave price_usd blank so only edited cells are applied (import). */
  fillPrice: boolean;
}

/** Build the sheet rows: one row per dose, pre-filled with live values.
 *  current_price is the price the storefront shows today (override or formula)
 *  for reference; price_usd is either blank (import template) or the same
 *  current price (export sheet), depending on `fillPrice`. */
export function buildInventoryRows(params: BuildInventoryRowsParams): TemplateRow[] {
  const { products, stockBySku, variantBySku, fillPrice } = params;
  const rows: TemplateRow[] = [];
  const sorted = [...products].filter((p) => p.sku).sort((a, b) => a.sku.localeCompare(b.sku));
  for (const p of sorted) {
    const s = stockBySku[p.sku];
    const klass =
      (p as { family?: string; researchClassification?: string }).family ??
      (p as { researchClassification?: string }).researchClassification ??
      p.category ?? '';
    const variants = Array.isArray(p.variants) && p.variants.length > 0
      ? p.variants
      : [{ dose: '' }];
    let first = true;
    for (const variant of variants) {
      const dose = variant.dose ?? '';
      const v = dose ? variantBySku[p.sku]?.[dose] : undefined;
      const storedCents = v?.price_cents ?? (dose ? null : s?.price_cents_override ?? null);
      const formula = dose ? tierPriceCents(p, dose) : (p.priceCents ?? null);
      const currentPrice = storedCents != null ? storedCents / 100 : (formula != null ? formula / 100 : null);
      rows.push({
        sku: p.sku,
        name: p.name,
        klass,
        dose,
        current_price: currentPrice,
        cost_usd: v && v.cost_cents != null ? v.cost_cents / 100 : null,
        on_hand: v ? v.on_hand : (dose ? null : s?.on_hand ?? null),
        price_usd: fillPrice ? currentPrice : null,
        lead_days: v && v.lead_days != null ? v.lead_days : null,
        // hidden / clip are product-level — surface them on the first dose row only.
        hidden: first && s && s.hidden ? 'true' : '',
        reorder_at: v && v.reorder_at != null ? v.reorder_at : (first && s && s.reorder_at != null ? s.reorder_at : null),
        video_url: first ? (s?.video_url ?? '') : '',
        video_title: first ? (s?.video_title ?? '') : '',
        video_description: first ? (s?.video_description ?? '') : '',
        video_thumbnail: first ? (s?.video_thumbnail ?? '') : '',
      });
      first = false;
    }
  }
  return rows;
}
