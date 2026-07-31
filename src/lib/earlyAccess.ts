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
 * this small store. `useEarlyAccessFlags.getState().load()` is called once
 * at boot (src/main.tsx, alongside productOverrides/promoSettings); until
 * that resolves — or if Supabase isn't configured — the cache is empty and
 * the tag alone decides, which is exactly the ship-day behavior.
 */

import { create } from 'zustand';
import { supabase } from './supabase';
import type { Product } from '../types/product';

export const EARLY_ACCESS_TAG = 'early-access';

interface EarlyAccessFlagsState {
  bySku: Record<string, boolean>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
}

export const useEarlyAccessFlags = create<EarlyAccessFlagsState>((set, get) => ({
  bySku: {},
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loaded || get().loading) return;
    await get().reload();
  },

  reload: async () => {
    if (!supabase) {
      set({ bySku: {}, loaded: true, loading: false });
      return;
    }
    set({ loading: true });
    const { data, error } = await supabase.from('public_product_flags').select('sku, early_access');
    if (error || !data) {
      set({ bySku: {}, loaded: true, loading: false });
      return;
    }
    const next: Record<string, boolean> = {};
    for (const row of data as { sku: string; early_access: boolean }[]) {
      next[row.sku] = row.early_access === true;
    }
    set({ bySku: next, loaded: true, loading: false });
  },
}));

/** Whether this product is currently in its member-first window: the
 *  admin-set DB flag OR the legacy tag (see file header — either gates). */
export function isEarlyAccessProduct(product: Product): boolean {
  const flagged = useEarlyAccessFlags.getState().bySku[product.sku] === true;
  const tagged = (product.tags ?? []).includes(EARLY_ACCESS_TAG);
  return flagged || tagged;
}

/** Copy shown in place of the order control for signed-out visitors. */
export const EARLY_ACCESS_GUEST_LINE =
  'Member early access — sign in to order';
