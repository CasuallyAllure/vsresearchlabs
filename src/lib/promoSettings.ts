/**
 * promoSettings — the storefront's read-only view of the Buy-2-Get-1-Free
 * promo governance (migration 055). Loaded once at boot (mirrors
 * productOverrides). The SERVER (place-order) is authoritative for whether the
 * discount actually applies; this store only drives storefront messaging —
 * showing the LTO line + countdown on qualifying items and hiding it on
 * excluded/expired ones. No-op when Supabase isn't configured.
 *
 * Writes happen through the admin `set_b2g1_promo` RPC (see AdminPromoPanel),
 * never here.
 */

import { create } from 'zustand';
import { supabase } from './supabase';

interface PromoSettings {
  b2g1Enabled: boolean;
  b2g1EndsAt: string | null;
  b2g1ExcludedSkus: string[];
}

interface PromoState extends PromoSettings {
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
}

const DEFAULTS: PromoSettings = {
  b2g1Enabled: false, // pessimistic until loaded — never over-promise the promo
  b2g1EndsAt: null,
  b2g1ExcludedSkus: [],
};

export const usePromoSettings = create<PromoState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  loading: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    await get().reload();
  },
  reload: async () => {
    if (!supabase) {
      set({ ...DEFAULTS, loaded: true, loading: false });
      return;
    }
    set({ loading: true });
    const { data, error } = await supabase
      .from('promo_settings')
      .select('b2g1_enabled, b2g1_ends_at, b2g1_excluded_skus')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) {
      set({ ...DEFAULTS, loaded: true, loading: false });
      return;
    }
    set({
      b2g1Enabled: !!data.b2g1_enabled,
      b2g1EndsAt: data.b2g1_ends_at ?? null,
      b2g1ExcludedSkus: (data.b2g1_excluded_skus ?? []) as string[],
      loaded: true,
      loading: false,
    });
  },
}));

/** Is the B2G1 promo live right now for this SKU? Mirrors the place-order
 *  gate: enabled, not past its end date, and the SKU isn't excluded. */
export function isB2G1Active(sku?: string | null): boolean {
  const s = usePromoSettings.getState();
  if (!s.b2g1Enabled) return false;
  if (s.b2g1EndsAt != null && Date.parse(s.b2g1EndsAt) <= Date.now()) return false;
  if (sku && s.b2g1ExcludedSkus.includes(sku)) return false;
  return true;
}

/** "ends Jul 20" style suffix for the LTO line, or '' when there's no end date. */
export function b2g1EndsLabel(): string {
  const endsAt = usePromoSettings.getState().b2g1EndsAt;
  if (!endsAt) return '';
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return '';
  return ` — ends ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** The full promo blurb for the 7–10-day chip tooltip when the promo is live
 *  for `sku`, or null when it isn't (caller shows the plain shipping copy). */
export function b2g1TooltipContent(sku?: string | null): string | null {
  if (!isB2G1Active(sku)) return null;
  return `Buy 2, Get 1 Free — limited-time offer${b2g1EndsLabel()}. Add 3 of a standard-shipping item to your cart and the 3rd is free at checkout.`;
}
