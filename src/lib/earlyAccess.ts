/**
 * earlyAccess — member-first visibility window for catalog products.
 *
 * A product is in its early-access window — shown to everyone but ORDERABLE
 * only by signed-in account holders — when EITHER:
 *   • the admin-set DB flag is on (product_flags.early_access, migration 077,
 *     toggled per-SKU from the Inventory admin editor), OR
 *   • the product carries the legacy 'early-access' tag in its catalog data
 *     (a data edit, no code change — same mechanism as the 'blend' tag).
 *
 * The tag is the deliberate OR-fallback, not a legacy path being phased out
 * on a deadline: with zero rows in product_flags (today's production state,
 * and true of any SKU an admin hasn't touched yet) this is byte-for-byte the
 * old tag-only behavior. Flip the flag from the admin without needing a tag
 * edit at all, or keep using the tag — either one gates.
 *
 * Enforcement posture (documented, deliberate): this is a MERCHANDISING
 * window, not a price or security control. The client hides the order
 * controls from guests; the backstop is the existing human order flow —
 * every order is reviewed and invoiced by the admin before payment, so a
 * hand-crafted guest order for an early-access item is caught there. No
 * place-order (money-path) change is made for this.
 *
 * Flags are read through `public_product_flags` (an anon-readable view over
 * the admin-only `product_flags` table — see migration 077) and cached in
 * `useEarlyAccessFlags`. `useEarlyAccessFlags.getState().load()` is called
 * once at boot (src/main.tsx, alongside productOverrides/promoSettings).
 *
 * REACTIVITY: `isEarlyAccessProduct` is a pure function — it takes the flag
 * map as an argument and never reads the store itself. Callers MUST
 * subscribe with a selector (e.g. `useEarlyAccessFlags((s) => s.bySku)`),
 * mirroring how components already subscribe to `useProductOverrides` for
 * price/stock. A `.getState()` read establishes no subscription, so a
 * mounted tile would never re-render when `load()` resolves after first
 * paint or an admin toggles a flag — this shape makes that mistake
 * impossible to make by accident at a call site.
 */

import { create } from 'zustand';
import { supabase } from './supabase';
import type { Product } from '../types/product';
import { MEMBER_DISCOUNT_PERCENT } from './memberPricing';

export const EARLY_ACCESS_TAG = 'early-access';

interface EarlyAccessFlagsState {
  bySku: Record<string, boolean>;
  /** sku -> that product's OWN member rate (087). Absent = the account's own
   *  rate applies, which is every ordinary product. */
  rateBySku: Record<string, number>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
}

export const useEarlyAccessFlags = create<EarlyAccessFlagsState>((set, get) => ({
  bySku: {},
  rateBySku: {},
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loaded || get().loading) return;
    await get().reload();
  },

  reload: async () => {
    if (!supabase) {
      // Nothing was ever loaded — no prior cache to preserve.
      set({ bySku: {}, rateBySku: {}, loaded: true, loading: false });
      return;
    }
    set({ loading: true });
    const { data, error } = await supabase
      .from('public_product_flags')
      .select('sku, early_access, member_discount_percent');
    if (error || !data) {
      // A failed REVALIDATION (e.g. the post-toggle reload from the admin
      // editor) must not discard an already-populated cache — that would
      // drop every flag to "unset" for the rest of the session on a single
      // transient network blip. Only `loaded`/`loading` change; `bySku`
      // stays whatever it already was (still {} on a genuine first-load
      // failure, since that's the initial state).
      set({ loaded: true, loading: false });
      return;
    }
    const next: Record<string, boolean> = {};
    const rates: Record<string, number> = {};
    for (const row of data as {
      sku: string;
      early_access: boolean;
      member_discount_percent: number | null;
    }[]) {
      next[row.sku] = row.early_access === true;
      // 087: a product may carry its own member rate. Absent means the
      // account's own rate applies, which is every ordinary product.
      if (row.member_discount_percent != null) rates[row.sku] = row.member_discount_percent;
    }
    set({ bySku: next, rateBySku: rates, loaded: true, loading: false });
  },
}));

/** Whether a product is currently in its member-first window: the
 *  caller-supplied flag map (from `useEarlyAccessFlags`, subscribed) OR the
 *  legacy tag — either one gates (see file header). Pure: takes flags as an
 *  argument instead of reading the store, so callers own the subscription
 *  and the gate re-renders correctly when flags load or change. */
export function isEarlyAccessProduct(product: Product, flags: Record<string, boolean>): boolean {
  const flagged = flags[product.sku] === true;
  const tagged = (product.tags ?? []).includes(EARLY_ACCESS_TAG);
  return flagged || tagged;
}

/** Copy shown in place of the order control for signed-out visitors. */
export const EARLY_ACCESS_GUEST_LINE =
  'Member early access — sign in to order';

/** A product's own automatic member rate (087), or the standard rate when it
 *  carries none. Pure: takes the rate map as an argument, same as
 *  `isEarlyAccessProduct`, so the caller owns the subscription and the price
 *  re-renders when flags load. */
export function memberRateFor(sku: string, rates: Record<string, number>): number {
  const own = rates[sku];
  return typeof own === 'number' ? own : MEMBER_DISCOUNT_PERCENT;
}
