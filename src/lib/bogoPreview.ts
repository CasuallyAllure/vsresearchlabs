/**
 * bogoPreview — client-side mirror of the automatic LAUNCH DAY BOGO promo,
 * for CART PREVIEW ONLY. place-order re-resolves everything here
 * authoritatively; nothing computed in this module is ever billed.
 *
 * WHY THIS FILE IS A MIRROR AND NOT A SHARED IMPORT
 * -------------------------------------------------
 * place-order is Deno code deployed by `supabase functions deploy`, which
 * bundles from supabase/functions/ — an import reaching up into src/ is not
 * guaranteed to be uploaded, and tsconfig.app.json's `include: ["src"]` points
 * the other way. The repo's established answer (b2g1Preview ↔ promoPlan) is a
 * documented mirror whose agreement is PROVEN BY TEST rather than by the type
 * system: tests/unit/bogoParity.test.ts imports this module AND
 * supabase/functions/place-order/promoPlan.ts and asserts they agree, to the
 * cent, over a table of carts. That test is the contract. If you edit the
 * pairing kernel below, edit promoPlan.pairFreeUnits() in the same commit —
 * they are byte-identical on purpose.
 *
 * Mirrors buildPromoPlans()' BOGO branch:
 *   - MEMBERS ONLY — a guest previews nothing, matching the server's isMember
 *     gate (resolved there from the verified JWT, never the payload).
 *   - the line must resolve to a KNOWN (sku, dose) variant carrying an
 *     admin-set price (product_variant_stock.price_cents via
 *     productOverrides.variantPriceCents) — no server truth, no preview.
 *   - the dose must have genuine 24-HOUR supply (doseAvailability ===
 *     'in_stock'), matching the server's `fast` test. This is the exact
 *     inverse of B2G1's 'sourced' gate, so a line can never earn both.
 *   - the promo must be live for the sku (promoSettings.isBogoLiveFrom).
 *   - lines that win wholesale pack pricing are held OUT of the pairing, and
 *     wholesale/B2G1 are then arbitrated order-wide on total value.
 *
 * NEVER over-promises: any line whose eligibility can't be confidently
 * determined client-side shows nothing here, matching the server's `return []`
 * fallbacks.
 */

import type { Product } from '../types';
import { deriveProductDose } from '../types';
import { computeB2G1Preview } from './b2g1Preview';
import { doseAvailability, variantPriceCents } from './productOverrides';
import { isBogoLiveFrom, serverNowMs, usePromoSettings } from './promoSettings';
import { WHOLESALE_PACKS } from './wholesale';

/** True BOGO: units pair 2-at-a-time, cheaper of each pair free. Keep in sync
 *  with BOGO_PAIR in supabase/functions/place-order/promoPlan.ts. */
export const BOGO_PAIR = 2;

const WHOLESALE_CASE = WHOLESALE_PACKS.find((p) => p.key === 'case')!;
const WHOLESALE_HALF = WHOLESALE_PACKS.find((p) => p.key === 'half')!;
const WHOLESALE_MIN_PACK = Math.min(...WHOLESALE_PACKS.map((p) => p.size));

/** Mirrors promoPlan.wholesalePackValue()'s `value` output exactly. */
function wholesalePackValueCents(qty: number, unit: number): number {
  const cases = Math.floor(qty / WHOLESALE_CASE.size);
  const rem = qty - cases * WHOLESALE_CASE.size;
  const halfKits = rem >= WHOLESALE_HALF.size ? 1 : 0;
  return (
    cases * Math.round((WHOLESALE_CASE.size * unit * WHOLESALE_CASE.percent) / 100) +
    halfKits * Math.round((WHOLESALE_HALF.size * unit * WHOLESALE_HALF.percent) / 100)
  );
}

/** One purchasable unit, expanded out of a cart line for BOGO pairing. */
export interface BogoUnit {
  idx: number;
  unit: number;
}

export interface BogoPreviewLine {
  /** Index into the items array passed to computeBogoPreview. */
  idx: number;
  freeUnits: number;
  unit: number;
}

export interface BogoCartPreview {
  /** Lines carrying free units, ascending by idx. Empty when the promo isn't
   *  live, the buyer is a guest, no line qualifies, or a bigger promo won. */
  lines: BogoPreviewLine[];
  /** Sum of freeUnits × unit across `lines`, in integer cents. */
  totalCents: number;
}

/**
 * THE BOGO KERNEL — byte-identical to promoPlan.pairFreeUnits().
 *
 * Expand eligible lines into units, sort by unit price DESCENDING with an
 * idx-ascending tiebreak, and every 2nd unit (index 1, 3, 5 …) is free. The
 * pair spans lines, so one Reta 5mg + one BPC 5mg frees the cheaper of the two.
 *
 * The idx tiebreak makes the plan a pure function of its inputs: two units at
 * the same price are interchangeable for the TOTAL but not for which cart row
 * shows the discount, and preview and server must credit the same row.
 *
 * Integer cents throughout — no division, no rounding, nothing for the two
 * implementations to round differently. Odd counts round down in the buyer's
 * disfavour for free (3 units → 1 free, 5 → 2 free).
 */
