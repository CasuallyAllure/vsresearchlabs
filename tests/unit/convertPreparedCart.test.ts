/**
 * src/lib/convertPreparedCart.ts — the money behind "Convert to order".
 *
 * This module exists because a prepared cart only becomes an order if the
 * MEMBER checks out. When they pay the owner directly and never do, no order
 * exists — the incident this feature closes, found after a real client had
 * already paid. Converting writes a real order for money ALREADY COLLECTED,
 * which makes every number here load-bearing in a way the build composer's are
 * not:
 *
 *   1. THE TOTAL ON SCREEN IS THE TOTAL RECORDED. The owner reconciles the
 *      figure in the confirmation against a payment already in his hand, so
 *      `convertTotals` must reproduce `recompute_order_totals` to the cent —
 *      including its rounding — and `convertConfirmMessage` must quote that
 *      same figure rather than compute a second one.
 *
 *   2. AN EDITED PRICE IS THE RECORDED PRICE. The whole point of the editable
 *      unit-price box is that the owner may have agreed a different number
 *      off-site. Anything that silently substituted the catalog price would
 *      record an amount he was never paid.
 *
 *   3. NOTHING IS SILENTLY COERCED. A line that cannot be priced is reported,
 *      never seeded at zero; a zero discount sends nothing rather than an
 *      invoice row claiming a deal that was not given.
 *
 * The maths mirror is asserted against hand-computed cents, not against a
 * re-implementation of the formula — a test that repeated the expression would
 * pass on both sides of the same mistake.
 */
import { describe, expect, test } from 'vitest';

import {
  ADMIN_DISCOUNT_CODE,
  convertConfirmMessage,
  convertDiscountPayload,
  convertLinesPayload,
  convertTotals,
  parsePercentInput,
  parseQuantityInput,
  parseUsdToCents,
  prefillConvertLines,
  prefillDiscount,
  type ConvertLine,
  type DiscountDraft,
} from '../../src/lib/convertPreparedCart';
import type { VariantIndex, VariantOption } from '../../src/lib/preparedCart';
import { formatPriceExact } from '../../src/lib/pricing';

const line = (over: Partial<ConvertLine> = {}): ConvertLine => ({
  sku: 'VSR-RS-BPC',
  dose: '10mg',
  name: 'BPC-157 — 10mg',
  quantity: 1,
  unitPriceCents: 10_000,
  ...over,
});

const percentOff = (percent: number, code = 'MEMBER15'): DiscountDraft => ({
  kind: 'percent', percent, amountCents: 0, code,
});

const fixedOff = (amountCents: number, code = 'AGREED'): DiscountDraft => ({
  kind: 'fixed', percent: 0, amountCents, code,
});

/** A hand-built index — the real one reads the productOverrides store, which is
 *  irrelevant to what this module does with the options it is handed. */
function indexOf(options: VariantOption[]): VariantIndex {
  return { compoundNames: ['Test'], byCompound: new Map([['Test', options]]) };
}

const option = (over: Partial<VariantOption> = {}): VariantOption => ({
  sku: 'VSR-RS-BPC', dose: '10mg', name: 'BPC-157 — 10mg', priceCents: 10_000, tier: 'sourced', ...over,
});

