/**
 * Unit tests for supabase/functions/place-order/orderTotals.ts — the
 * authoritative server money engine: computeOrderTotals() stacking order,
 * buildAppliedCouponLabel(), and normalizeCouponCodes().
 *
 * The stacking order (flat codes → wholesale → bundle → B2G1 → reward fence →
 * account percent → code percents → cap at gross → shipping on top) is pinned
 * here so nobody reorders it; the parity block at the bottom proves the server
 * math matches the client mirror (src/lib/coupons.ts::couponBreakdown) on the
 * scenarios both sides can express.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  buildAppliedCouponLabel,
  computeOrderTotals,
  flatContribution,
  normalizeCouponCodes,
  repriceAfterFailedRedemptions,
  sanitizeFixedDiscountCents,
  type CouponLabelParts,
  type OrderTotalsInput,
} from '../../supabase/functions/place-order/orderTotals';
import type { AppliedCoupon } from '../../src/hooks/useCart';
import { makeCartItem } from '../fixtures/product';

// The parity block imports the client mirror (src/lib/coupons.ts), whose module
// graph pulls in the supabase singleton. couponBreakdown() never touches it —
// mock it out so no client is ever constructed in this suite.
vi.mock('../../src/lib/supabase', () => ({ supabase: null }));
import { couponBreakdown, type AccountDiscountPreview } from '../../src/lib/coupons';

/** A quiet order: $100 gross, free shipping, no promos, no codes. */
const input = (over: Partial<OrderTotalsInput> = {}): OrderTotalsInput => ({
  grossSubtotalCents: 10_000,
  shippingCents: 0,
  flatCentsFromCodes: 0,
  itemUnitPricesCents: [],
  wholesalePlan: [],
  bundleValue: 0,
  b2g1FreePlan: [],
  rewardPercent: null,
  accountPercent: null,
  percentEntries: [],
  ...over,
});

describe('computeOrderTotals — no discounts', () => {
  test('empty plans and null percents produce a zero discount and gross + shipping total', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({ shippingCents: 999 }));

    // Assert — every channel reports zero.
    expect(result).toEqual({
      wholesaleReduction: 0,
      wholesaleUnits: 0,
      bundleReduction: 0,
      b2g1Reduction: 0,
      b2g1FreeUnits: 0,
      rewardReduction: 0,
      rewardRemainder: 0,
      accountCents: 0,
      percentContributions: [],
      discountCents: 0,
      totalCents: 10_999,
    });
  });
});

describe('computeOrderTotals — pass 1 flat code reductions', () => {
  test('flatCentsFromCodes seeds the flat base directly', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({ flatCentsFromCodes: 2_000 }));

    // Assert
    expect(result.discountCents).toBe(2_000);
    expect(result.totalCents).toBe(8_000);
  });

  test('a flat overshoot caps the discount at gross, never below a $0 order', () => {
    // Arrange / Act — codes worth more than the whole cart.
    const result = computeOrderTotals(input({ flatCentsFromCodes: 25_000, shippingCents: 999 }));

    // Assert — discount = min(25000, 10000); shipping still owed.
    expect(result.discountCents).toBe(10_000);
    expect(result.totalCents).toBe(999);
  });
});

describe('computeOrderTotals — wholesale plan', () => {
  test('sums values and units across plan lines', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      wholesalePlan: [
        { value: 3_000, units: 10 },
        { value: 2_000, units: 5 },
      ],
    }));

    // Assert
    expect(result.wholesaleReduction).toBe(5_000);
    expect(result.wholesaleUnits).toBe(15);
    expect(result.discountCents).toBe(5_000);
  });

  test('each line caps at the remaining subtotal after earlier reductions', () => {
    // Arrange / Act — flat codes leave only 2000 of room; line 1 takes 1500,
    // line 2 wants 4000 but only 500 remains.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 5_000,
      flatCentsFromCodes: 3_000,
      wholesalePlan: [
        { value: 1_500, units: 5 },
        { value: 4_000, units: 10 },
      ],
    }));

    // Assert
    expect(result.wholesaleReduction).toBe(2_000); // 1500 + 500
    expect(result.discountCents).toBe(5_000);
    expect(result.totalCents).toBe(0);
  });

  test('a plan line arriving after the subtotal is exhausted floors at zero, never negative', () => {
    // Arrange / Act — flat already exceeds gross; min() goes negative, max() floors it.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 1_000,
      flatCentsFromCodes: 1_500,
      wholesalePlan: [{ value: 500, units: 5 }],
    }));

    // Assert — reduction is 0; units are still counted (the plan claimed them).
    expect(result.wholesaleReduction).toBe(0);
    expect(result.wholesaleUnits).toBe(5);
    expect(result.discountCents).toBe(1_000);
  });
});

