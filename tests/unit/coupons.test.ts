/**
 * Unit tests for src/lib/coupons.ts — couponBreakdown().
 *
 * These recreate the blueprint's worked examples exactly
 * (docs/CUSTOMER_PORTAL_BLUEPRINT.md §3.3) so the cart preview math stays
 * provably in lockstep with the server-side compounding model
 * (recompute_order_totals / place-order).
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { AppliedCoupon } from '../../src/hooks/useCart';
import { makeCartItem } from '../fixtures/product';

// checkCoupon() calls the module-level `supabase` singleton, which DOES get
// initialized in this test env (.env carries real project creds — see
// src/lib/supabase.ts). Mock the seam so the RPC branches are deterministic
// and no test ever makes a real network call to production Supabase.
const rpcMock = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  couponBreakdown,
  checkCoupon,
  freeItemLineValue,
  couponStillQualifies,
  submittableCouponCodes,
  type AccountDiscountPreview,
} from '../../src/lib/coupons';

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
  return {
    code,
    kind: 'fixed',
    percent: null,
    amountCents,
    freeSku: null,
    freeDose: null,
    freeLabel: null,
    minSubtotalCents: 0,
    requiresAccount: false,
  };
}

function freeItemCoupon(code: string, freeSku: string): AppliedCoupon {
  return {
    code,
    kind: 'free_item',
    percent: null,
    amountCents: null,
    freeSku,
    freeDose: null,
    freeLabel: null,
    minSubtotalCents: 0,
    requiresAccount: false,
  };
}

describe('couponBreakdown — percent-only', () => {
  test('applies a single percent coupon to the full subtotal', () => {
    // Arrange
    const coupons = [percentCoupon('SAVE20', 20)];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert
    expect(result.perCode.SAVE20).toBe(2_000);
    expect(result.accountCents).toBe(0);
    expect(result.total).toBe(2_000);
  });

  test('rounds a percent coupon to the nearest cent', () => {
    // Arrange
    const coupons = [percentCoupon('THIRD', 33)];
    const subtotalCents = 1_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert — round(1000 * 33 / 100) = round(330) = 330
    expect(result.perCode.THIRD).toBe(330);
    expect(result.total).toBe(330);
  });
});

describe('couponBreakdown — fixed-only', () => {
  test('applies a single fixed coupon as a flat reduction', () => {
    // Arrange
    const coupons = [fixedCoupon('FLAT15', 1_500)];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert
    expect(result.perCode.FLAT15).toBe(1_500);
    expect(result.total).toBe(1_500);
  });
});

describe('couponBreakdown — free-item zeroing', () => {
  test('a free_item coupon contributes the matching cart line value as a flat reduction', () => {
    // Arrange
    const items = [makeCartItem({ sku: 'BPC-157', priceCents: 3_000 })];
    const coupons = [freeItemCoupon('FREEBPC', 'BPC-157')];
    const subtotalCents = 8_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents, items);

    // Assert
    expect(result.perCode.FREEBPC).toBe(3_000);
    expect(result.total).toBe(3_000);
  });

  test('a free_item coupon contributes zero when its SKU is not in the cart', () => {
    // Arrange
    const items = [makeCartItem({ sku: 'OTHER-SKU', priceCents: 3_000 })];
    const coupons = [freeItemCoupon('FREEBPC', 'BPC-157')];
    const subtotalCents = 8_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents, items);

    // Assert — server adds the free item as its own $0 line instead.
    expect(result.perCode.FREEBPC).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe('couponBreakdown — stacked compounding (flat first, then percent on the reduced base)', () => {
  test('a fixed coupon and a percent coupon stack: percent applies AFTER the flat reduction', () => {
    // Arrange
    const coupons = [fixedCoupon('FLAT20', 2_000), percentCoupon('SAVE10', 10)];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert — baseAfterFlat = 10000 - 2000 = 8000; percent = round(8000*10/100) = 800
    expect(result.perCode.FLAT20).toBe(2_000);
    expect(result.perCode.SAVE10).toBe(800);
    expect(result.total).toBe(2_800);
  });

  test('two percent coupons stack on the same reduced base and split the cap between them', () => {
    // Arrange
    const coupons = [percentCoupon('A10', 10), percentCoupon('B10', 10)];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert — each takes 10% of the 10000 base independently (1000 + 1000)
    expect(result.perCode.A10).toBe(1_000);
    expect(result.perCode.B10).toBe(1_000);
    expect(result.total).toBe(2_000);
  });
});

describe('couponBreakdown — cap at subtotal', () => {
  test('total discount never exceeds the subtotal even when fixed coupons overshoot it', () => {
    // Arrange
    const coupons = [fixedCoupon('BIG1', 6_000), fixedCoupon('BIG2', 6_000)];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert — first coupon takes the full 6000; second is capped to the
    // remaining 4000 room, not its own face value.
    expect(result.perCode.BIG1).toBe(6_000);
    expect(result.perCode.BIG2).toBe(4_000);
    expect(result.total).toBe(10_000);
  });

  test('a percent coupon larger than 100% still caps at the base (never negative order total)', () => {
    // Arrange — kind='percent' with an out-of-range percent shouldn't occur in
    // practice (server validates), but the math must not produce a discount
    // greater than the base it's computed from.
    const coupons = [percentCoupon('HUGE', 150)];
    const subtotalCents = 5_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert
    expect(result.perCode.HUGE).toBe(5_000);
    expect(result.total).toBe(5_000);
  });
});

describe('couponBreakdown — account discount (pass 2a, blueprint worked examples)', () => {
  test('example (a): guest, $300 subtotal, no codes → no discount, total stays $300', () => {
    // Arrange
    const subtotalCents = 30_000; // $300.00

    // Act
    const result = couponBreakdown([], subtotalCents, [], null);

    // Assert
    expect(result.accountCents).toBe(0);
    expect(result.total).toBe(0);
    expect(subtotalCents - result.total).toBe(30_000); // $300.00 final
  });

  test('example (b): 10% lifetime account discount + free-item $30 on $110 subtotal → $72.00 final', () => {
    // Arrange
    const items = [makeCartItem({ sku: 'FREE-SKU', priceCents: 3_000 })]; // $30 item
    const coupons = [freeItemCoupon('FREEBH2O', 'FREE-SKU')];
    const subtotalCents = 11_000; // $110.00
    const accountDiscount: AccountDiscountPreview = {
      scope: 'lifetime',
      percent: 10,
      label: 'Lifetime 10%',
    };

    // Act
    const result = couponBreakdown(coupons, subtotalCents, items, accountDiscount);

    // Assert — flat 3000¢ (free item), base 8000¢, account 800¢ (10% of 8000)
    expect(result.perCode.FREEBH2O).toBe(3_000);
    expect(result.accountCents).toBe(800);
    expect(result.total).toBe(3_800); // 3000 + 800
    expect(subtotalCents - result.total).toBe(7_200); // $72.00 final
  });

  test('example (c): business 15% account discount + 25% code on $200 → $120.00 final', () => {
    // Arrange
    const coupons = [percentCoupon('Q3FAMFREN26', 25)];
    const subtotalCents = 20_000; // $200.00
    const accountDiscount: AccountDiscountPreview = {
      scope: 'business',
      percent: 15,
      label: 'Business 15%',
    };

    // Act
    const result = couponBreakdown(coupons, subtotalCents, [], accountDiscount);

    // Assert — account 3000¢ (15% of 20000, applied first), code 25% of the
    // SAME 20000 base capped by the remaining room (20000 - 3000 = 17000)
    expect(result.accountCents).toBe(3_000);
    expect(result.perCode.Q3FAMFREN26).toBe(5_000);
    expect(result.total).toBe(8_000); // 3000 + 5000
    expect(subtotalCents - result.total).toBe(12_000); // $120.00 final
  });

  test('the account discount is capped at the post-flat base when it would otherwise overshoot', () => {
    // Arrange — a (hypothetically) huge account percent must not discount
    // below zero.
    const subtotalCents = 5_000;
    const accountDiscount: AccountDiscountPreview = {
      scope: 'lifetime',
      percent: 100,
      label: 'Lifetime 100%',
    };

    // Act
    const result = couponBreakdown([], subtotalCents, [], accountDiscount);

    // Assert
    expect(result.accountCents).toBe(5_000);
    expect(result.total).toBe(5_000);
  });

  test('a null accountDiscount contributes nothing (default parameter behavior)', () => {
    // Arrange
    const coupons = [percentCoupon('SAVE10', 10)];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert
    expect(result.accountCents).toBe(0);
    expect(result.perCode.SAVE10).toBe(1_000);
  });
});

describe('couponBreakdown — additional branch coverage', () => {
  test('a coupon that no longer qualifies for the subtotal contributes zero and is skipped', () => {
    // Arrange
    const coupons = [
      { ...fixedCoupon('BIGMIN', 1_000), minSubtotalCents: 50_000 },
      percentCoupon('SAVE10', 10),
    ];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert — BIGMIN never qualifies at this subtotal; SAVE10 still applies.
    expect(result.perCode.BIGMIN).toBe(0);
    expect(result.perCode.SAVE10).toBe(1_000);
    expect(result.total).toBe(1_000);
  });

  test('a fixed coupon with a null amountCents contributes zero instead of throwing', () => {
    // Arrange — shouldn't occur in practice (server always sets amount_cents
    // for kind='fixed'), but the client must not crash on a malformed row.
    const coupons = [{ ...fixedCoupon('BROKEN', 0), amountCents: null }];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert
    expect(result.perCode.BROKEN).toBe(0);
    expect(result.total).toBe(0);
  });

  test('a percent coupon with a null percent contributes zero instead of throwing', () => {
    // Arrange
    const coupons = [{ ...percentCoupon('BROKEN', 0), percent: null }];
    const subtotalCents = 10_000;

    // Act
    const result = couponBreakdown(coupons, subtotalCents);

    // Assert
    expect(result.perCode.BROKEN).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe('checkCoupon — no-backend fail-closed behavior', () => {
  test('returns ok:false without throwing when the module-level supabase client is null', async () => {
    // Arrange — isolate this one dynamic import so only it sees a null client;
    // the rest of the suite keeps the static rpcMock-backed mock above.
    vi.resetModules();
    vi.doMock('../../src/lib/supabase', () => ({ supabase: null }));
    const { checkCoupon: checkCouponNoBackend } = await import('../../src/lib/coupons');

    // Act
    const result = await checkCouponNoBackend('SAVE20', 1_000);

    // Assert — fails closed with a user-facing message, never throws.
    expect(result).toEqual({ ok: false, reason: 'Promo codes are unavailable right now.' });

    // Cleanup — restore the module registry for subsequent tests.
    vi.doUnmock('../../src/lib/supabase');
    vi.resetModules();
  });
});

describe('checkCoupon — input validation (no network)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test('rejects a code shorter than 3 characters without calling the RPC', async () => {
    // Arrange / Act
    const result = await checkCoupon('AB', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'Enter a code.' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('rejects an empty code without calling the RPC', async () => {
    // Arrange / Act
    const result = await checkCoupon('', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'Enter a code.' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('trims whitespace before applying the minimum-length check', async () => {
    // Arrange / Act — trims to "AB" (2 chars), still too short.
    const result = await checkCoupon('  ab  ', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'Enter a code.' });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('checkCoupon — RPC seam', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test('returns ok:false with a generic reason when the RPC call errors', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network down' } });

    // Act
    const result = await checkCoupon('SAVE20', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'Could not check the code. Please try again.' });
  });

  test('returns ok:false with the server-supplied reason when the row is invalid', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: { valid: false, reason: 'Expired code' }, error: null });

    // Act
    const result = await checkCoupon('OLD10', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'Expired code' });
  });

  test('returns ok:false with a default reason when an invalid row omits a reason', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: { valid: false }, error: null });

    // Act
    const result = await checkCoupon('NOPE', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'This code is not valid.' });
  });

  test('returns ok:false with a default reason when the row is null', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: null, error: null });

    // Act
    const result = await checkCoupon('WHAT', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'This code is not valid.' });
  });

  test('returns ok:false when a "valid" row is missing code or kind', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: { valid: true }, error: null });

    // Act
    const result = await checkCoupon('WEIRD', 1_000);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'This code is not valid.' });
  });

  test('returns ok:true with a fully populated coupon on a valid row', async () => {
    // Arrange
    rpcMock.mockResolvedValue({
      data: {
        valid: true,
        code: 'SAVE20',
        kind: 'percent',
        percent: 20,
        amount_cents: null,
        free_sku: null,
        free_dose: null,
        free_label: null,
        min_subtotal_cents: 5_000,
        requires_account: false,
      },
      error: null,
    });

    // Act
    const result = await checkCoupon('save20', 10_000);

    // Assert
    expect(result).toEqual({
      ok: true,
      coupon: {
        code: 'SAVE20',
        kind: 'percent',
        percent: 20,
        amountCents: null,
        freeSku: null,
        freeDose: null,
        freeLabel: null,
        minSubtotalCents: 5_000,
        requiresAccount: false,
      },
    });
  });

  test('defaults optional fields to null/0/false when a valid row omits them', async () => {
    // Arrange
    rpcMock.mockResolvedValue({
      data: { valid: true, code: 'BARE', kind: 'fixed' },
      error: null,
    });

    // Act
    const result = await checkCoupon('bare', 1_000);

    // Assert
    expect(result).toEqual({
      ok: true,
      coupon: {
        code: 'BARE',
        kind: 'fixed',
        percent: null,
        amountCents: null,
        freeSku: null,
        freeDose: null,
        freeLabel: null,
        minSubtotalCents: 0,
        requiresAccount: false,
      },
    });
  });

  test('sends the trimmed/uppercased code, clamped subtotal, and self-filtered applied codes to the RPC', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: null, error: null });

    // Act — the code being checked is also present (lowercase) in appliedCodes;
    // it must be filtered out of what's sent so the server doesn't self-gate.
    await checkCoupon('  save20 ', -50, {
      appliedCodes: ['save20', 'OTHER'],
      hasAccount: true,
      hasReward: true,
      hasPromo: true,
    });

    // Assert — negative subtotal clamps to 0.
    expect(rpcMock).toHaveBeenCalledWith('validate_coupon', {
      p_code: 'SAVE20',
      p_subtotal_cents: 0,
      p_applied_codes: ['OTHER'],
      p_has_reward: true,
      p_has_promo: true,
      p_has_account: true,
    });
  });

  test('rounds a fractional subtotal before sending it to the RPC', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: null, error: null });

    // Act
    await checkCoupon('SAVE20', 1_000.6);

    // Assert
    expect(rpcMock).toHaveBeenCalledWith(
      'validate_coupon',
      expect.objectContaining({ p_subtotal_cents: 1_001 }),
    );
  });

  test('defaults the context flags to false/empty when no context is supplied', async () => {
    // Arrange
    rpcMock.mockResolvedValue({ data: null, error: null });

    // Act
    await checkCoupon('SAVE20', 1_000);

    // Assert
    expect(rpcMock).toHaveBeenCalledWith('validate_coupon', {
      p_code: 'SAVE20',
      p_subtotal_cents: 1_000,
      p_applied_codes: [],
      p_has_reward: false,
      p_has_promo: false,
      p_has_account: false,
    });
  });
});

describe('freeItemLineValue', () => {
  test('returns 0 for a coupon that is not kind free_item', () => {
    // Arrange
    const coupon = percentCoupon('SAVE20', 20);
    const items = [makeCartItem({ sku: 'BPC-157', priceCents: 3_000 })];

    // Act / Assert
    expect(freeItemLineValue(coupon, items)).toBe(0);
  });

  test('returns 0 for a free_item coupon with no freeSku set', () => {
    // Arrange
    const coupon = freeItemCoupon('FREEX', '');
    const items = [makeCartItem({ sku: 'BPC-157', priceCents: 3_000 })];

    // Act / Assert
    expect(freeItemLineValue({ ...coupon, freeSku: null }, items)).toBe(0);
  });

  test('returns the matching line value when the SKU is in the cart and no dose is specified', () => {
    // Arrange
    const coupon = freeItemCoupon('FREEBPC', 'BPC-157');
    const items = [makeCartItem({ sku: 'BPC-157', priceCents: 4_500 })];

    // Act / Assert
    expect(freeItemLineValue(coupon, items)).toBe(4_500);
  });

  test('matches on SKU and dose substring when the coupon names a dose', () => {
    // Arrange
    const coupon = { ...freeItemCoupon('FREEBPC', 'BPC-157'), freeDose: '10mg' };
    const items = [makeCartItem({ sku: 'BPC-157', name: 'BPC-157 10mg Vial', priceCents: 4_500 })];

    // Act / Assert
    expect(freeItemLineValue(coupon, items)).toBe(4_500);
  });

  test('returns 0 when the SKU matches but the dose substring does not', () => {
    // Arrange
    const coupon = { ...freeItemCoupon('FREEBPC', 'BPC-157'), freeDose: '10mg' };
    const items = [makeCartItem({ sku: 'BPC-157', name: 'BPC-157 5mg Vial', priceCents: 4_500 })];

    // Act / Assert
    expect(freeItemLineValue(coupon, items)).toBe(0);
  });

  test('returns 0 when no cart item matches the SKU at all', () => {
    // Arrange
    const coupon = freeItemCoupon('FREEBPC', 'BPC-157');
    const items = [makeCartItem({ sku: 'OTHER-SKU', priceCents: 3_000 })];

    // Act / Assert
    expect(freeItemLineValue(coupon, items)).toBe(0);
  });

  test('returns 0 for an empty cart', () => {
    // Arrange
    const coupon = freeItemCoupon('FREEBPC', 'BPC-157');

    // Act / Assert
    expect(freeItemLineValue(coupon, [])).toBe(0);
  });
});

describe('couponStillQualifies', () => {
  test('returns true when the coupon is null', () => {
    expect(couponStillQualifies(null, 0)).toBe(true);
  });

  test('returns true when the subtotal is above the minimum', () => {
    const coupon = { ...percentCoupon('SAVE20', 20), minSubtotalCents: 5_000 };
    expect(couponStillQualifies(coupon, 6_000)).toBe(true);
  });

  test('returns true when the subtotal exactly equals the minimum (boundary)', () => {
    const coupon = { ...percentCoupon('SAVE20', 20), minSubtotalCents: 5_000 };
    expect(couponStillQualifies(coupon, 5_000)).toBe(true);
  });

  test('returns false when the subtotal drops below the minimum', () => {
    const coupon = { ...percentCoupon('SAVE20', 20), minSubtotalCents: 5_000 };
    expect(couponStillQualifies(coupon, 4_999)).toBe(false);
  });
});

describe('submittableCouponCodes', () => {
  test('returns an empty array for no coupons', () => {
    expect(submittableCouponCodes([], 10_000)).toEqual([]);
  });

  test('excludes coupons that no longer qualify for the current subtotal', () => {
    // Arrange
    const coupons = [
      { ...percentCoupon('SAVE20', 20), minSubtotalCents: 5_000 },
      { ...percentCoupon('BIG50', 50), minSubtotalCents: 50_000 },
    ];

    // Act / Assert
    expect(submittableCouponCodes(coupons, 10_000)).toEqual(['SAVE20']);
  });

  test('dedupes repeated codes while preserving first-seen order', () => {
    // Arrange
    const coupons = [
      percentCoupon('A10', 10),
      percentCoupon('B10', 10),
      percentCoupon('A10', 10),
    ];

    // Act / Assert
    expect(submittableCouponCodes(coupons, 10_000)).toEqual(['A10', 'B10']);
  });
});
