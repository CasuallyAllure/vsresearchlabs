// supabase/functions/place-order/promoPlan.ts
// Pure planner for the two automatic, server-side promos: WHOLESALE pack
// pricing and B2G1. Extracted from the handler so the money rules are unit
// testable (vitest) — no Deno/supabase imports.
//
// The handler consumes the plans as flat reductions; this module decides only
// WHICH lines get WHICH promo and for HOW MUCH.
//
// WHOLESALE ELIGIBILITY IS A SERVER FACT (P0-3). The old rule was: non-empty
// sku + client-sent unit > 0 + qty >= 3. That granted 27–40% off ANY sku at a
// discount computed from the buyer's own number — 10 × a $200 microcentrifuge
// billed $800 under quote. Every input to eligibility now comes from the
// database row the line resolves to:
//   • the line must resolve to a real (sku, dose) variant row
//   • that row must be wholesale_eligible (migration 063 — seeded compounds
//     yes, supplies/equipment no; `category` from the payload is ignored, it is
//     attacker-controlled)
//   • that row must carry an admin price — the pack value is computed from
//     product_variant_stock.price_cents, NEVER from the client's `unit`
//   • qty must reach the smallest pack (WHOLESALE_HALF.size = 5), matching the
//     client's advertised WHOLESALE_MIN_PACK; the server used to say 3
//
// Dose resolution is shared with the price check (resolveVariantRow), so the
// row that priced the line is the same row that decides its promos — the two
// can never disagree about which dose a line is.

import { lineText, resolveVariantRow, type VariantRow } from "./priceCheck.ts";

/** Keep in sync with WHOLESALE_PACKS in src/lib/wholesale.ts. */
export const WHOLESALE_CASE = { size: 10, percent: 40 } as const;
export const WHOLESALE_HALF = { size: 5, percent: 27 } as const;

/** Buy-2-get-1: one free unit per group of 3. */
export const B2G1_GROUP = 3;

/** True BOGO: units pair up 2-at-a-time and the cheaper of each pair is free. */
export const BOGO_PAIR = 2;

/** Like PriceCheckLine, carries NO `note` — see priceCheck.lineText. */
export interface PromoLine {
  sku?: string;
  name: string;
  /** Already clamped by the caller. */
  quantity: number;
  /** Already clamped by the caller. Used for arithmetic ONLY after the price
   *  check has verified it equals the admin price; eligibility never reads it. */
  unitPriceCents: number;
}

/** The product_variant_stock columns the planner needs. */
export interface VariantPromoRow extends VariantRow {
  on_hand: number | null;
  inbound_units: number | null;
  lead_days: number | null;
  price_cents: number | null;
  wholesale_eligible: boolean | null;
}

export interface WholesalePlanEntry {
  /** Index into the caller's line array. */
  idx: number;
  /** Units covered by full packs (the rest bill at retail). */
  units: number;
  /** Cents off. */
  value: number;
}

export interface B2G1PlanEntry {
  idx: number;
  freeUnits: number;
  /** The server-priced unit the free units are valued at. */
  unit: number;
}

/** Same shape as B2G1PlanEntry — orderTotals consumes both as flat
 *  `freeUnits × unit` reductions. Kept a distinct type so the handler can
 *  never accidentally pass one plan where the other is meant (they carry
 *  different coupon codes and different order_coupons rows). */
export interface BogoPlanEntry {
  idx: number;
  freeUnits: number;
  unit: number;
}

export interface PromoPlanInput {
  lines: readonly PromoLine[];
  variantRows: readonly VariantPromoRow[];
  /** promo_settings.b2g1_enabled, honouring b2g1_ends_at. */
  promoLive: boolean;
  /** promo_settings.b2g1_excluded_skus. */
  excludedSkus: ReadonlySet<string>;
  /** promo_settings.bogo_enabled, honouring bogo_ends_at. Optional, and
   *  ABSENT MEANS OFF — an environment (or caller) that predates migration 084
   *  simply doesn't run the promo rather than failing. */
  bogoLive?: boolean;
  /** promo_settings.bogo_excluded_skus. */
  bogoExcludedSkus?: ReadonlySet<string>;
  /** Resolved from the verified JWT — never from the payload. */
  isMember: boolean;
}

