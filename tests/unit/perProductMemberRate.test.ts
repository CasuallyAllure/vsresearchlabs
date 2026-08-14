/**
 * Per-product member rates (087) in the checkout engine.
 *
 * TZP Oral is a 10% product in a 15% catalog. The account discount has been a
 * single whole-cart percent since 069, so the engine had no way to say that —
 * it now takes per-line rates and falls back to the account's rate for every
 * line that has none.
 *
 * The load-bearing property is the SECOND test: a cart with no overridden
 * product must be computed by the old code path, to the cent. A rounding change
 * that only shows up on some carts is the kind of money bug nobody finds until
 * a customer does.
 *
 * These figures are pinned against the SQL mirror (recompute_order_totals,
 * migration 087) run on a real Postgres — mixed cart 3200, uniform cart 3000.
 */
import { describe, expect, test } from 'vitest';

import { computeOrderTotals } from '../../supabase/functions/place-order/orderTotals';

const BASE = {
  shippingCents: 0,
  flatCentsFromCodes: 0,
  wholesalePlan: [],
  bundleValue: 0,
  b2g1FreePlan: [],
  rewardPercent: null,
  percentEntries: [],
};

describe('per-product member rate', () => {
  test('a line with its own rate takes it; the rest take the account rate', () => {
    // Arrange — 2 × TZP Oral at $100 (10% product) + 1 × RTT at $80 (no rate).
    const input = {
      ...BASE,
      grossSubtotalCents: 28_000,
      itemUnitPricesCents: [10_000, 8_000],
      accountPercent: 15,
      accountRateLines: [
        { valueCents: 20_000, percent: 10 },
        { valueCents: 8_000, percent: null },
      ],
    };

    // Act
    const result = computeOrderTotals(input);

    // Assert — 20000×10% + 8000×15% = 2000 + 1200. NOT 28000×15% = 4200.
    expect(result.accountCents).toBe(3_200);
  });

  test('a cart with no overridden product is unchanged, to the cent', () => {
    // Arrange — the same cart with every line on the account rate, expressed
    // both ways: with rate lines present and with the field absent entirely.
    const withLines = computeOrderTotals({
      ...BASE,
      grossSubtotalCents: 20_000,
      itemUnitPricesCents: [8_000, 12_000],
      accountPercent: 15,
      accountRateLines: [
        { valueCents: 8_000, percent: null },
        { valueCents: 12_000, percent: null },
      ],
    });
    const withoutLines = computeOrderTotals({
      ...BASE,
      grossSubtotalCents: 20_000,
      itemUnitPricesCents: [8_000, 12_000],
      accountPercent: 15,
    });

    // Assert
    expect(withLines.accountCents).toBe(3_000);
    expect(withoutLines.accountCents).toBe(3_000);
  });

  test('a zero rate excludes that product from member pricing entirely', () => {
    const result = computeOrderTotals({
      ...BASE,
      grossSubtotalCents: 20_000,
      itemUnitPricesCents: [10_000],
      accountPercent: 15,
      accountRateLines: [
        { valueCents: 10_000, percent: 0 },
        { valueCents: 10_000, percent: null },
      ],
    });

    // Only the second line earns anything: 10000 × 15%.
    expect(result.accountCents).toBe(1_500);
  });

  test('the per-line slice is still capped at the post-flat base', () => {
    // A flat code has already eaten most of the cart; the account slice cannot
    // exceed what is left, same guard the whole-base path has always had.
    const result = computeOrderTotals({
      ...BASE,
      grossSubtotalCents: 10_000,
      flatCentsFromCodes: 9_800,
      itemUnitPricesCents: [10_000],
      accountPercent: 15,
      accountRateLines: [{ valueCents: 10_000, percent: 100 }],
    });

    expect(result.accountCents).toBeLessThanOrEqual(200);
  });
});
