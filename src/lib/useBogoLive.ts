/**
 * useBogoLive — the LAUNCH DAY BOGO liveness gate, as a SUBSCRIPTION.
 *
 * Both cart surfaces (CartDrawer + CartPage) need the same answer, and both
 * would otherwise reach for `isBogoActive()`. They must not: the two traps
 * documented in components/promo/BogoBanner.tsx apply verbatim here.
 *
 *   1. SUBSCRIBE, never getState(). A store read React cannot see goes stale,
 *      so the discount row would never appear once the settings load in.
 *   2. The device clock is never a wall clock. Liveness is estimated from the
 *      SERVER's instant at fetch time plus MONOTONIC elapsed time, so a wrong
 *      or tampered device clock cannot extend the promo past its deadline.
 *
 * FAILS CLOSED — nothing loaded, or no server clock, reads NOT LIVE. That
 * direction is required: place-order is authoritative, so a cart that believed
 * a dead promo was live would quote a discount the buyer never receives.
 */

import { useEffect, useState } from 'react';
import { estimateServerNow, isBogoLiveFrom, usePromoSettings } from './promoSettings';

/** How often liveness is re-evaluated while the cart is open. A cart left
 *  sitting past the deadline must stop quoting the promo without a reload —
 *  that exact case is what place-order's "the offer ended" notice covers. */
const LIVENESS_TICK_MS = 60_000;

/** A MONOTONIC reading — only ever differenced against another reading, never
 *  read as a wall clock. Mirrors promoSettings' private helper. */
function monotonicNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export interface BogoLiveness {
  /** The promo is running right now, by the SERVER's clock. */
  live: boolean;
  /** SKUs the owner excluded. Passed straight to computeBogoPreview, which
   *  applies them per cart line. */
  excludedSkus: string[];
}

export function useBogoLive(): BogoLiveness {
  // Subscriptions, not getState() — see trap 1 in the file header.
  const bogoEnabled = usePromoSettings((s) => s.bogoEnabled);
  const bogoEndsAt = usePromoSettings((s) => s.bogoEndsAt);
  const excludedSkus = usePromoSettings((s) => s.bogoExcludedSkus);
  const fetchedServerNowMs = usePromoSettings((s) => s.serverNowMs);
  const fetchedAtMs = usePromoSettings((s) => s.fetchedAtMs);
  const load = usePromoSettings((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const [monotonicTick, setMonotonicTick] = useState(monotonicNowMs);
  useEffect(() => {
    const id = window.setInterval(() => setMonotonicTick(monotonicNowMs()), LIVENESS_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // No SKU on the order-wide gate — the exclusion list is applied per line by
  // computeBogoPreview, which is the only place that knows the cart's SKUs.
  const live = isBogoLiveFrom(
    bogoEnabled,
    bogoEndsAt,
    [],
    null,
    estimateServerNow(fetchedServerNowMs, fetchedAtMs, monotonicTick),
  );

  return { live, excludedSkus };
}