describe('computeOrderTotals — bundle value', () => {
  test('applies after wholesale as a flat reduction', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      wholesalePlan: [{ value: 4_000, units: 10 }],
      bundleValue: 3_000,
    }));

    // Assert
    expect(result.bundleReduction).toBe(3_000);
    expect(result.discountCents).toBe(7_000);
  });

  test('caps at the remaining subtotal', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      grossSubtotalCents: 5_000,
      flatCentsFromCodes: 4_000,
      bundleValue: 3_000,
    }));

    // Assert
    expect(result.bundleReduction).toBe(1_000);
    expect(result.discountCents).toBe(5_000);
  });

  test('floors at zero when the subtotal is already spoken for', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      grossSubtotalCents: 1_000,
      flatCentsFromCodes: 1_500,
      bundleValue: 500,
    }));

    // Assert
    expect(result.bundleReduction).toBe(0);
  });

  test('a zero bundleValue leaves the bundle channel untouched', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({ bundleValue: 0 }));

    // Assert
    expect(result.bundleReduction).toBe(0);
    expect(result.discountCents).toBe(0);
  });
});

describe('computeOrderTotals — B2G1 free plan', () => {
  test('values each line at freeUnits × unit and sums the freed units', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      b2g1FreePlan: [
        { freeUnits: 1, unit: 6_000 },
        { freeUnits: 2, unit: 500 },
      ],
    }));

    // Assert
    expect(result.b2g1Reduction).toBe(7_000);
    expect(result.b2g1FreeUnits).toBe(3);
    expect(result.discountCents).toBe(7_000);
  });

  test('caps at the remaining subtotal', () => {
    // Arrange / Act — 2 free × $30 = $60 against a $50 cart.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 5_000,
      b2g1FreePlan: [{ freeUnits: 2, unit: 3_000 }],
    }));

    // Assert
    expect(result.b2g1Reduction).toBe(5_000);
    expect(result.b2g1FreeUnits).toBe(2);
  });

  test('floors at zero when earlier reductions already exceed gross', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      grossSubtotalCents: 1_000,
      flatCentsFromCodes: 2_000,
      b2g1FreePlan: [{ freeUnits: 1, unit: 500 }],
    }));

    // Assert
    expect(result.b2g1Reduction).toBe(0);
  });
});

describe('computeOrderTotals — reward voucher (flat + fence)', () => {
  test('takes percent of the single HIGHEST unit price and fences the remainder', () => {
    // Arrange / Act — 40% of the $60 max unit, not the $10 or $25 ones.
    const result = computeOrderTotals(input({
      itemUnitPricesCents: [1_000, 6_000, 2_500],
      rewardPercent: 40,
    }));

    // Assert
    expect(result.rewardReduction).toBe(2_400);
    expect(result.rewardRemainder).toBe(3_600); // the unit's other 60%
    expect(result.discountCents).toBe(2_400);
  });

  test('rounds the reward to the nearest cent', () => {
    // Arrange / Act — 33% of 1015 = 334.95 → 335.
    const result = computeOrderTotals(input({
      itemUnitPricesCents: [1_015],
      rewardPercent: 33,
    }));

    // Assert
    expect(result.rewardReduction).toBe(335);
    expect(result.rewardRemainder).toBe(680);
  });

  test('the fence keeps percent discounts off the reward item: account percent sees only the rest of the cart', () => {
    // Arrange / Act — single $60 item, 40% reward. baseAfterFlat = 3600, but
    // the fenced remainder is also 3600 → percentBase = 0, so the 10% account
    // discount (and any code percent) gets nothing to compound on.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 6_000,
      itemUnitPricesCents: [6_000],
      rewardPercent: 40,
      accountPercent: 10,
      percentEntries: [{ fullDiscount: 600 }],
    }));

    // Assert
    expect(result.rewardReduction).toBe(2_400);
    expect(result.rewardRemainder).toBe(3_600);
    expect(result.accountCents).toBe(0);
    expect(result.percentContributions).toEqual([0]);
    expect(result.discountCents).toBe(2_400);
  });

  test('caps at the remaining subtotal and still fences the unit remainder', () => {
    // Arrange / Act — a $50 max unit in a $20 cart (inconsistent but must not
    // break): raw 2500 capped to 2000; remainder 5000-2000=3000 collapses the
    // percent base to 0 via its own floor.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 2_000,
      itemUnitPricesCents: [5_000],
      rewardPercent: 50,
      accountPercent: 50,
      shippingCents: 999,
    }));

    // Assert
    expect(result.rewardReduction).toBe(2_000);
    expect(result.rewardRemainder).toBe(3_000);
    expect(result.accountCents).toBe(0);
    expect(result.discountCents).toBe(2_000);
    expect(result.totalCents).toBe(999); // shipping survives a fully-discounted cart
  });

  test('all-zero unit prices yield a zero reward and zero fence', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      itemUnitPricesCents: [0, 0],
      rewardPercent: 40,
    }));

    // Assert
    expect(result.rewardReduction).toBe(0);
    expect(result.rewardRemainder).toBe(0);
  });

  test('an empty unit-price list with an active voucher yields zero (reduce seed)', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      itemUnitPricesCents: [],
      rewardPercent: 40,
    }));

    // Assert
    expect(result.rewardReduction).toBe(0);
    expect(result.rewardRemainder).toBe(0);
    expect(result.discountCents).toBe(0);
  });
});

