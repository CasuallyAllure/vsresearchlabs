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
  /** Explicit per-dose visibility switch (migration 047). true → the dose is
   *  never listed publicly, regardless of price or stock. */
  hidden: boolean;
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
    // Migration 047 added `hidden`. Try the fullest select first, then shed
    // columns in reverse-migration order so the catalog keeps rendering on a
    // deploy that lands before its migration.
    let vData: Partial<VariantOverride>[] | null = null;
    const { data: vHidden, error: vHiddenErr } = await supabase
      .from('public_variant_overrides')
      .select('sku, dose, on_hand, inbound_units, price_cents, lead_days, hidden');
    if (!vHiddenErr) {
      vData = vHidden as Partial<VariantOverride>[];
    } else {
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
        hidden: row.hidden ?? false,
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

/** A variant carries genuine 24-hour supply only when there's real inventory
 *  physically on hand or already in transit (paid for, in the mail).
 *  `lead_days` alone is a drop-ship warehouse SLA, not a 24-hour signal —
 *  a variant with only `lead_days` set is "sourced", not "24-hour". */
function has24hrSupply(v: VariantOverride): boolean {
  return v.on_hand > 0 || v.inbound_units > 0;
}

/** A dose only counts toward "the SKU is 24-hour" if it's also the kind of
 *  dose a buyer can actually see and pick — i.e. publicly priced. A dose
 *  with supply but no admin-set price never renders as a catalog option
 *  (see isVariantPublic), so it must not make the SKU (and its visible,
 *  possibly-sourced doses) read as 24-hour. */
function isPublic24hrDose(v: VariantOverride): boolean {
  return v.price_cents != null && has24hrSupply(v);
}

/** Is the SKU 24-hour? Per-dose aware: a product is 24-hour if ANY of its
 *  PUBLICLY-PRICED doses carries genuine on-hand/inbound supply. No data (no
 *  per-dose rows, no per-sku override) means the SKU is NOT 24-hour — it
 *  falls to the sourced tier. There is no fabricated fallback; honesty over
 *  variety. */
export function isSkuInStock(sku: string): boolean {
  const state = useProductOverrides.getState();
  const o = state.bySku[sku];
  if (o?.deleted_at) return false;
  const variants = state.variantBySku[sku];
  if (variants) {
    const doses = Object.values(variants);
    if (doses.length > 0) return doses.some(isPublic24hrDose);
  }
  if (o) return o.on_hand > 0;
  return false;
}

/** Is a specific (sku, dose) genuinely 24-hour (on-hand or inbound)? False
 *  for everything else, including untracked doses — no data means sourced,
 *  never a fabricated "in stock". */
export function is24hrDose(sku: string, dose: string): boolean {
  const v = useProductOverrides.getState().variantBySku[sku]?.[dose];
  if (!v) return false;
  return has24hrSupply(v);
}

/** Back-compat alias for {@link is24hrDose} — true only for a genuinely
 *  24-hour dose. */
export function isDoseInStock(sku: string, dose: string): boolean {
  return is24hrDose(sku, dose);
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

/** Public catalog visibility for a (sku, dose) pair.
 *
 * A variant is publicly visible when the master inventory sheet carries an
 * admin-set price for it. No price = sit in the DB but don't appear as a
 * dose option to buyers (the user's "we're not gonna put it as an option"
 * rule). The formula fallback in lib/pricing.ts is intentionally not used
 * here — it'd defeat the no-price-means-hide policy by manufacturing a
 * placeholder price for every mg dose.
 *
 * If no per-dose row exists at all (no import has touched this variant) we
 * default to visible so a fresh seed install still shows everything; the
 * filter only kicks in once the import has written something. */
export function isVariantPublic(sku: string, dose: string): boolean {
  const state = useProductOverrides.getState();
  const v = state.variantBySku[sku]?.[dose];
  if (!v) return true; // not yet tracked — don't hide
  if (v.hidden) return false; // explicit per-dose hide (migration 047) — always wins
  if (v.price_cents != null) return true;
  // No admin price set. A dose still carrying a genuine supply/sourcing
  // signal — on-hand stock, inbound units, or a drop-ship lead time — is a
  // real, sellable dose that simply hasn't had a price imported yet; the
  // formula fallback in lib/pricing.ts prices it. A dose tracked with NO
  // signal at all (the master-sheet "xx" convention) is the intentional
  // "cleared price to hide this dose" case and stays hidden.
  return v.on_hand > 0 || v.inbound_units > 0 || v.lead_days != null;
}

/** Same rule applied at the SKU level. A product is publicly visible only if
 *  at least one of its tracked variants is publicly visible. Used to filter
 *  catalog list grids. */
export function isProductPublic(sku: string, variantDoses: string[]): boolean {
  const state = useProductOverrides.getState();
  const variants = state.variantBySku[sku];
  if (!variants) return true; // nothing imported for this SKU yet
  // Public if any provided dose is itself publicly listable — this routes
  // through isVariantPublic so an explicit per-dose hide (migration 047) and
  // the price/supply rules stay in one place.
  return variantDoses.some((dose) => isVariantPublic(sku, dose));
}

export type DoseAvailability =
  /** Genuine on-hand/inbound supply — ships in 24 hours. `fast` is always
   *  true here; the field is kept so callers that already branch on
   *  `state === 'in_stock' && av.fast` keep working unchanged. */
  | { state: 'in_stock'; fast: true }
  /** No 24-hour supply. Still orderable — ships 7–10 business days from the
   *  sourced/drop-ship warehouse. There is no "out of stock" tier for
   *  peptides; everything lists and converts. */
  | { state: 'sourced' }
  /** No per-dose row tracked at all — not a real variant. */
  | { state: 'unknown' };

/**
 * Public-facing availability for a specific dose. Two tiers only:
 *
 *   on_hand > 0 or inbound_units > 0 → in_stock (24-hour, `fast: true`)
 *   tracked but no 24-hour supply     → sourced (7–10 business days)
 *   no per-dose row at all            → unknown (not a real variant)
 *
 * `lead_days` alone is NOT a 24-hour signal — a variant with only lead_days
 * set falls to `sourced`.
 *
 * Admin views should NOT use this — use the raw VariantOverride fields so
 * staff can distinguish on_hand vs inbound vs drop-ship.
 */
export function doseAvailability(sku: string, dose: string): DoseAvailability {
  const v = useProductOverrides.getState().variantBySku[sku]?.[dose];
  if (!v) return { state: 'unknown' };
  if (has24hrSupply(v)) return { state: 'in_stock', fast: true };
  return { state: 'sourced' };
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