describe('convertTotals', () => {
  test('sums unit × quantity in integer cents', () => {
    const totals = convertTotals(
      [line({ unitPriceCents: 12_500, quantity: 3 }), line({ unitPriceCents: 999, quantity: 2 })],
      null,
    );

    expect(totals.subtotalCents).toBe(39_498);
    expect(totals.discountCents).toBe(0);
    expect(totals.totalCents).toBe(39_498);
  });

  test('rounds a percent discount half-away-from-zero, matching recompute_order_totals', () => {
    // 12345 × 15 / 100 = 1851.75 — the half-cent case. Postgres rounds to 1852;
    // truncating would record a dollar-and-a-bit more than the owner was paid.
    const totals = convertTotals([line({ unitPriceCents: 12_345, quantity: 1 })], percentOff(15));

    expect(totals.subtotalCents).toBe(12_345);
    expect(totals.discountCents).toBe(1_852);
    expect(totals.totalCents).toBe(10_493);
  });

  test('applies a whole-cent percent discount exactly', () => {
    const totals = convertTotals([line({ unitPriceCents: 20_000, quantity: 2 })], percentOff(15));

    expect(totals.discountCents).toBe(6_000);
    expect(totals.totalCents).toBe(34_000);
  });

  test('caps a fixed discount at the subtotal so a total can never go negative', () => {
    const totals = convertTotals([line({ unitPriceCents: 5_000, quantity: 1 })], fixedOff(9_999_99));

    expect(totals.discountCents).toBe(5_000);
    expect(totals.totalCents).toBe(0);
  });

  test('records a fixed discount as typed when it is under the subtotal', () => {
    const totals = convertTotals([line({ unitPriceCents: 30_000, quantity: 1 })], fixedOff(4_250));

    expect(totals.discountCents).toBe(4_250);
    expect(totals.totalCents).toBe(25_750);
  });

  test('treats a zero or negative percent as no discount', () => {
    expect(convertTotals([line()], percentOff(0)).discountCents).toBe(0);
    expect(convertTotals([line()], percentOff(-5)).discountCents).toBe(0);
  });

  test('clamps a percent above 100 rather than inventing a refund', () => {
    const totals = convertTotals([line({ unitPriceCents: 10_000 })], percentOff(140));

    expect(totals.discountCents).toBe(10_000);
    expect(totals.totalCents).toBe(0);
  });

  test('is zero across the board for an empty cart', () => {
    expect(convertTotals([], percentOff(15))).toEqual({
      subtotalCents: 0, discountCents: 0, totalCents: 0,
    });
  });
});

describe('prefillConvertLines', () => {
  test('seeds each line at the catalog price and the cart quantity', () => {
    const { lines, dropped } = prefillConvertLines(
      [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 3 }],
      indexOf([option({ priceCents: 14_500 })]),
    );

    expect(dropped).toEqual([]);
    expect(lines).toEqual([
      { sku: 'VSR-RS-BPC', dose: '10mg', name: 'BPC-157 — 10mg', quantity: 3, unitPriceCents: 14_500 },
    ]);
  });

  test('reports a line whose dose left the catalog instead of seeding it at $0', () => {
    const gone = { sku: 'VSR-RS-GONE', dose: '5mg', quantity: 1 };
    const { lines, dropped } = prefillConvertLines(
      [gone, { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 }],
      indexOf([option()]),
    );

    expect(lines).toHaveLength(1);
    expect(dropped).toEqual([gone]);
  });

  test('reports a line with a non-positive quantity rather than converting it', () => {
    const { lines, dropped } = prefillConvertLines(
      [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 0 }],
      indexOf([option()]),
    );

    expect(lines).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});

describe('prefillDiscount', () => {
  test("opens at the member's own standing rate", () => {
    expect(prefillDiscount(15, null)).toEqual({
      kind: 'percent', percent: 15, amountCents: 0, code: ADMIN_DISCOUNT_CODE,
    });
  });

  test("labels the discount with the cart's own coupon code when it has one", () => {
    expect(prefillDiscount(20, 'spring20').code).toBe('SPRING20');
  });
});

describe('convertLinesPayload', () => {
  test('records the EDITED unit price, not the catalog price', () => {
    // The catalog says $145.00; the owner was actually paid $120.00. The order
    // must say $120.00 — this is the whole reason the field is editable.
    const seeded = prefillConvertLines(
      [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }],
      indexOf([option({ priceCents: 14_500 })]),
    ).lines;
    const edited = seeded.map((l) => ({ ...l, unitPriceCents: 12_000 }));

    expect(convertLinesPayload(edited)).toEqual([
      {
        sku: 'VSR-RS-BPC',
        product_name: 'BPC-157 — 10mg',
        quantity: 2,
        unit_price_cents: 12_000,
        item_note: null,
      },
    ]);
    // And the total follows the edit rather than the catalog.
    expect(convertTotals(edited, null).totalCents).toBe(24_000);
  });
});