describe('computeOrderTotals — pass 2a account percent', () => {
  test('applies on the post-flat base, rounded', () => {
    // Arrange / Act — base 8335 after a 1665 flat; 33% = 2750.55 → 2751.
    const result = computeOrderTotals(input({
      flatCentsFromCodes: 1_665,
      accountPercent: 33,
    }));

    // Assert
    expect(result.accountCents).toBe(2_751);
    expect(result.discountCents).toBe(4_416);
  });

  test('caps at the percent base when the percent overshoots 100', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      grossSubtotalCents: 5_000,
      accountPercent: 150,
    }));

    // Assert
    expect(result.accountCents).toBe(5_000);
    expect(result.discountCents).toBe(5_000);
  });

  test('an accountPercent of 0 is active but contributes nothing', () => {
    // Arrange / Act — != null treats 0 as an entitlement; the math still zeroes it.
    const result = computeOrderTotals(input({ accountPercent: 0 }));

    // Assert
    expect(result.accountCents).toBe(0);
    expect(result.discountCents).toBe(0);
  });
});

describe('computeOrderTotals — pass 2b code percents', () => {
  test('scales each entry by percentBase / grossSubtotal', () => {
    // Arrange / Act — a 10% code (fullDiscount 1000 off the full 10000) after a
    // 2000 flat: base 8000 → contribution round(1000 × 8000 / 10000) = 800.
    const result = computeOrderTotals(input({
      flatCentsFromCodes: 2_000,
      percentEntries: [{ fullDiscount: 1_000 }],
    }));

    // Assert
    expect(result.percentContributions).toEqual([800]);
    expect(result.discountCents).toBe(2_800);
  });

  test('entries apply in order and the first consumes the running cap', () => {
    // Arrange / Act — two 60% codes on 10000: first takes 6000, second is
    // capped to the remaining 4000 room.
    const result = computeOrderTotals(input({
      percentEntries: [{ fullDiscount: 6_000 }, { fullDiscount: 6_000 }],
    }));

    // Assert
    expect(result.percentContributions).toEqual([6_000, 4_000]);
    expect(result.discountCents).toBe(10_000);
  });

  test('the account slice starts the running cap before any code percent', () => {
    // Arrange / Act — account 15% (3000) first; a 25% code (5000) fits inside
    // the remaining 17000 room untouched.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 20_000,
      accountPercent: 15,
      percentEntries: [{ fullDiscount: 5_000 }],
    }));

    // Assert
    expect(result.accountCents).toBe(3_000);
    expect(result.percentContributions).toEqual([5_000]);
    expect(result.discountCents).toBe(8_000);
  });

  test('a zero gross subtotal short-circuits the scaling (no divide by zero)', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      grossSubtotalCents: 0,
      shippingCents: 999,
      percentEntries: [{ fullDiscount: 500 }],
    }));

    // Assert
    expect(result.percentContributions).toEqual([0]);
    expect(result.discountCents).toBe(0);
    expect(result.totalCents).toBe(999);
  });

  test('a negative fullDiscount floors at zero instead of inflating the total', () => {
    // Arrange / Act — malformed entry must never turn into a surcharge-eraser.
    const result = computeOrderTotals(input({
      percentEntries: [{ fullDiscount: -1_000 }],
    }));

    // Assert
    expect(result.percentContributions).toEqual([0]);
    expect(result.discountCents).toBe(0);
  });
});