export interface PromoPlan {
  wholesalePlan: WholesalePlanEntry[];
  b2g1FreePlan: B2G1PlanEntry[];
  bogoFreePlan: BogoPlanEntry[];
}

/** One purchasable unit, expanded out of a cart line for BOGO pairing. */
export interface BogoUnit {
  /** Index into the caller's line array. */
  idx: number;
  /** Server-priced unit cost in integer cents. */
  unit: number;
}

/**
 * THE BOGO KERNEL — shared, by mirror, with src/lib/bogoPreview.ts.
 *
 * True buy-one-get-one, cheapest-of-each-pair, ACROSS the whole cart: expand
 * every eligible line into individual units, sort them by unit price
 * DESCENDING, and every 2nd unit (array index 1, 3, 5 …) is free. Buying one
 * Reta 5mg and one BPC 5mg therefore makes the cheaper of the two free — the
 * pair spans two different lines, which is why this cannot be a per-line rule
 * like B2G1.
 *
 * The comparator is (unit DESC, idx ASC). The idx tiebreak is NOT cosmetic:
 * two units at the same price are interchangeable for the TOTAL, but not for
 * which line gets credited the free unit, and the client preview must credit
 * the same line or the cart shows a discount against the wrong row. A total
 * ordering here makes the whole plan deterministic from the inputs alone.
 *
 * Integer cents throughout — no division, no rounding, so there is nothing for
 * the client mirror to round differently. Odd unit counts round DOWN in the
 * buyer's disfavour by construction (3 units → 1 free, 5 → 2 free), because a
 * trailing unpaired unit simply never lands on an odd index.
 */