describe('convertDiscountPayload', () => {
  test('sends a whole percent with an upper-cased code', () => {
    expect(convertDiscountPayload(percentOff(15, 'member15'))).toEqual({
      kind: 'percent', code: 'MEMBER15', percent: 15,
    });
  });

  test('sends a fixed amount in whole cents', () => {
    expect(convertDiscountPayload(fixedOff(4_250))).toEqual({
      kind: 'fixed', code: 'AGREED', amount_cents: 4_250,
    });
  });

  test('sends nothing for a zero discount, so no invoice row claims a deal that was not given', () => {
    expect(convertDiscountPayload(percentOff(0))).toBeNull();
    expect(convertDiscountPayload(fixedOff(0))).toBeNull();
    expect(convertDiscountPayload(null)).toBeNull();
  });

  test('falls back to a named code rather than an empty one', () => {
    expect(convertDiscountPayload(percentOff(10, '   '))?.code).toBe(ADMIN_DISCOUNT_CODE);
  });
});

describe('input parsing', () => {
  test('parseUsdToCents accepts dollars, symbols and separators', () => {
    expect(parseUsdToCents('120')).toBe(12_000);
    expect(parseUsdToCents('$1,299.95')).toBe(129_995);
    expect(parseUsdToCents(' 0 ')).toBe(0);
  });

  test('parseUsdToCents rounds rather than truncates', () => {
    // Truncating "19.999" would record $19.99 on an order already paid at $20.
    expect(parseUsdToCents('19.999')).toBe(2_000);
  });

  test('parseUsdToCents refuses anything that is not a non-negative amount', () => {
    expect(parseUsdToCents('')).toBeNull();
    expect(parseUsdToCents('-5')).toBeNull();
    expect(parseUsdToCents('abc')).toBeNull();
  });

  test('parsePercentInput takes 0–100 as whole percent and refuses the rest', () => {
    expect(parsePercentInput('15')).toBe(15);
    expect(parsePercentInput('12.4%')).toBe(12);
    expect(parsePercentInput('101')).toBeNull();
    expect(parsePercentInput('-1')).toBeNull();
    expect(parsePercentInput('')).toBeNull();
  });

  test('parseQuantityInput takes positive whole numbers only', () => {
    expect(parseQuantityInput('3')).toBe(3);
    expect(parseQuantityInput('0')).toBeNull();
    expect(parseQuantityInput('2.5')).toBeNull();
    expect(parseQuantityInput('10000')).toBeNull();
    expect(parseQuantityInput('')).toBeNull();
  });
});

describe('convertConfirmMessage', () => {
  test('quotes the exact total the order will record', () => {
    const lines = [line({ unitPriceCents: 12_345, quantity: 1 })];
    const discount = percentOff(15);
    const totals = convertTotals(lines, discount);

    const message = convertConfirmMessage({ buyerName: 'Dana Reyes', lines, totals, discount });

    // The figure in the dialog IS the figure the order carries — the owner is
    // reconciling it against money he has already been paid.
    expect(totals.totalCents).toBe(10_493);
    expect(message).toContain(formatPriceExact(10_493));
    expect(message).toContain('Dana Reyes');
    expect(message).toContain('1 line');
    expect(message).toContain('15% off');
  });

  test('names the line count in the plural and states the cart is revoked', () => {
    const lines = [line(), line({ sku: 'VSR-RS-RETA', name: 'Retatrutide — 15mg' })];
    const totals = convertTotals(lines, null);

    const message = convertConfirmMessage({ buyerName: 'Dana Reyes', lines, totals, discount: null });

    expect(message).toContain('2 lines');
    expect(message).toContain('revoked');
    expect(message).not.toContain('off.');
  });

  test('states a fixed discount as an amount', () => {
    const lines = [line({ unitPriceCents: 30_000 })];
    const discount = fixedOff(4_250);
    const totals = convertTotals(lines, discount);

    const message = convertConfirmMessage({ buyerName: 'Dana Reyes', lines, totals, discount });

    expect(message).toContain(formatPriceExact(4_250));
    expect(message).toContain(formatPriceExact(25_750));
  });
});
