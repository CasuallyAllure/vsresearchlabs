/**
 * Unit tests for src/lib/bundle.ts — bundleDiscount().
 *
 * The client display mirror of place-order's bundle math. If these two ever
 * disagree, the cart shows one number and the invoice bills another — so the
 * rules are pinned here: any dose of each qualifies, every complete pair
 * counts, and the discount lands on the buyer's dearest qualifying units.
 */
import { describe, expect, test } from 'vitest';
import { BUNDLE_PROMO, bundleDiscount, type BundleLine } from '../../src/lib/bundle';

const RTT = BUNDLE_PROMO.skuA;
const GHK = BUNDLE_PROMO.skuB;

const line = (sku: string, unitCents: number, quantity = 1): BundleLine => ({
  sku,
  unitCents,
  quantity,
});

describe('bundleDiscount — the live shelf pair', () => {
  test('Retatrutide 10mg ($60) + GHK-Cu 100mg ($55) → $23 off', () => {
    // Arrange — the real in-stock pair as of 2026-07-16.
    const lines = [line(RTT, 6_000), line(GHK, 5_500)];

    // Act
    const result = bundleDiscount(lines);

    // Assert — 20% of $115.
    expect(result).toEqual({ pairs: 1, discountCents: 2_300 });
  });
});

describe('bundleDiscount — eligibility', () => {
  test('no discount when only one half of the pair is present', () => {
    expect(bundleDiscount([line(RTT, 6_000)])).toEqual({ pairs: 0, discountCents: 0 });
    expect(bundleDiscount([line(GHK, 5_500)])).toEqual({ pairs: 0, discountCents: 0 });
  });

  test('no discount for an empty cart', () => {
    expect(bundleDiscount([])).toEqual({ pairs: 0, discountCents: 0 });
  });

  test('unrelated items never trigger or inflate the bundle', () => {
    const lines = [line('VSR-RS-BPC', 6_500, 4), line(RTT, 6_000), line(GHK, 5_500)];
    // Only the pair's own value is discounted — the BPC line is untouched.
    expect(bundleDiscount(lines)).toEqual({ pairs: 1, discountCents: 2_300 });
  });

  test('ignores $0 and zero-quantity lines', () => {
    expect(bundleDiscount([line(RTT, 0), line(GHK, 5_500)])).toEqual({ pairs: 0, discountCents: 0 });
    expect(bundleDiscount([line(RTT, 6_000, 0), line(GHK, 5_500)])).toEqual({ pairs: 0, discountCents: 0 });
  });

  test('any dose of each qualifies — a sourced 30mg Reta still pairs', () => {
    // Retatrutide 30mg ($120) + GHK-Cu 50mg ($40) = $160 → 20% = $32.
    expect(bundleDiscount([line(RTT, 12_000), line(GHK, 4_000)])).toEqual({
      pairs: 1,
      discountCents: 3_200,
    });
  });
});

describe('bundleDiscount — every complete pair', () => {
  test('3 Retatrutide + 3 GHK-Cu = three bundles', () => {
    const lines = [line(RTT, 6_000, 3), line(GHK, 5_500, 3)];
    // 20% of (3×$60 + 3×$55) = 20% of $345 = $69.
    expect(bundleDiscount(lines)).toEqual({ pairs: 3, discountCents: 6_900 });
  });

  test('pairs are capped by the lesser side — 5 Reta + 2 GHK = two bundles', () => {
    const lines = [line(RTT, 6_000, 5), line(GHK, 5_500, 2)];
    // Only 2 pairs: 20% of (2×$60 + 2×$55) = 20% of $230 = $46.
    expect(bundleDiscount(lines)).toEqual({ pairs: 2, discountCents: 4_600 });
  });
});

describe('bundleDiscount — dearest units win', () => {
  test('a mixed-dose cart discounts the buyer’s most valuable qualifying units', () => {
    // 1× Reta 30mg ($120) + 1× Reta 10mg ($60), 1× GHK 100mg ($55).
    // Only ONE pair is possible → it must use the $120 Reta, not the $60 one.
    const lines = [line(RTT, 12_000), line(RTT, 6_000), line(GHK, 5_500)];
    // 20% of ($120 + $55) = 20% of $175 = $35.
    expect(bundleDiscount(lines)).toEqual({ pairs: 1, discountCents: 3_500 });
  });

  test('takes the dearest units across quantities, not whole lines', () => {
    // 2× Reta 30mg ($120 ea) + 3× Reta 10mg ($60 ea) = 5 units; 3× GHK ($55).
    // 3 pairs → dearest 3 Reta units = $120+$120+$60 = $300; GHK = 3×$55 = $165.
    // 20% of $465 = $93.
    const lines = [line(RTT, 12_000, 2), line(RTT, 6_000, 3), line(GHK, 5_500, 3)];
    expect(bundleDiscount(lines)).toEqual({ pairs: 3, discountCents: 9_300 });
  });
});
