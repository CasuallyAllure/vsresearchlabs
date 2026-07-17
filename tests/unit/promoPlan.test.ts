/**
 * Unit tests for supabase/functions/place-order/promoPlan.ts — buildPromoPlans().
 *
 * The two automatic server-side promos: WHOLESALE pack pricing and B2G1.
 * Eligibility must come entirely from the database row a line resolves to —
 * never from the payload's `category`, and never priced off the client's `unit`.
 */
import { describe, expect, test } from 'vitest';
import {
  buildPromoPlans,
  wholesalePackValue,
  WHOLESALE_CASE,
  WHOLESALE_HALF,
  type PromoLine,
  type PromoPlanInput,
  type VariantPromoRow,
} from '../../supabase/functions/place-order/promoPlan';

/** A slow-ship (sourced), admin-priced, wholesale-eligible compound dose. */
const row = (over: Partial<VariantPromoRow> = {}): VariantPromoRow => ({
  sku: 'VSR-RS-BPC-005',
  dose: '5mg',
  on_hand: 0,
  inbound_units: 0,
  lead_days: 7,
  price_cents: 6_000,
  wholesale_eligible: true,
  ...over,
});

const line = (over: Partial<PromoLine> = {}): PromoLine => ({
  sku: 'VSR-RS-BPC-005',
  name: 'BPC-157 — 5mg',
  quantity: 10,
  unitPriceCents: 6_000,
  ...over,
});

const plan = (over: Partial<PromoPlanInput> = {}) =>
  buildPromoPlans({
    lines: [line()],
    variantRows: [row()],
    promoLive: false,
    excludedSkus: new Set<string>(),
    isMember: true,
    ...over,
  });

describe('wholesale eligibility is a server fact (P0-3)', () => {
  test('reproduces the scan exploit: lab equipment gets NO wholesale', () => {
    // Arrange — signed-in buyer, 10 × a $200 lab item, payload lying about the
    // category. Equipment prices per-sku on product_stock and has no variant
    // row at all, so the line resolves to nothing.
    const lines = [line({
      sku: 'VSR-LE-CEN-024',
      name: 'Microcentrifuge — 24-Place',
      quantity: 10,
      unitPriceCents: 20_000,
    })];

    // Act
    const { wholesalePlan } = buildPromoPlans({
      lines,
      variantRows: [row()], // rows for a different sku
      promoLive: false,
      excludedSkus: new Set(),
      isMember: true,
    });

    // Assert — was $800 off; now nothing.
    expect(wholesalePlan).toEqual([]);
  });

  test('a supply dose with a variant row but wholesale_eligible=false gets NO wholesale', () => {
    // Bacteriostatic water / syringes / acetic acid DO have dose rows — the flag
    // is what excludes them, not the absence of data.
    const { wholesalePlan } = plan({
      lines: [line({ sku: 'VSR-RS-BAC-030', name: 'Bacteriostatic Water — 30 mL', unitPriceCents: 4_000 })],
      variantRows: [row({
        sku: 'VSR-RS-BAC-030', dose: '30 mL', price_cents: 4_000, wholesale_eligible: false,
      })],
    });
    expect(wholesalePlan).toEqual([]);
  });

  test('a forged category in the payload cannot buy eligibility', () => {
    // `category` is not an input to the planner at all — this test exists to
    // pin that: the only lever the client has is text that must RESOLVE to an
    // eligible row.
    const { wholesalePlan } = plan({
      lines: [line({ sku: 'VSR-RS-SYR-100', name: 'Research Syringes — biopeptide-research-supplies' })],
      variantRows: [row({ sku: 'VSR-RS-SYR-100', dose: '1mL', wholesale_eligible: false, price_cents: 3_000 })],
    });
    expect(wholesalePlan).toEqual([]);
  });

  test('an eligible compound dose DOES get the case discount', () => {
    const { wholesalePlan } = plan();
    // 10 × $60 → one full case at 40% off.
    expect(wholesalePlan).toEqual([{ idx: 0, units: 10, value: 24_000 }]);
  });

  test('a line that resolves to no dose row gets no promo', () => {
    const { wholesalePlan, b2g1FreePlan } = plan({
      lines: [line({ name: 'BPC-157 (peptide)' })], // no dose text → no match
      promoLive: true,
    });
    expect(wholesalePlan).toEqual([]);
    expect(b2g1FreePlan).toEqual([]);
  });

  test('an unpriced dose gets no promo — there is no server price to discount', () => {
    const { wholesalePlan, b2g1FreePlan } = plan({
      variantRows: [row({ price_cents: null })],
      promoLive: true,
    });
    expect(wholesalePlan).toEqual([]);
    expect(b2g1FreePlan).toEqual([]);
  });
});