describe('computeOrderTotals — full stack integration', () => {
  test('every channel applies in the documented order on one order', () => {
    // Arrange — $1000 cart, $9.99 shipping, and every discount at once.
    const result = computeOrderTotals(input({
      grossSubtotalCents: 100_000,
      shippingCents: 999,
      flatCentsFromCodes: 5_000, // pass 1 codes
      wholesalePlan: [{ value: 10_000, units: 10 }], // flat → 15000
      bundleValue: 3_000, // flat → 18000
      b2g1FreePlan: [{ freeUnits: 2, unit: 1_000 }], // flat → 20000
      itemUnitPricesCents: [6_000, 2_000],
      rewardPercent: 40, // 2400 off the 6000 unit, flat → 22400; fence 3600
      accountPercent: 10, // 10% of percentBase 74000 = 7400
      percentEntries: [{ fullDiscount: 10_000 }], // round(10000×74000/100000) = 7400
    }));

    // Assert
    expect(result).toEqual({
      wholesaleReduction: 10_000,
      wholesaleUnits: 10,
      bundleReduction: 3_000,
      b2g1Reduction: 2_000,
      b2g1FreeUnits: 2,
      rewardReduction: 2_400,
      rewardRemainder: 3_600,
      accountCents: 7_400,
      percentContributions: [7_400],
      discountCents: 37_200,
      totalCents: 63_799, // 100000 − 37200 + 999
    });
  });

  test('the discount can never exceed gross even when every channel overshoots', () => {
    // Arrange / Act
    const result = computeOrderTotals(input({
      grossSubtotalCents: 5_000,
      shippingCents: 999,
      flatCentsFromCodes: 4_000,
      wholesalePlan: [{ value: 2_000, units: 5 }],
      bundleValue: 2_000,
      b2g1FreePlan: [{ freeUnits: 3, unit: 1_000 }],
      itemUnitPricesCents: [1_000],
      rewardPercent: 40,
      accountPercent: 100,
      percentEntries: [{ fullDiscount: 5_000 }],
    }));

    // Assert — gross is the hard ceiling; the buyer still owes shipping.
    expect(result.discountCents).toBe(5_000);
    expect(result.totalCents).toBe(999);
  });
});

describe('flatContribution — shared Pass-1 cap rule', () => {
  test('returns the full value when the remaining subtotal has room', () => {
    // Arrange / Act / Assert — 2000 requested, 10000 - 3000 = 7000 remains.
    expect(flatContribution(2_000, 10_000, 3_000)).toBe(2_000);
  });

  test('caps at the remaining subtotal when the value overshoots it', () => {
    // Arrange / Act / Assert — 5000 requested but only 10000 - 8000 = 2000 remains.
    expect(flatContribution(5_000, 10_000, 8_000)).toBe(2_000);
  });

  test('an exact fit consumes precisely the remaining subtotal', () => {
    // Arrange / Act / Assert — boundary: value === remaining.
    expect(flatContribution(2_000, 10_000, 8_000)).toBe(2_000);
  });

  test('floors at zero when the flats so far already exceed gross', () => {
    // Arrange / Act / Assert — remaining is negative; min() would go negative,
    // the outer max() floors it.
    expect(flatContribution(500, 1_000, 1_500)).toBe(0);
  });

  test('a negative value floors at zero, never inflating the subtotal', () => {
    // Arrange / Act / Assert
    expect(flatContribution(-300, 10_000, 0)).toBe(0);
  });
});

