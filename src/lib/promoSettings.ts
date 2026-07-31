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

/** The gate itself, over explicit values. Split out from `isB2G1Active` so a
 *  component that already SUBSCRIBES to the store can evaluate liveness from
 *  the values it subscribed to — a `getState()` read inside a memo is
 *  invisible to React and would go stale when the promo loads in. */
export function isB2G1LiveFrom(
  enabled: boolean,
  endsAt: string | null,
  excludedSkus: ReadonlyArray<string> = [],
  sku?: string | null,
): boolean {
  if (!enabled) return false;
  if (endsAt != null && Date.parse(endsAt) <= Date.now()) return false;
  if (sku && excludedSkus.includes(sku)) return false;
  return true;
}

/** Is the B2G1 promo live right now for this SKU? Mirrors the place-order
 *  gate: enabled, not past its end date, and the SKU isn't excluded. */
export function isB2G1Active(sku?: string | null): boolean {
  const s = usePromoSettings.getState();
  return isB2G1LiveFrom(s.b2g1Enabled, s.b2g1EndsAt, s.b2g1ExcludedSkus, sku);
}

/** "effective through Jul 20" suffix stating the term boundary, or '' when
 *  the term has no end date. Display only — `isB2G1Active` is what actually
 *  gates eligibility on `b2g1EndsAt`. */
export function b2g1EndsLabel(): string {
  const endsAt = usePromoSettings.getState().b2g1EndsAt;
  if (!endsAt) return '';
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return '';
  return ` Effective through ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`;
}

/** The full pricing-term blurb for the 7–10-day chip tooltip when the term is
 *  live for `sku`, or null when it isn't (caller shows the plain shipping
 *  copy). Stated as a supply term, not a countdown. */
export function b2g1TooltipContent(sku?: string | null): string | null {
  if (!isB2G1Active(sku)) return null;
  return `Standard-shipping volume term: order 3 units of an item and the third is supplied at no charge, applied at checkout.${b2g1EndsLabel()}`;
}