describe('the pack is priced off the SERVER price, never the client unit', () => {
  test('a client unit lying LOW does not shrink the discount', () => {
    const { wholesalePlan } = plan({ lines: [line({ unitPriceCents: 1 })] });
    expect(wholesalePlan[0].value).toBe(24_000); // 40% of 10 × the admin $60
  });

  test('a client unit lying HIGH does not inflate the discount', () => {
    const { wholesalePlan } = plan({ lines: [line({ unitPriceCents: 999_999 })] });
    expect(wholesalePlan[0].value).toBe(24_000);
  });

  test('B2G1 values the free units at the admin price too', () => {
    const { b2g1FreePlan } = plan({
      lines: [line({ quantity: 3, unitPriceCents: 1 })],
      promoLive: true,
    });
    expect(b2g1FreePlan).toEqual([{ idx: 0, freeUnits: 1, unit: 6_000 }]);
  });
});

describe('pack threshold matches the client (WHOLESALE_MIN_PACK = 5)', () => {
  test.each([3, 4])('qty %i gets NO wholesale on either side', (quantity) => {
    const { wholesalePlan } = plan({ lines: [line({ quantity })] });
    expect(wholesalePlan).toEqual([]);
  });

  test('qty 5 gets exactly one half kit at 27%', () => {
    const { wholesalePlan } = plan({ lines: [line({ quantity: 5 })] });
    expect(wholesalePlan).toEqual([{ idx: 0, units: 5, value: 8_100 }]);
  });

  test('qty 15 = one full case + one half kit', () => {
    const { wholesalePlan } = plan({ lines: [line({ quantity: 15 })] });
    expect(wholesalePlan).toEqual([{ idx: 0, units: 15, value: 24_000 + 8_100 }]);
  });
});

describe('wholesalePackValue', () => {
  test('packs full cases first, then at most one half kit', () => {
    expect(wholesalePackValue(24, 10_000)).toEqual({
      units: 20 + 0, // 2 cases; remainder 4 < 5 → no half kit
      value: 2 * Math.round((WHOLESALE_CASE.size * 10_000 * WHOLESALE_CASE.percent) / 100),
    });
  });

  test('a remainder of exactly the half-kit size adds one kit', () => {
    expect(wholesalePackValue(25, 10_000).units).toBe(25);
  });

  test('below the smallest pack there is no value', () => {
    expect(wholesalePackValue(WHOLESALE_HALF.size - 1, 10_000)).toEqual({ units: 0, value: 0 });
  });
});

describe('B2G1 gating', () => {
  test('a fast (in-stock) dose never gets B2G1', () => {
    const { b2g1FreePlan } = plan({
      lines: [line({ quantity: 3 })],
      variantRows: [row({ on_hand: 8 })],
      promoLive: true,
    });
    expect(b2g1FreePlan).toEqual([]);
  });

  test('an excluded sku never gets B2G1', () => {
    const { b2g1FreePlan } = plan({
      lines: [line({ quantity: 3 })],
      promoLive: true,
      excludedSkus: new Set(['VSR-RS-BPC-005']),
    });
    expect(b2g1FreePlan).toEqual([]);
  });

  test('B2G1 does not apply when the promo is off', () => {
    const { b2g1FreePlan } = plan({ lines: [line({ quantity: 3 })], promoLive: false });
    expect(b2g1FreePlan).toEqual([]);
  });

  test('the better offer claims the line — qty 6 → B2G1 beats the half kit', () => {
    // 2 free × $60 = $120 vs one half kit = 27% of $300 = $81.
    const { wholesalePlan, b2g1FreePlan } = plan({
      lines: [line({ quantity: 6 })],
      promoLive: true,
    });
    expect(wholesalePlan).toEqual([]);
    expect(b2g1FreePlan).toEqual([{ idx: 0, freeUnits: 2, unit: 6_000 }]);
  });

  test('the better offer claims the line — qty 10 → the case beats B2G1', () => {
    // 40% of $600 = $240 vs 3 free × $60 = $180.
    const { wholesalePlan, b2g1FreePlan } = plan({
      lines: [line({ quantity: 10 })],
      promoLive: true,
    });
    expect(wholesalePlan).toEqual([{ idx: 0, units: 10, value: 24_000 }]);
    expect(b2g1FreePlan).toEqual([]);
  });
});

describe('account gate', () => {
  test('a guest gets no wholesale', () => {
    const { wholesalePlan } = plan({ isMember: false });
    expect(wholesalePlan).toEqual([]);
  });

  test('a member does', () => {
    expect(plan({ isMember: true }).wholesalePlan).toHaveLength(1);
  });
});

describe('multi-line orders', () => {
  test('each line is planned independently and keeps its index', () => {
    const { wholesalePlan } = plan({
      lines: [
        line({ sku: 'VSR-LE-CEN-024', name: 'Microcentrifuge — 24-Place' }), // ineligible
        line(), // eligible
      ],
      variantRows: [row()],
    });
    expect(wholesalePlan).toEqual([{ idx: 1, units: 10, value: 24_000 }]);
  });
});
