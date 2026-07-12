/**
 * Unit tests for src/lib/lineDiscounts.ts — allocateLineDiscounts().
 *
 * Verifies the render-time per-line allocation stays proportional to each
 * line's retail subtotal, foots exactly to the coupons' discount_cents sum,
 * and keeps a free_item coupon's discount pinned to its own line.
 */
import { describe, expect, test } from 'vitest';
import { allocateLineDiscounts, type DiscountCoupon, type DiscountLine } from '../../src/lib/lineDiscounts';

describe('allocateLineDiscounts — proportional allocation', () => {
  test('splits a percent/fixed coupon across lines proportional to retail subtotal', () => {
    // Arrange
    const lines: DiscountLine[] = [{ quantity: 1, sku: 'A' }, { quantity: 1, sku: 'B' }];
    const retail = [3_000, 7_000];
    const coupons: DiscountCoupon[] = [{ kind: 'percent', discount_cents: 1_000 }];

    // Act
    const allocation = allocateLineDiscounts(lines, retail, coupons);

    // Assert — 30%/70% split of the 1000¢ discount
    expect(allocation).toEqual([300, 700]);
    expect(allocation.reduce((a, b) => a + b, 0)).toBe(1_000);
  });

  test('accounts for line quantity in the proportional base', () => {
    // Arrange — line 0 has qty 2 (base 4000), line 1 has qty 1 (base 4000):
    // equal bases despite different unit prices, so the split is 50/50.
    const lines: DiscountLine[] = [{ quantity: 2 }, { quantity: 1 }];
    const retail = [2_000, 4_000];
    const coupons: DiscountCoupon[] = [{ kind: 'fixed', discount_cents: 1_000 }];

    // Act
    const allocation = allocateLineDiscounts(lines, retail, coupons);

    // Assert
    expect(allocation).toEqual([500, 500]);
  });
});

describe('allocateLineDiscounts — rounding', () => {
  test('the last paid line absorbs the rounding remainder so the array foots exactly', () => {
    // Arrange — 100¢ split three ways over an equal base doesn't divide evenly.
    const lines: DiscountLine[] = [{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }];
    const retail = [1_000, 1_000, 1_000];
    const coupons: DiscountCoupon[] = [{ kind: 'percent', discount_cents: 100 }];

    // Act
    const allocation = allocateLineDiscounts(lines, retail, coupons);

    // Assert — round(33.33) twice, remainder absorbed by the final line
    expect(allocation).toEqual([33, 33, 34]);
    expect(allocation.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('allocateLineDiscounts — free-line handling', () => {
  test('a free_item coupon lands its full discount on the matching SKU line only', () => {
    // Arrange
    const lines: DiscountLine[] = [{ quantity: 1, sku: 'FREE' }, { quantity: 1, sku: 'PAID' }];
    const retail = [2_000, 5_000];
    const coupons: DiscountCoupon[] = [{ kind: 'free_item', discount_cents: 2_000, free_sku: 'FREE' }];

    // Act
    const allocation = allocateLineDiscounts(lines, retail, coupons);

    // Assert — the paid line is untouched by a free_item coupon alone
    expect(allocation).toEqual([2_000, 0]);
  });

  test('a free_item coupon falls back to matching a line whose base equals its discount when no SKU matches', () => {
    // Arrange — no free_sku supplied; the helper falls back to a price match.
    const lines: DiscountLine[] = [{ quantity: 1 }, { quantity: 1 }];
    const retail = [1_500, 4_000];
    const coupons: DiscountCoupon[] = [{ kind: 'free_item', discount_cents: 1_500 }];

    // Act
    const allocation = allocateLineDiscounts(lines, retail, coupons);

    // Assert
    expect(allocation).toEqual([1_500, 0]);
  });

  test('a free_item coupon and a percent coupon combine: percent only splits across the remaining paid lines', () => {
    // Arrange
    const lines: DiscountLine[] = [{ quantity: 1, sku: 'FREE' }, { quantity: 1, sku: 'PAID' }];
    const retail = [2_000, 8_000];
    const coupons: DiscountCoupon[] = [
      { kind: 'free_item', discount_cents: 2_000, free_sku: 'FREE' },
      { kind: 'percent', discount_cents: 800 },
    ];

    // Act
    const allocation = allocateLineDiscounts(lines, retail, coupons);

    // Assert — free line takes its own 2000; the percent's 800 lands
    // entirely on the one remaining paid line (not smeared onto the zeroed one).
    expect(allocation).toEqual([2_000, 800]);
  });
});
