/**
 * productOverrides — runtime SKU-level overrides from Supabase.
 *
 * Until products move to Postgres entirely, the catalog content lives in
 * `products.json` + `biopeptideManifest.json` (static) and the admin's
 * mutable layer lives in the `product_stock` table (Postgres). The fields
 * we honor at runtime:
 *
 *   • on_hand                — replaces the deterministic placeholder
 *   • hidden                 — true → skip from public catalog
 *   • price_cents_override   — non-null → replaces lib/pricing
 *   • deleted_at             — non-null → skip from public catalog
 *
 * Read via the `public_product_overrides` view (defined in migration 005)
 * which is grantable to anon. On app boot we fetch the whole table once
 * and cache it in a small Zustand store. Re-fetch on demand (e.g. after
 * an admin mutation completes).
 *
 * If Supabase is not configured, every helper falls back to "no override"
 * — i.e. the static catalog state wins, so dev still works offline.
 */

import { create } from 'zustand';
import { supabase } from './supabase';

export interface ProductOverride {
  sku: string;
  on_hand: number;
  hidden: boolean;
  price_cents_override: number | null;
  deleted_at: string | null;
  video_url: string | null;
  video_title: string | null;
  video_description: string | null;
  video_thumbnail: string | null;
}

/** Per-dose override (migration 011/013/018). price_cents null → lib/pricing.
 *  Three independent stock sources combine into "is this purchasable":
 *    on_hand        — physical shelf stock (24h ship)
 *    inbound_units  — in-transit, already paid for (count as inventory)
 *    lead_days      — drop-ship warehouse SLA (admin-only display) */
export interface VariantOverride {
  sku: string;
  dose: string;
  on_hand: number;
  inbound_units: number;
  price_cents: number | null;
  lead_days: number | null;
}

interface OverridesState {
  bySku: Record<string, ProductOverride>;
  /** sku → dose → variant override */
  variantBySku: Record<string, Record<string, VariantOverride>>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  getOverride: (sku: string) => ProductOverride | null;
}

