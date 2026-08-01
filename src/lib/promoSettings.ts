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

/**
 * A MONOTONIC reading in ms — performance.now() where available, Date.now() as
 * a last resort. Used only to measure ELAPSED time between two readings, never
 * as a wall clock, so a device whose clock is wrong (or is changed mid-session
 * by NTP, DST or the user) cannot shift a promo boundary.
 */
function monotonicNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface PromoSettings {
  b2g1Enabled: boolean;
  b2g1EndsAt: string | null;
  b2g1ExcludedSkus: string[];
  bogoEnabled: boolean;
  bogoEndsAt: string | null;
  bogoExcludedSkus: string[];
  /** The SERVER's instant at the moment the settings were fetched, in ms.
   *  null until a successful load. Never the device clock. */
  serverNowMs: number | null;
  /** performance.now() at that same moment — a MONOTONIC stopwatch reading,
   *  immune to wall-clock changes, NTP steps and user tampering. */
  fetchedAtMs: number | null;
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
  bogoEnabled: false, // same pessimism: the banner must never advertise a dead promo
  bogoEndsAt: null,
  bogoExcludedSkus: [],
  serverNowMs: null,
  fetchedAtMs: null,
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
    // Prefer the VIEW — it carries the server's own clock (server_now) and the
    // server's own liveness verdict. Fall back to the base TABLE when the view
    // isn't there yet: the frontend auto-deploys on push to main while
    // `supabase db push` is manual, so a window where 084 hasn't landed is
    // real. In that window bogo_* is absent too, so BOGO simply reads OFF —
    // the fallback fails CLOSED by construction rather than by a second rule.
    //
    // select('*') on both, never a column list: naming bogo_* explicitly would
    // 400 pre-084 and the error branch would take the LIVE B2G1 promo down too.
    let data: Record<string, unknown> | null = null;
    const viewRes = await supabase
      .from('public_promo_settings').select('*').eq('id', 1).maybeSingle();
    if (!viewRes.error && viewRes.data) {
      data = viewRes.data as Record<string, unknown>;
    } else {
      const tableRes = await supabase
        .from('promo_settings').select('*').eq('id', 1).maybeSingle();
      if (!tableRes.error && tableRes.data) data = tableRes.data as Record<string, unknown>;
    }
    if (!data) {
      set({ ...DEFAULTS, loaded: true, loading: false });
      return;
    }
    // Absent server_now (table fallback) → null, and every downstream gate
    // treats a null server clock as "not live".
    const rawServerNow = data.server_now;
    const parsedServerNow = typeof rawServerNow === 'string' ? Date.parse(rawServerNow) : NaN;
    const serverNow = Number.isFinite(parsedServerNow) ? parsedServerNow : null;
    set({
      b2g1Enabled: !!data.b2g1_enabled,
      b2g1EndsAt: typeof data.b2g1_ends_at === 'string' ? data.b2g1_ends_at : null,
      b2g1ExcludedSkus: (data.b2g1_excluded_skus ?? []) as string[],
      bogoEnabled: !!data.bogo_enabled,
      bogoEndsAt: typeof data.bogo_ends_at === 'string' ? data.bogo_ends_at : null,
      bogoExcludedSkus: (data.bogo_excluded_skus ?? []) as string[],
      serverNowMs: serverNow,
      fetchedAtMs: monotonicNowMs(),
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

/**
 * The current instant AS THE SERVER SEES IT, in ms — the server's clock at
 * fetch time advanced by the monotonic time elapsed since.
 *
 * THE DEVICE CLOCK IS NEVER CONSULTED AS A WALL CLOCK. monotonicNowMs() is a
 * stopwatch: only the DIFFERENCE between two readings is used, so a device set
 * hours forward or back, or stepped by NTP mid-session, yields the same answer.
 * That is what stops a wrong device clock granting or denying a discount.
 *
 * Returns null when no server clock has been fetched; every caller treats null
 * as NOT LIVE, so the preview fails CLOSED. That direction is required:
 * place-order is authoritative, so a client that believed a dead promo was
 * still live would show a discount the buyer never actually receives.
 */
export function serverNowMs(): number | null {
  const s = usePromoSettings.getState();
  return estimateServerNow(s.serverNowMs, s.fetchedAtMs, monotonicNowMs());
}

/** Pure core of {@link serverNowMs}, split out so it can be tested directly. */
export function estimateServerNow(
  fetchedServerNowMs: number | null,
  fetchedAtMs: number | null,
  monotonicNow: number,
): number | null {
  if (fetchedServerNowMs == null || fetchedAtMs == null) return null;
  return fetchedServerNowMs + Math.max(monotonicNow - fetchedAtMs, 0);
}

/**
 * The LAUNCH DAY BOGO gate — same shape as isB2G1LiveFrom and mirroring the
 * place-order gate, with one deliberate difference: it takes the SERVER's
 * current instant explicitly instead of reading Date.now().
 *
 * FAILS CLOSED — a null `nowMs` (no server clock yet) means not live.
 */
export function isBogoLiveFrom(
  enabled: boolean,
  endsAt: string | null,
  excludedSkus: ReadonlyArray<string> = [],
  sku?: string | null,
  nowMs?: number | null,
): boolean {
  if (!enabled) return false;
  if (endsAt != null) {
    // No trustworthy clock → not live. NEVER fall back to Date.now(): that is
    // precisely the device clock this gate exists to ignore.
    if (nowMs == null) return false;
    // Exclusive upper bound — live strictly BEFORE the boundary instant, so
    // "through the end of Monday" is stored as Tuesday 00:00:00 store-local.
    if (Date.parse(endsAt) <= nowMs) return false;
  }
  if (sku && excludedSkus.includes(sku)) return false;
  return true;
}

/** Is the BOGO promo live right now for this SKU, by the SERVER's clock? */
export function isBogoActive(sku?: string | null): boolean {
  const s = usePromoSettings.getState();
  return isBogoLiveFrom(s.bogoEnabled, s.bogoEndsAt, s.bogoExcludedSkus, sku, serverNowMs());
}

/** The store's operating timezone. The promo window is defined in it, and the
 *  deadline is rendered in it — a customer in London must read the same
 *  deadline the store actually enforces, not their own midnight. */
export const STORE_TIME_ZONE = 'America/Los_Angeles';

/**
 * "Monday, August 3" — the last day the promo runs, for banner copy.
 *
 * The stored boundary is EXCLUSIVE (Tuesday 00:00 store-local), so the day
 * named here is the one containing the final millisecond before the bound.
 * Formatting is pinned to STORE_TIME_ZONE, never the viewer's.
 */
export function bogoDeadlineLabel(endsAt: string | null): string {
  if (!endsAt) return '';
  const bound = Date.parse(endsAt);
  if (!Number.isFinite(bound)) return '';
  return new Date(bound - 1).toLocaleDateString('en-US', {
    timeZone: STORE_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
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