describe('sanitizeFixedDiscountCents — RPC input hardening', () => {
  test('passes an ordinary integer through unchanged', () => {
    expect(sanitizeFixedDiscountCents(1_500)).toBe(1_500);
  });

  test('floors a fractional cent value', () => {
    expect(sanitizeFixedDiscountCents(12.9)).toBe(12);
  });

  test('treats NaN as zero', () => {
    expect(sanitizeFixedDiscountCents(NaN)).toBe(0);
  });

  test('treats Infinity as zero', () => {
    expect(sanitizeFixedDiscountCents(Infinity)).toBe(0);
  });

  test('treats -Infinity as zero', () => {
    expect(sanitizeFixedDiscountCents(-Infinity)).toBe(0);
  });

  test('clamps a negative value to zero (a discount can never be a surcharge)', () => {
    expect(sanitizeFixedDiscountCents(-500)).toBe(0);
  });

  test('a small negative fraction floors to -1 then clamps to zero', () => {
    expect(sanitizeFixedDiscountCents(-0.5)).toBe(0);
  });

  test('treats null as zero via the ?? guard', () => {
    expect(sanitizeFixedDiscountCents(null)).toBe(0);
  });

  test('treats undefined as zero via the ?? guard', () => {
    expect(sanitizeFixedDiscountCents(undefined)).toBe(0);
  });

  test('coerces a numeric string and floors it', () => {
    expect(sanitizeFixedDiscountCents('1234.7')).toBe(1_234);
  });

  test('treats a non-numeric string as zero', () => {
    expect(sanitizeFixedDiscountCents('not-a-number')).toBe(0);
  });
});

describe('repriceAfterFailedRedemptions — redemption rollback', () => {
  test('removes exactly the failed contributions from the discount', () => {
    // Arrange / Act — a 5000 discount loses two failed codes worth 1200 + 800.
    const result = repriceAfterFailedRedemptions({
      discountCents: 5_000,
      failedContributions: [1_200, 800],
      grossSubtotalCents: 10_000,
      shippingCents: 0,
    });

    // Assert
    expect(result).toEqual({ discountCents: 3_000, totalCents: 7_000 });
  });

  test('floors the discount at zero when the failed contributions exceed it', () => {
    // Arrange / Act — bookkeeping drift must never produce a negative discount.
    const result = repriceAfterFailedRedemptions({
      discountCents: 1_000,
      failedContributions: [800, 700],
      grossSubtotalCents: 10_000,
      shippingCents: 0,
    });

    // Assert
    expect(result).toEqual({ discountCents: 0, totalCents: 10_000 });
  });

  test('an empty failedContributions list is a no-op reprice', () => {
    // Arrange / Act
    const result = repriceAfterFailedRedemptions({
      discountCents: 2_500,
      failedContributions: [],
      grossSubtotalCents: 10_000,
      shippingCents: 0,
    });

    // Assert — same discount and total as before the rollback.
    expect(result).toEqual({ discountCents: 2_500, totalCents: 7_500 });
  });

  test('rebuilds the total on the shipping-on-top rule computeOrderTotals uses', () => {
    // Arrange / Act — shipping is never discounted, so it rides on the
    // repriced subtotal exactly as in the initial totals.
    const result = repriceAfterFailedRedemptions({
      discountCents: 10_000,
      failedContributions: [4_000],
      grossSubtotalCents: 10_000,
      shippingCents: 999,
    });

    // Assert — 10000 − 6000 + 999.
    expect(result).toEqual({ discountCents: 6_000, totalCents: 4_999 });
  });
});

// ---------------------------------------------------------------------------
// Parity with the client mirror — src/lib/coupons.ts::couponBreakdown.
// Both sides must bill/preview the SAME discount for scenarios both can
// express (no promos, no reward: percentBase === baseAfterFlat, and the
// server's fullDiscount×base/gross scaling equals the client's base×percent).
// ---------------------------------------------------------------------------

function percentCoupon(code: string, percent: number): AppliedCoupon {
  return {
    code,
    kind: 'percent',
    percent,
    amountCents: null,
    freeSku: null,
    freeDose: null,
    freeLabel: null,
    minSubtotalCents: 0,
    requiresAccount: false,
  };
}

function fixedCoupon(code: string, amountCents: number): AppliedCoupon {
  return { ...percentCoupon(code, 0), kind: 'fixed', percent: null, amountCents };
}

function freeItemCoupon(code: string, freeSku: string): AppliedCoupon {
  return { ...percentCoupon(code, 0), kind: 'free_item', percent: null, freeSku };
}