export const useProductOverrides = create<OverridesState>((set, get) => ({
  bySku: {},
  variantBySku: {},
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loaded || get().loading) return;
    await get().reload();
  },

  reload: async () => {
    if (!supabase) {
      set({ loaded: true, loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    // Prefer the full select (with the cited-clip fields from migration 007).
    // If those columns aren't live yet, fall back to the base columns so the
    // catalog never breaks on a deploy that lands before the migration.
    const FULL = 'sku, on_hand, hidden, price_cents_override, deleted_at, video_url, video_title, video_description, video_thumbnail';
    const BASE = 'sku, on_hand, hidden, price_cents_override, deleted_at';
    let { data, error } = await supabase.from('public_product_overrides').select(FULL);
    if (error) {
      ({ data, error } = await supabase.from('public_product_overrides').select(BASE));
    }
    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    const next: Record<string, ProductOverride> = {};
    for (const row of (data ?? []) as Partial<ProductOverride>[]) {
      next[row.sku as string] = {
        video_url: null,
        video_title: null,
        video_description: null,
        video_thumbnail: null,
        ...row,
      } as ProductOverride;
    }

    // Per-dose overrides (migration 011). Optional — if the view isn't live yet
    // (deploy landed before the migration), the catalog still works on formula
    // pricing and per-sku stock.
    const variantBySku: Record<string, Record<string, VariantOverride>> = {};
    // Migration 018 added inbound_units. Try the full select first; if the
    // column isn't live yet (older DB) fall back to the pre-018 shape so
    // catalog rendering still works during a partial deploy.
    let vData: Partial<VariantOverride>[] | null = null;
    const { data: vFull, error: vFullErr } = await supabase
      .from('public_variant_overrides')
      .select('sku, dose, on_hand, inbound_units, price_cents, lead_days');
    if (!vFullErr) {
      vData = vFull as Partial<VariantOverride>[];
    } else {
      const { data: vBase } = await supabase
        .from('public_variant_overrides')
        .select('sku, dose, on_hand, price_cents, lead_days');
      vData = vBase as Partial<VariantOverride>[];
    }
    for (const row of (vData ?? [])) {
      if (!row.sku || !row.dose) continue;
      (variantBySku[row.sku] ??= {})[row.dose] = {
        sku: row.sku,
        dose: row.dose,
        on_hand: row.on_hand ?? 0,
        inbound_units: row.inbound_units ?? 0,
        price_cents: row.price_cents ?? null,
        lead_days: row.lead_days ?? null,
      };
    }

    set({ bySku: next, variantBySku, loaded: true, loading: false, error: null });
  },

  getOverride: (sku: string) => get().bySku[sku] ?? null,
}));

/** Derived helpers — call from any component without subscribing. */

/** Is the SKU visible in the public catalog? Defaults to true if no row. */
export function isSkuVisible(sku: string): boolean {
  const o = useProductOverrides.getState().bySku[sku];
  if (!o) return true;
  return !o.hidden && !o.deleted_at;
}

/** A variant counts as in stock if ANY of the three sources has supply:
 *    on_hand        — physical shelf
 *    inbound_units  — already paid for, in transit
 *    lead_days      — warehouse drop-ship (admin-only timing)
 *  Public catalog displays "In stock" for any of these (the lead-time
 *  truth stays in admin). */
function variantHasSupply(v: VariantOverride): boolean {
  return v.on_hand > 0 || v.inbound_units > 0 || v.lead_days != null;
}

/** Is the SKU in stock? Per-dose aware: a product is in stock if ANY of its
 *  doses has any supply. Falls back to the per-sku count, then to a
 *  deterministic hash when nothing is known, so the dev experience still has
 *  variety. */
export function isSkuInStock(sku: string): boolean {
  const state = useProductOverrides.getState();
  const o = state.bySku[sku];
  if (o?.deleted_at) return false;
  const variants = state.variantBySku[sku];
  if (variants) {
    const doses = Object.values(variants);
    if (doses.length > 0) return doses.some(variantHasSupply);
  }
  if (o) return o.on_hand > 0;
  // Fallback: same hash-based heuristic as the old inStockByKey.
  let hash = 0;
  for (let i = 0; i < sku.length; i++) {
    hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
  }
  return hash % 23 >= 4;
}

/** Is a specific dose of a SKU in stock? Returns true when no per-dose row
 *  exists (unknown → don't block), false only when the dose is tracked with
 *  no supply across any source. */
export function isDoseInStock(sku: string, dose: string): boolean {
  const v = useProductOverrides.getState().variantBySku[sku]?.[dose];
  if (!v) return isSkuInStock(sku);
  return variantHasSupply(v);
}

/** Price in cents, honoring an admin override. Returns null when no
 *  override exists — callers should fall back to lib/pricing. */
export function priceOverrideCents(sku: string): number | null {
  return useProductOverrides.getState().bySku[sku]?.price_cents_override ?? null;
}

/** Per-dose price override in cents, if set. Falls back to the per-sku
 *  override, then null (caller uses lib/pricing). */
export function variantPriceCents(sku: string, dose: string): number | null {
  const state = useProductOverrides.getState();
  const v = state.variantBySku[sku]?.[dose];
  if (v?.price_cents != null) return v.price_cents;
  return state.bySku[sku]?.price_cents_override ?? null;
}

export type DoseAvailability =
  | { state: 'in_stock' }
  | { state: 'out' }
  | { state: 'unknown' }; // no per-dose row tracked yet

/**
 * Public-facing availability for a specific dose. Public catalog treats every
 * supply source (on_hand, inbound, warehouse drop-ship) as plain "in stock" —
 * we don't expose the warehouse SLA to the buyer.
 *
 *   any supply source has units / lead → in_stock
 *   tracked but nothing anywhere       → out
 *   no per-dose row at all             → unknown (don't show a hard "out")
 *
 * Admin views should NOT use this — use the raw VariantOverride fields so
 * staff can distinguish on_hand vs inbound vs drop-ship.
 */
export function doseAvailability(sku: string, dose: string): DoseAvailability {
  const v = useProductOverrides.getState().variantBySku[sku]?.[dose];
  if (!v) return { state: 'unknown' };
  if (variantHasSupply(v)) return { state: 'in_stock' };
  return { state: 'out' };
}

/** Admin-set cited-clip for a SKU, if any. Returns null when no video_url
 *  override exists — callers fall back to the static COMPOUND_VIDEOS map. */
export function videoOverrideFor(sku: string): {
  url: string;
  title?: string;
  description?: string;
  thumbnail?: string;
} | null {
  const o = useProductOverrides.getState().bySku[sku];
  if (!o?.video_url) return null;
  return {
    url: o.video_url,
    title: o.video_title ?? undefined,
    description: o.video_description ?? undefined,
    thumbnail: o.video_thumbnail ?? undefined,
  };
}