export function pairFreeUnits(units: readonly BogoUnit[]): BogoPreviewLine[] {
  const sorted = [...units].sort((a, b) => (b.unit - a.unit) || (a.idx - b.idx));
  const freeByIdx = new Map<number, BogoPreviewLine>();
  for (let i = 1; i < sorted.length; i += BOGO_PAIR) {
    const u = sorted[i];
    const entry = freeByIdx.get(u.idx);
    if (entry) entry.freeUnits += 1;
    else freeByIdx.set(u.idx, { idx: u.idx, freeUnits: 1, unit: u.unit });
  }
  return [...freeByIdx.values()].sort((a, b) => a.idx - b.idx);
}

/** Total cents freed by a BOGO/B2G1-shaped plan. */
export function freePlanValue(plan: readonly { freeUnits: number; unit: number }[]): number {
  return plan.reduce((sum, p) => sum + p.freeUnits * p.unit, 0);
}

/**
 * Compute the BOGO preview for a cart.
 *
 * `live` is passed in rather than read from the store so a component that
 * already SUBSCRIBES to promo settings can drive this from the values it
 * subscribed to — a getState() read inside a useMemo is invisible to React and
 * would go stale when the promo loads in (the documented promoSettings trap).
 * Use bogoPreviewFromStore() for non-React callers.
 */
export function computeBogoPreview(
  items: ReadonlyArray<{ product: Product; quantity: number }>,
  isMember: boolean,
  live: boolean,
  excludedSkus: ReadonlyArray<string> = [],
): BogoCartPreview {
  const empty: BogoCartPreview = { lines: [], totalCents: 0 };
  if (!isMember || !live) return empty;

  const excluded = new Set(excludedSkus);
  const units: BogoUnit[] = [];
  const wholesaleValues: number[] = [];

  items.forEach((item, idx) => {
    const sku = item.product.sku;
    const qty = item.quantity;
    if (!sku || qty < 1) return;

    const dose = deriveProductDose(item.product);
    const avail = doseAvailability(sku, dose);
    if (avail.state === 'unknown') return; // no server row to promo off

    const unit = variantPriceCents(sku, dose);
    if (unit == null || unit <= 0) return; // no admin price — no server truth

    // Track which lines win wholesale, for the ORDER-WIDE arbitration below.
    // Note these lines are NOT held out of the pairing — see buildPromoPlans:
    // holding them out made wholesale win a 5-unit 24-hour line at 27% when
    // BOGO on the same units is worth 40%. Pair everything, arbitrate totals.
    // (Ship speed does NOT gate wholesale, matching wholesale.ts/promoPlan.ts.)
    const b2g1Value = avail.state === 'sourced' ? Math.floor(qty / 3) * unit : 0;
    const packValue = isMember && qty >= WHOLESALE_MIN_PACK
      ? wholesalePackValueCents(qty, unit)
      : 0;
    if (packValue > 0 && packValue >= b2g1Value) wholesaleValues.push(packValue);

    // 24-HOUR ONLY — the exact inverse of B2G1's 'sourced' gate.
    if (avail.state !== 'in_stock') return;
    if (excluded.has(sku)) return;

    for (let i = 0; i < qty; i += 1) units.push({ idx, unit });
  });

  let lines = pairFreeUnits(units);
  const bogoValue = freePlanValue(lines);
  if (bogoValue <= 0) return empty;

  // Order-wide arbitration, mirroring buildPromoPlans exactly.
  // Wholesale is a final price; it only loses to a STRICTLY larger BOGO.
  if (wholesaleValues.length > 0) {
    const wholesaleTotal = wholesaleValues.reduce((sum, v) => sum + v, 0);
    if (bogoValue <= wholesaleTotal) return empty;
  }

  // BOGO vs B2G1 — no-stack, larger wins, tie → BOGO.
  const b2g1 = computeB2G1Preview(items, isMember);
  if (b2g1.totalCents > bogoValue) lines = [];

  return { lines, totalCents: freePlanValue(lines) };
}

/** Store-reading convenience for non-React callers (and tests). React
 *  components should subscribe and call computeBogoPreview directly. */
export function bogoPreviewFromStore(
  items: ReadonlyArray<{ product: Product; quantity: number }>,
  isMember: boolean,
): BogoCartPreview {
  const s = usePromoSettings.getState();
  return computeBogoPreview(
    items,
    isMember,
    // serverNowMs() — never Date.now(). A device clock must not be able to
    // extend or curtail the promo, and a missing server clock reads NOT LIVE.
    isBogoLiveFrom(s.bogoEnabled, s.bogoEndsAt, [], null, serverNowMs()),
    s.bogoExcludedSkus,
  );
}

/**
 * Owner policy: BOGO and the automatic member/account percentage never stack —
 * the single bigger discount wins, tie → BOGO. Same shape as
 * b2g1Preview.b2g1BeatsAccount, and mirrors the handler's arbitration gate:
 * compare BOGO's flat value against what the account % would yield on the base
 * WITHOUT BOGO (never the post-BOGO base).
 *
 * Returns true when BOGO bills (and the account row must be hidden), false when
 * the account discount bills instead (and the BOGO row must be hidden).
 */
export function bogoBeatsAccount(bogoCents: number, accountCentsWithoutBogo: number): boolean {
  return bogoCents >= accountCentsWithoutBogo;
}