export function pairFreeUnits(units: readonly BogoUnit[]): BogoPlanEntry[] {
  const sorted = [...units].sort((a, b) => (b.unit - a.unit) || (a.idx - b.idx));
  const freeByIdx = new Map<number, BogoPlanEntry>();
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

/** What one line is worth under each promo, once the server has resolved it. */
interface LineOffer {
  idx: number;
  packUnits: number;
  packValue: number;
  b2g1FreeUnits: number;
  b2g1Value: number;
  unit: number;
}

/** Wholesale pack value for `qty` units at `unit` cents: full cases first, then
 *  at most one half kit from the remainder (remainder < case size ⇒ 0 or 1).
 *  Per-pack rounding matches the client tile's displayed math. */
export function wholesalePackValue(qty: number, unit: number): { units: number; value: number } {
  const cases = Math.floor(qty / WHOLESALE_CASE.size);
  const rem = qty - cases * WHOLESALE_CASE.size;
  const halfKits = rem >= WHOLESALE_HALF.size ? 1 : 0;
  return {
    units: cases * WHOLESALE_CASE.size + halfKits * WHOLESALE_HALF.size,
    value:
      cases * Math.round((WHOLESALE_CASE.size * unit * WHOLESALE_CASE.percent) / 100) +
      halfKits * Math.round((WHOLESALE_HALF.size * unit * WHOLESALE_HALF.percent) / 100),
  };
}

/** Resolve one line against the catalog and price both promos for it. Returns
 *  null when the line is not eligible for either. */
function offerFor(
  line: PromoLine,
  idx: number,
  input: PromoPlanInput,
): LineOffer | null {
  const sku = line.sku;
  const qty = line.quantity;
  if (!sku || qty < B2G1_GROUP) return null;

  // The line must resolve to a real dose row, by the SAME rules and the SAME
  // text the price check used (name only — `note` is free text and used to be
  // able to flip B2G1 eligibility on its own). Lines with no variant row at all
  // (lab equipment prices per-sku on product_stock) get no automatic promo —
  // which is exactly the P0-3 rule, arrived at by the same door.
  const row = resolveVariantRow(sku, lineText(line), input.variantRows);
  if (row == null) return null;

  // The pack/free value is computed from the ADMIN price, never the client's.
  // A dose with no admin price is formula-priced on the client: there is no
  // server truth to discount from, so it gets no automatic promo.
  const unit = row.price_cents;
  if (unit == null || unit <= 0) return null;

  const fast = (row.on_hand ?? 0) > 0 || (row.inbound_units ?? 0) > 0;
  const orderable = fast || row.lead_days != null || row.price_cents != null;
  const isSlow = !fast && orderable;

  // Wholesale — server flag + admin price + the client's advertised floor.
  // Ship speed does NOT gate it: a case is sourced whole (mirrors wholesaleDoses).
  const eligible = row.wholesale_eligible === true && qty >= WHOLESALE_HALF.size;
  const pack = eligible ? wholesalePackValue(qty, unit) : { units: 0, value: 0 };

  // B2G1 — slow-ship only, promo live, sku not excluded.
  const b2g1FreeUnits = isSlow && input.promoLive && !input.excludedSkus.has(sku)
    ? Math.floor(qty / B2G1_GROUP)
    : 0;

  if (pack.value <= 0 && b2g1FreeUnits <= 0) return null;
  return {
    idx,
    packUnits: pack.units,
    packValue: pack.value,
    b2g1FreeUnits,
    b2g1Value: b2g1FreeUnits * unit,
    unit,
  };
}

/**
 * BOGO eligibility for one line, expanded into its individual units.
 *
 * Deliberately NOT folded into offerFor(): that function bails at
 * `qty < B2G1_GROUP`, and BOGO pairs ACROSS lines, so a qty-1 line is a real
 * candidate (it pairs with a qty-1 line elsewhere in the cart).
 *
 * Eligible = every one of:
 *   • members only — a guest's cart yields nothing (owner rule)
 *   • the promo is live and the sku isn't on the admin exclusion list
 *   • the line resolves to a real (sku, dose) variant row, by the SAME resolver
 *     and the SAME text the price check used. Laboratory equipment prices
 *     per-sku on product_stock and has no variant row at all, so it is excluded
 *     structurally here — the exclusion list carries it too, belt and braces.
 *   • that row carries an ADMIN price (never the client's `unit`)
 *   • the row has genuine 24-HOUR supply — on-hand or inbound. This is the
 *     owner's rationale ("he can only BOGO what he physically holds") and it is
 *     the exact INVERSE of B2G1's isSlow gate, which makes the two promos
 *     mutually exclusive per line by construction, not by arbitration.
 */
function bogoUnitsFor(
  line: PromoLine,
  idx: number,
  input: PromoPlanInput,
): BogoUnit[] {
  if (!input.isMember || !input.bogoLive) return [];
  const sku = line.sku;
  const qty = line.quantity;
  if (!sku || qty < 1) return [];
  if (input.bogoExcludedSkus?.has(sku)) return [];

  const row = resolveVariantRow(sku, lineText(line), input.variantRows);
  if (row == null) return [];

  const unit = row.price_cents;
  if (unit == null || unit <= 0) return [];

  const fast = (row.on_hand ?? 0) > 0 || (row.inbound_units ?? 0) > 0;
  if (!fast) return [];

  return Array.from({ length: qty }, () => ({ idx, unit }));
}

/**
 * Decide the automatic promos for an order.
 *
 * Wholesale is ACCOUNT-GATED (owner's rule): only a verified signed-in buyer
 * transacts at case pricing. The two promos never stack on one line — whichever
 * is worth MORE to the buyer claims it.
 *
 * BOGO (launch promo) is arbitrated ORDER-WIDE rather than per line, because it
 * pairs units across lines and so has no per-line value to compare. Precedence,
 * top down: wholesale/bundle finality (handler) → the larger of {BOGO, B2G1} →
 * the larger of {winner, account %} (handler). Ties go to BOGO — same shape as
 * the 2026-07-22 "larger wins, tie → B2G1" rule this extends.
 */
export function buildPromoPlans(input: PromoPlanInput): PromoPlan {
  const wholesalePlan: WholesalePlanEntry[] = [];
  const b2g1FreePlan: B2G1PlanEntry[] = [];

  input.lines.forEach((line, idx) => {
    const offer = offerFor(line, idx, input);
    if (offer == null) return;

    // Account gate (P0-4) — only a verified signed-in buyer transacts at case
    // pricing, so a guest's wholesale offer is simply worth nothing and loses
    // the arbitration below. It used to be applied AFTER arbitration, by
    // emptying the plan: a line that had already beaten B2G1 on value was
    // dropped and fell back to NOTHING, discarding the discount it had earned.
    // That is the $240 cliff — guest qty 9 = $369.99, qty 10 = $609.99 — and it
    // started at qty 5, where the half kit beat one free vial.
    //
    // Arbitrating once, on the values that actually apply to THIS buyer, is what
    // makes the result monotonic: adding a unit can never cost more than a unit.
    const packValue = input.isMember ? offer.packValue : 0;

    if (packValue > 0 && packValue >= offer.b2g1Value) {
      wholesalePlan.push({ idx: offer.idx, units: offer.packUnits, value: packValue });
    } else if (offer.b2g1FreeUnits > 0) {
      b2g1FreePlan.push({ idx: offer.idx, freeUnits: offer.b2g1FreeUnits, unit: offer.unit });
    }
  });

  // ── BOGO ────────────────────────────────────────────────────────────────
  // Paired over EVERY eligible line, including lines that also won wholesale.
  //
  // An earlier version held wholesale-winning lines OUT of the pairing, on the
  // reasoning that a case is sourced whole rather than pulled off the 24-hour
  // shelf. That was wrong, and wrong in the buyer's disfavour at a very
  // reachable quantity: 5 units of one 24-hour dose is exactly the wholesale
  // half-kit floor, so wholesale claimed the line at 27% (5 × unit × 0.27)
  // while BOGO on the same 5 units is worth 2 free units = 40%. Holding the
  // line out made its BOGO value zero, so the arbitration below had nothing to
  // compare and wholesale won by default — costing the buyer 13% of the line.
  //
  // Pairing over everything and arbitrating on TOTALS is what actually
  // implements "larger wins". The two plans are mutually exclusive order-wide,
  // so no unit is ever discounted twice.
  const bogoUnits: BogoUnit[] = [];
  input.lines.forEach((line, idx) => {
    bogoUnits.push(...bogoUnitsFor(line, idx, input));
  });
  let bogoFreePlan = pairFreeUnits(bogoUnits);

  // Order-wide arbitration against wholesale. Wholesale is a FINAL price the
  // handler enforces order-wide, so comparing order totals is the right grain.
  // Tie → wholesale, preserving shipped behavior (and costing nothing either
  // way). Dropping wholesale when BOGO wins is monotonic: the comparison is
  // between the two order totals, so the buyer is never worse off, even when a
  // wholesale line was not itself BOGO-eligible.
  const bogoValue = freePlanValue(bogoFreePlan);
  if (bogoValue > 0 && wholesalePlan.length > 0) {
    if (bogoValue > wholesalePlan.reduce((sum, p) => sum + p.value, 0)) {
      wholesalePlan.length = 0;
    } else {
      bogoFreePlan = [];
    }
  }

  // BOGO vs B2G1 — they can never collide on ONE line (24-hour vs sourced),
  // but a mixed cart can earn both. Owner's no-stack rule: the single larger
  // discount applies, tie → BOGO.
  const finalBogoValue = freePlanValue(bogoFreePlan);
  if (finalBogoValue > 0 && b2g1FreePlan.length > 0) {
    if (finalBogoValue >= freePlanValue(b2g1FreePlan)) b2g1FreePlan.length = 0;
    else bogoFreePlan = [];
  }

  return { wholesalePlan, b2g1FreePlan, bogoFreePlan };
}
