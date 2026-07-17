/**
 * Pure order-totals engine for place-order — the authoritative discount
 * stacking order and the applied-coupon label builder.
 *
 * Deliberately free of Deno globals and remote imports (like priceCheck.ts /
 * promoPlan.ts) so vitest can pin the money math (tests/unit/orderTotals.test.ts)
 * and tsc can typecheck it.
 *
 * Stacking order (do NOT reorder — mirrored by src/lib/coupons.ts::
 * couponBreakdown client-side and recompute_order_totals migrations 045/052):
 *   Pass 1  flat code reductions (free_item / fixed) — accumulated by the
 *           caller's validate_coupon loop, passed in as flatCentsFromCodes
 *   →       wholesale pack value (flat)
 *   →       bundle pair value (flat)
 *   →       B2G1 freed units (flat)
 *   →       reward voucher: percent of the single highest unit price (flat),
 *           with the unit's remaining (100−percent)% FENCED off the percent base
 *   Pass 2a account percent on the post-flat base minus the fence
 *   Pass 2b code percents off that same base, running cap after the account slice
 *   →       discount capped at gross; shipping rides on top of the discounted
 *           subtotal (never discounted, never in the percent base).
 */

export interface WholesalePlanLine {
  value: number;
  units: number;
}

export interface B2G1PlanLine {
  freeUnits: number;
  unit: number;
}

/** An appliedList entry of kind "percent" — fullDiscount is the code's
 *  discount off the FULL subtotal (validate_coupon's number); pass 2 re-scales
 *  it onto the post-flat base. */
export interface PercentCodeEntry {
  fullDiscount: number;
}

export interface OrderTotalsInput {
  grossSubtotalCents: number;
  shippingCents: number;
  /** flatCents accumulated by the caller's Pass 1 (free_item + fixed codes). */
  flatCentsFromCodes: number;
  /** Clamped unit price of every cart line (appended $0 free lines included —
   *  they never win the reward max). */
  itemUnitPricesCents: readonly number[];
  wholesalePlan: readonly WholesalePlanLine[];
  bundleValue: number;
  b2g1FreePlan: readonly B2G1PlanLine[];
  /** Reward voucher percent, or null when no active voucher applies. */
  rewardPercent: number | null;
  /** Account discount percent, or null when no entitlement applies. */
  accountPercent: number | null;
  /** appliedList entries with kind === "percent", in applied order. */
  percentEntries: readonly PercentCodeEntry[];
}