describe('computeOrderTotals — parity with couponBreakdown (client mirror)', () => {
  test('fixed + percent stack: mirrors coupons.test.ts "a fixed coupon and a percent coupon stack"', () => {
    // Arrange — FLAT20 ($20 fixed) + SAVE10 (10%) on a $100 subtotal.
    const gross = 10_000;
    const client = couponBreakdown(
      [fixedCoupon('FLAT20', 2_000), percentCoupon('SAVE10', 10)],
      gross,
    );
    // Server equivalents: pass 1 accumulated the fixed code; validate_coupon
    // reported the percent code's discount off the FULL subtotal.
    const server = computeOrderTotals(input({
      grossSubtotalCents: gross,
      flatCentsFromCodes: 2_000,
      percentEntries: [{ fullDiscount: Math.round((gross * 10) / 100) }],
    }));

    // Assert — both sides land on 2000 + 800 = 2800.
    expect(server.discountCents).toBe(client.total);
    expect(server.percentContributions[0]).toBe(client.perCode.SAVE10);
    expect(server.discountCents).toBe(2_800);
  });

  test('account + percent code: mirrors coupons.test.ts blueprint example (c) — $200 → $120 final', () => {
    // Arrange — business 15% account discount + Q3FAMFREN26 (25%) on $200.
    const gross = 20_000;
    const account: AccountDiscountPreview = { scope: 'business', percent: 15, label: 'Business 15%' };
    const client = couponBreakdown([percentCoupon('Q3FAMFREN26', 25)], gross, [], account);
    const server = computeOrderTotals(input({
      grossSubtotalCents: gross,
      accountPercent: 15,
      percentEntries: [{ fullDiscount: Math.round((gross * 25) / 100) }],
    }));

    // Assert — account 3000 first, code 5000 inside the remaining room; $120 final.
    expect(server.accountCents).toBe(client.accountCents);
    expect(server.percentContributions[0]).toBe(client.perCode.Q3FAMFREN26);
    expect(server.discountCents).toBe(client.total);
    expect(server.totalCents).toBe(gross - client.total);
    expect(server.totalCents).toBe(12_000);
  });

  test('free-item flat + account percent: mirrors coupons.test.ts blueprint example (b) — $110 → $72 final', () => {
    // Arrange — FREEBH2O frees a $30 line, then the 10% lifetime account
    // discount applies on the reduced $80 base.
    const gross = 11_000;
    const items = [makeCartItem({ sku: 'FREE-SKU', priceCents: 3_000 })];
    const account: AccountDiscountPreview = { scope: 'lifetime', percent: 10, label: 'Lifetime 10%' };
    const client = couponBreakdown([freeItemCoupon('FREEBH2O', 'FREE-SKU')], gross, items, account);
    // Server equivalent: pass 1 valued the free item's line at $30.
    const server = computeOrderTotals(input({
      grossSubtotalCents: gross,
      flatCentsFromCodes: client.perCode.FREEBH2O,
      accountPercent: 10,
    }));

    // Assert — 3000 flat + 800 account on both sides; $72.00 final.
    expect(client.perCode.FREEBH2O).toBe(3_000);
    expect(server.accountCents).toBe(client.accountCents);
    expect(server.discountCents).toBe(client.total);
    expect(server.totalCents).toBe(gross - client.total);
    expect(server.totalCents).toBe(7_200);
  });

  test('overshooting fixed codes: mirrors coupons.test.ts "total discount never exceeds the subtotal"', () => {
    // Arrange — BIG1 + BIG2 ($60 each) on $100. The client caps the second
    // code at add time; the server's pass-1 accumulator did the same, so the
    // seeded flat equals the client total and the gross cap agrees.
    const gross = 10_000;
    const client = couponBreakdown([fixedCoupon('BIG1', 6_000), fixedCoupon('BIG2', 6_000)], gross);
    const server = computeOrderTotals(input({
      grossSubtotalCents: gross,
      flatCentsFromCodes: client.perCode.BIG1 + client.perCode.BIG2,
    }));

    // Assert — both sides settle at the full subtotal, $0 order.
    expect(server.discountCents).toBe(client.total);
    expect(server.discountCents).toBe(10_000);
    expect(server.totalCents).toBe(0);
  });
});

