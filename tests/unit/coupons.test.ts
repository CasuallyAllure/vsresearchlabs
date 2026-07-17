/**
 * Unit tests for src/lib/coupons.ts — couponBreakdown().
 *
 * These recreate the blueprint's worked examples exactly
 * (docs/CUSTOMER_PORTAL_BLUEPRINT.md §3.3) so the cart preview math stays
 * provably in lockstep with the server-side compounding model
 * (recompute_order_totals / place-order).
 */
import { describe, expect, test } from 'vitest';
import { couponBreakdown, type AccountDiscountPreview } from '../../src/lib/coupons';
import type { AppliedCoupon } from '../../src/hooks/useCart';
import { makeCartItem } from '../fixtures/product';

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
