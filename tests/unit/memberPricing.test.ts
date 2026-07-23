/**
 * Unit tests for src/lib/memberPricing.ts — the DISPLAY-ONLY member price.
 *
 * The parity block is the important one: it proves the number shown on a card
 * equals what the server's authoritative money engine
 * (place-order/orderTotals.ts::computeOrderTotals) actually bills a member for
 * that unit — so the display can never overstate a discount.
 */
import { describe, expect, test } from 'vitest';
import {
  MEMBER_DISCOUNT_PERCENT,
  isMemberPriceEligible,
  memberPriceCents,
} from '../../src/lib/memberPricing';
import { formatPriceExact } from '../../src/lib/pricing';
import { computeOrderTotals } from '../../supabase/functions/place-order/orderTotals';
import type { Product } from '../../src/types/product';

function product(overrides: Partial<Product> = {}): Product {
  const { tags = [], ...rest } = overrides;
  return { tags, ...rest } as Product;
}

describe('memberPriceCents', () => {
  test('applies 15% off with the checkout rounding rule', () => {
    // 8500 → round(1275) = 1275 off → 7225 = $72.25 (the owner's example).
    expect(memberPriceCents(8500)).toBe(7225);
    // 8700 → round(1305) = 1305 off → 7395.
    expect(memberPriceCents(8700)).toBe(7395);
  });

  test('rounds the discount half-up like Math.round, not the price', () => {
    // 10 * 0.15 = 1.5 → round → 2 off → 8.
    expect(memberPriceCents(10)).toBe(8);
  });

  test('returns null for a missing or non-positive base', () => {
    expect(memberPriceCents(null)).toBeNull();
    expect(memberPriceCents(0)).toBeNull();
    expect(memberPriceCents(-100)).toBeNull();
    expect(memberPriceCents(Number.NaN)).toBeNull();
  });
});

describe('isMemberPriceEligible', () => {
  test('single compounds are eligible', () => {
    expect(isMemberPriceEligible(product({ tags: ['research'] }))).toBe(true);
    expect(isMemberPriceEligible(product({ tags: [] }))).toBe(true);
    expect(isMemberPriceEligible(product({ tags: undefined }))).toBe(true);
  });

  test('blends (e.g. GLOW) are also eligible — a standalone blend line is charged the 15% too', () => {
    expect(isMemberPriceEligible(product({ tags: ['antioxidant-beauty', 'blend', 'research'] }))).toBe(
      true,
    );
  });
});

describe('server parity — display equals what a member is charged', () => {
  // A plain single-line cart with only the 15% account entitlement: no codes,
  // no wholesale, no bundle, no B2G1, no reward. computeOrderTotals' accountCents
  // is exactly what the buyer saves; base − accountCents is what they pay.
  function serverMemberUnitCents(baseCents: number): number {
    const result = computeOrderTotals({
      grossSubtotalCents: baseCents,
      shippingCents: 0,
      flatCentsFromCodes: 0,
      itemUnitPricesCents: [baseCents],
      wholesalePlan: [],
      bundleValue: 0,
      b2g1FreePlan: [],
      rewardPercent: null,
      accountPercent: MEMBER_DISCOUNT_PERCENT,
      percentEntries: [],
    });
    return baseCents - result.accountCents;
  }

  test.each([1999, 5000, 8500, 8700, 10500, 12345, 20000, 33399, 87000])(
    'base %i cents: memberPriceCents matches the server account math',
    (base) => {
      expect(memberPriceCents(base)).toBe(serverMemberUnitCents(base));
    },
  );
});

describe('formatPriceExact', () => {
  test('shows cents only when the amount is not a whole dollar', () => {
    expect(formatPriceExact(7225)).toBe('$72.25');
    expect(formatPriceExact(7395)).toBe('$73.95');
    expect(formatPriceExact(7300)).toBe('$73');
    expect(formatPriceExact(120000)).toBe('$1,200');
    expect(formatPriceExact(null)).toBe('—');
  });
});