describe('buildAppliedCouponLabel', () => {
  const parts = (over: Partial<CouponLabelParts> = {}): CouponLabelParts => ({
    accountCode: null,
    rewardApplied: false,
    wholesaleApplied: false,
    bundleApplied: false,
    b2g1Applied: false,
    codes: [],
    rewardCode: 'REWARD40',
    wholesaleCode: 'WHOLESALE',
    bundleCode: 'BUNDLE20',
    b2g1Code: 'B2G1',
    ...over,
  });

  test('returns null when nothing applied and no codes were entered', () => {
    expect(buildAppliedCouponLabel(parts())).toBeNull();
  });

  test('account code alone', () => {
    expect(buildAppliedCouponLabel(parts({ accountCode: 'ACCT-LIFETIME' }))).toBe('ACCT-LIFETIME');
  });

  test('reward flag alone emits the reward code', () => {
    expect(buildAppliedCouponLabel(parts({ rewardApplied: true }))).toBe('REWARD40');
  });

  test('wholesale flag alone emits the wholesale code', () => {
    expect(buildAppliedCouponLabel(parts({ wholesaleApplied: true }))).toBe('WHOLESALE');
  });

  test('bundle flag alone emits the bundle code', () => {
    expect(buildAppliedCouponLabel(parts({ bundleApplied: true }))).toBe('BUNDLE20');
  });

  test('b2g1 flag alone emits the b2g1 code', () => {
    expect(buildAppliedCouponLabel(parts({ b2g1Applied: true }))).toBe('B2G1');
  });

  test('user codes alone, joined in applied order', () => {
    expect(buildAppliedCouponLabel(parts({ codes: ['SAVE20', 'FLAT15'] }))).toBe('SAVE20, FLAT15');
  });

  test('full ordering: account, reward, wholesale, bundle, b2g1, then codes', () => {
    // Arrange / Act — everything at once; the synthetic codes must lead in this
    // exact order so the label matches the order_coupons rows.
    const label = buildAppliedCouponLabel(parts({
      accountCode: 'ACCT-BUSINESS',
      rewardApplied: true,
      wholesaleApplied: true,
      bundleApplied: true,
      b2g1Applied: true,
      codes: ['SAVE20', 'FLAT15'],
    }));

    // Assert
    expect(label).toBe('ACCT-BUSINESS, REWARD40, WHOLESALE, BUNDLE20, B2G1, SAVE20, FLAT15');
  });
});

describe('normalizeCouponCodes', () => {
  test('trims and upper-cases each code', () => {
    expect(normalizeCouponCodes(['  save20  ', 'flat15'])).toEqual(['SAVE20', 'FLAT15']);
  });

  test('caps each code at 40 characters', () => {
    // Arrange
    const long = 'a'.repeat(50);

    // Act / Assert
    expect(normalizeCouponCodes([long])).toEqual(['A'.repeat(40)]);
  });

  test('drops empty and whitespace-only entries', () => {
    expect(normalizeCouponCodes(['', '   ', 'OK'])).toEqual(['OK']);
  });

  test('coerces non-string entries via String() and drops null/undefined', () => {
    // Arrange / Act — null/undefined become "" (?? guard) and are filtered;
    // a number survives as its string form.
    expect(normalizeCouponCodes([null, undefined, 42, 'ok'])).toEqual(['42', 'OK']);
  });

  test('dedupes codes AFTER normalization', () => {
    // Arrange / Act — three spellings of the same code collapse to one.
    expect(normalizeCouponCodes(['save20', ' SAVE20 ', 'SAVE20'])).toEqual(['SAVE20']);
  });

  test('caps the list at 10 codes, keeping the first ten', () => {
    // Arrange
    const codes = Array.from({ length: 12 }, (_, i) => `CODE${i}`);

    // Act / Assert
    expect(normalizeCouponCodes(codes)).toEqual(codes.slice(0, 10));
  });

  test('dedupes before capping, so a duplicate does not waste a slot', () => {
    // Arrange — 12 entries, the first repeated: 11 unique → the 11th unique
    // code makes the cut because the dupe collapsed first.
    const codes = ['DUP', 'DUP', ...Array.from({ length: 10 }, (_, i) => `CODE${i}`)];

    // Act
    const result = normalizeCouponCodes(codes);

    // Assert
    expect(result).toHaveLength(10);
    expect(result[0]).toBe('DUP');
    expect(result[9]).toBe('CODE8');
  });

  test('preserves input order', () => {
    expect(normalizeCouponCodes(['B', 'A', 'C'])).toEqual(['B', 'A', 'C']);
  });
});