export interface OrderTotalsResult {
  wholesaleReduction: number;
  wholesaleUnits: number;
  bundleReduction: number;
  b2g1Reduction: number;
  b2g1FreeUnits: number;
  rewardReduction: number;
  /** The reward-discounted unit's remaining value, fenced off the percent base. */
  rewardRemainder: number;
  accountCents: number;
  /** Contribution per percentEntries element, same order — the caller writes
   *  these back onto appliedList[].contribution. */
  percentContributions: number[];
  discountCents: number;
  totalCents: number;
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotalsResult {
  const { grossSubtotalCents, shippingCents } = input;
  let flatCents = input.flatCentsFromCodes;

  // Wholesale pack pricing — apply the precomputed plan as a FLAT reduction
  // (before percents, like B2G1) so no percent code can compound on the
  // packed units. Capped at the remaining subtotal.
  let wholesaleReduction = 0;
  let wholesaleUnits = 0;
  for (const p of input.wholesalePlan) {
    const value = Math.max(Math.min(p.value, grossSubtotalCents - flatCents), 0);
    wholesaleReduction += value;
    wholesaleUnits += p.units;
    flatCents += value;
  }

  // Bundle promo — apply the precomputed pair discount as a FLAT reduction
  // (before percents, like wholesale), capped at the remaining subtotal.
  let bundleReduction = 0;
  if (input.bundleValue > 0) {
    bundleReduction = Math.max(Math.min(input.bundleValue, grossSubtotalCents - flatCents), 0);
    flatCents += bundleReduction;
  }

  // Buy-2-Get-1-Free — apply the precomputed plan as a FLAT reduction (before
  // percents, like a free item) so no percent code can discount the freed units.
  let b2g1Reduction = 0;
  let b2g1FreeUnits = 0;
  for (const p of input.b2g1FreePlan) {
    const value = Math.max(Math.min(p.freeUnits * p.unit, grossSubtotalCents - flatCents), 0);
    b2g1Reduction += value;
    b2g1FreeUnits += p.freeUnits;
    flatCents += value;
  }

  // Reward voucher — a FLAT reduction of `percent`% of the single highest unit
  // price in the cart ("40% off one item"), applied like a fixed coupon
  // (reduces the base before percents), capped at the remaining subtotal.
  let rewardReduction = 0;
  let rewardRemainder = 0;
  if (input.rewardPercent != null) {
    const maxUnit = input.itemUnitPricesCents.reduce((m, u) => Math.max(m, u), 0);
    const raw = Math.round((maxUnit * input.rewardPercent) / 100);
    rewardReduction = Math.max(Math.min(raw, grossSubtotalCents - flatCents), 0);
    flatCents += rewardReduction;
    // The discounted unit is fully spoken for: its remaining (100−percent)%
    // is FENCED OFF from account/code percent discounts, so a 15% code can't
    // compound on top of the 40% item — it only sees the rest of the cart.
    // Mirrored in recompute_order_totals (migration 052).
    rewardRemainder = Math.max(maxUnit - rewardReduction, 0);
  }

  // Pass 2 — percents apply to the base AFTER the flat reductions, minus the
  // reward item's fenced remainder. A percent's discount off the full subtotal,
  // scaled by (percentBase / subtotal), equals `percent × percentBase`.
  const baseAfterFlat = Math.max(grossSubtotalCents - flatCents, 0);
  const percentBase = Math.max(baseAfterFlat - rewardRemainder, 0);
  let percentUsed = 0;

  // Pass 2a — the ACCOUNT discount applies first on the same post-flat base;
  // code percents (pass 2b below) keep computing off that same base but their
  // running cap now starts after the account slice.
  let accountCents = 0;
  if (input.accountPercent != null) {
    accountCents = Math.max(
      Math.min(Math.round((percentBase * input.accountPercent) / 100), percentBase),
      0,
    );
    percentUsed += accountCents;
  }

  // Pass 2b — each code percent off the same base, capped at what remains.
  const percentContributions: number[] = [];
  for (const entry of input.percentEntries) {
    const scaled = grossSubtotalCents > 0
      ? Math.round((entry.fullDiscount * percentBase) / grossSubtotalCents)
      : 0;
    const contribution = Math.max(Math.min(scaled, percentBase - percentUsed), 0);
    percentContributions.push(contribution);
    percentUsed += contribution;
  }

  const discountCents = Math.min(flatCents + percentUsed, grossSubtotalCents);
  // Shipping rides on top of the discounted subtotal — discounts never eat the
  // shipping fee, and no percent code can discount it (it isn't in the base).
  const totalCents = grossSubtotalCents - discountCents + shippingCents;

  return {
    wholesaleReduction,
    wholesaleUnits,
    bundleReduction,
    b2g1Reduction,
    b2g1FreeUnits,
    rewardReduction,
    rewardRemainder,
    accountCents,
    percentContributions,
    discountCents,
    totalCents,
  };
}

export interface CouponLabelParts {
  /** The synthetic account code (e.g. ACCT-LIFETIME), or null when none. */
  accountCode: string | null;
  rewardApplied: boolean;
  wholesaleApplied: boolean;
  bundleApplied: boolean;
  b2g1Applied: boolean;
  /** The user-entered code list (initial build: every applied code; rollback
   *  rebuild: the redemption survivors), in applied order. */
  codes: readonly string[];
  rewardCode: string;
  wholesaleCode: string;
  bundleCode: string;
  b2g1Code: string;
}

/**
 * Comma-joined label for the order row, invoice, and emails (all read this).
 * The synthetic account/reward/promo codes lead, matching the order_coupons
 * rows. One shared builder for BOTH the initial label and the post-rollback
 * survivor rebuild — the two must stay byte-identical in shape, or admin sees
 * a discount larger than the labeled codes explain.
 */
export function buildAppliedCouponLabel(parts: CouponLabelParts): string | null {
  const ordered = [
    ...(parts.accountCode ? [parts.accountCode] : []),
    ...(parts.rewardApplied ? [parts.rewardCode] : []),
    ...(parts.wholesaleApplied ? [parts.wholesaleCode] : []),
    ...(parts.bundleApplied ? [parts.bundleCode] : []),
    ...(parts.b2g1Applied ? [parts.b2g1Code] : []),
    ...parts.codes,
  ];
  return ordered.length ? ordered.join(", ") : null;
}

/**
 * Normalize the buyer's raw coupon-code input: trim, upper-case, cap each code
 * at 40 chars, drop empties, dedupe, and cap the count at 10 so a payload
 * can't spam validation.
 */
export function normalizeCouponCodes(rawCodes: readonly unknown[]): string[] {
  return [...new Set(
    rawCodes
      .map((c) => String(c ?? "").trim().toUpperCase().slice(0, 40))
      .filter((c) => c.length > 0),
  )].slice(0, 10);
}
