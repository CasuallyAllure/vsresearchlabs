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

export interface PromoPlanInput {
  lines: readonly PromoLine[];
  variantRows: readonly VariantPromoRow[];
  /** promo_settings.b2g1_enabled, honouring b2g1_ends_at. */
  promoLive: boolean;
  /** promo_settings.b2g1_excluded_skus. */
  excludedSkus: ReadonlySet<string>;
  /** Resolved from the verified JWT — never from the payload. */
  isMember: boolean;
}

export interface PromoPlan {
  wholesalePlan: WholesalePlanEntry[];
  b2g1FreePlan: B2G1PlanEntry[];
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
 * Decide the automatic promos for an order.
 *
 * Wholesale is ACCOUNT-GATED (owner's rule): only a verified signed-in buyer
 * transacts at case pricing. The two promos never stack on one line — whichever
 * is worth MORE to the buyer claims it.
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

  return { wholesalePlan, b2g1FreePlan };
}
