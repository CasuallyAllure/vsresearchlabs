/**
 * Unit tests for src/lib/b2g1Preview.ts — computeB2G1Preview() / b2g1NudgeCaption().
 *
 * The client-side CART PREVIEW mirror of the server's B2G1 vs wholesale
 * per-line arbitration (supabase/functions/place-order/promoPlan.ts). Drives
 * useProductOverrides + usePromoSettings store state directly (same pattern
 * as tests/unit/wholesale.test.ts) rather than mocking modules.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import {
  computeB2G1Preview,
  b2g1NudgeCaption,
  b2g1BeatsAccount,
  B2G1_GROUP,
} from '../../src/lib/b2g1Preview';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { usePromoSettings } from '../../src/lib/promoSettings';
import { makeCartItem } from '../fixtures/product';

function variantRow(sku: string, dose: string, over: Partial<VariantOverride> = {}): VariantOverride {
  return {
    sku,
    dose,
    on_hand: 0,
    inbound_units: 0,
    price_cents: 6_000,
    lead_days: 7,
    hidden: false,
    ...over,
  };
}

/** A sourced (slow-ship), admin-priced 5mg dose of TEST-SKU, $60/unit. */
function setSourcedVariant(sku = 'TEST-SKU', dose = '5mg', over: Partial<VariantOverride> = {}) {
  useProductOverrides.setState({
    variantBySku: { [sku]: { [dose]: variantRow(sku, dose, over) } },
  });
}

function item(qty: number, sku = 'TEST-SKU', dose = '5mg') {
  return makeCartItem({ sku, name: `Test Compound — ${dose}` }, qty);
}

beforeEach(() => {
  useProductOverrides.setState({ bySku: {}, variantBySku: {} });
  usePromoSettings.setState({
    b2g1Enabled: false,
    b2g1EndsAt: null,
    b2g1ExcludedSkus: [],
    loaded: true,
    loading: false,
  });
});

describe('computeB2G1Preview — eligibility', () => {
  test('qty 3 with the promo live awards exactly 1 free unit', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(3)], false);

    expect(preview).toEqual({
      lines: [{ idx: 0, freeUnits: 1, valueCents: 6_000 }],
      totalCents: 6_000,
      suppressedByWholesale: false,
    });
  });

  test('qty 6 awards exactly 2 free units', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(6)], false);

    expect(preview.lines).toEqual([{ idx: 0, freeUnits: 2, valueCents: 12_000 }]);
    expect(preview.totalCents).toBe(12_000);
  });

  test('qty 2 (below the nudge floor) earns nothing yet', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(2)], false);

    expect(preview.lines).toEqual([]);
    expect(preview.totalCents).toBe(0);
  });

  test('a fast (24-hour) dose never gets B2G1, even at qty 3', () => {
    setSourcedVariant('TEST-SKU', '5mg', { on_hand: 8, lead_days: null });
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(3)], false);

    expect(preview.lines).toEqual([]);
  });

  test('the promo not being live earns nothing', () => {
    setSourcedVariant();
    // b2g1Enabled defaults to false in beforeEach.

    const preview = computeB2G1Preview([item(3)], false);

    expect(preview.lines).toEqual([]);
  });

  test('an excluded sku earns nothing', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true, b2g1ExcludedSkus: ['TEST-SKU'] });

    const preview = computeB2G1Preview([item(3)], false);

    expect(preview.lines).toEqual([]);
  });

  test('an untracked (unknown) variant earns nothing — no server row to promo off', () => {
    usePromoSettings.setState({ b2g1Enabled: true });
    // No useProductOverrides.setState call — variantBySku stays empty.

    const preview = computeB2G1Preview([item(3)], false);

    expect(preview.lines).toEqual([]);
  });

  test('a tracked dose with no admin price earns nothing', () => {
    setSourcedVariant('TEST-SKU', '5mg', { price_cents: null });
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(3)], false);

    expect(preview.lines).toEqual([]);
  });

  test('a line with no sku earns nothing', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(3, '')], false);

    expect(preview.lines).toEqual([]);
  });
});

describe('computeB2G1Preview — wholesale precedence (per-line arbitration)', () => {
  test('qty 6 → B2G1 (2 free ≈ 33%) beats the half kit (27%) for a member', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(6)], true);

    expect(preview.lines).toEqual([{ idx: 0, freeUnits: 2, valueCents: 12_000 }]);
    expect(preview.suppressedByWholesale).toBe(false);
  });

  test('qty 10 → the case (40%) beats B2G1 (3 free ≈ 30%) and suppresses the whole order', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(10)], true);

    expect(preview.lines).toEqual([]);
    expect(preview.totalCents).toBe(0);
    expect(preview.suppressedByWholesale).toBe(true);
  });

  test('a guest never gets wholesale, so qty 10 still earns B2G1', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview([item(10)], false);

    expect(preview.lines).toEqual([{ idx: 0, freeUnits: 3, valueCents: 18_000 }]);
    expect(preview.suppressedByWholesale).toBe(false);
  });

  test('a wholesale win on a FAST line still suppresses B2G1 on a different slow line', () => {
    setSourcedVariant('TEST-SKU-SLOW', '5mg');
    useProductOverrides.setState((s) => ({
      variantBySku: {
        ...s.variantBySku,
        'TEST-SKU-FAST': { '10mg': variantRow('TEST-SKU-FAST', '10mg', { on_hand: 20, lead_days: null }) },
      },
    }));
    usePromoSettings.setState({ b2g1Enabled: true });

    const preview = computeB2G1Preview(
      [item(3, 'TEST-SKU-SLOW', '5mg'), item(10, 'TEST-SKU-FAST', '10mg')],
      true,
    );

    // The fast line (qty 10, on-hand) wins wholesale on its own — B2G1 never
    // applies anywhere, order-wide, exactly like place-order's hasWholesale
    // gate (which zeroes b2g1FreePlan for the WHOLE order, not just that line).
    expect(preview.lines).toEqual([]);
    expect(preview.suppressedByWholesale).toBe(true);
  });
});

describe('b2g1BeatsAccount — owner policy 2026-07-22 exclusivity', () => {
  test('B2G1 bigger than the account candidate — B2G1 wins', () => {
    expect(b2g1BeatsAccount(2_000, 800)).toBe(true);
  });

  test('account candidate bigger than B2G1 — account wins', () => {
    expect(b2g1BeatsAccount(2_000, 4_000)).toBe(false);
  });

  test('a tie goes to B2G1', () => {
    expect(b2g1BeatsAccount(2_000, 2_000)).toBe(true);
  });

  test('no account candidate (guest, or no entitlement) — B2G1 always "wins" (nothing to suppress)', () => {
    expect(b2g1BeatsAccount(2_000, 0)).toBe(true);
  });

  test('no B2G1 value — the account candidate "wins" (nothing to suppress)', () => {
    expect(b2g1BeatsAccount(0, 800)).toBe(false);
  });

  test('both zero — B2G1 "wins" but there is nothing to show either way', () => {
    expect(b2g1BeatsAccount(0, 0)).toBe(true);
  });
});

describe('B2G1_GROUP', () => {
  test('is 3 — kept in sync with promoPlan.ts', () => {
    expect(B2G1_GROUP).toBe(3);
  });
});

describe('b2g1NudgeCaption', () => {
  test('nudges at qty 1: "Add 2 more — third unit free"', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    expect(b2g1NudgeCaption(item(1))).toBe('Add 2 more — third unit free');
  });

  test('nudges at qty 2: "Add 1 more — third unit free"', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    expect(b2g1NudgeCaption(item(2))).toBe('Add 1 more — third unit free');
  });

  test('returns null at qty 3 — the line already earned the free unit', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true });

    expect(b2g1NudgeCaption(item(3))).toBeNull();
  });

  test('returns null for a fast (24-hour) line', () => {
    setSourcedVariant('TEST-SKU', '5mg', { on_hand: 8, lead_days: null });
    usePromoSettings.setState({ b2g1Enabled: true });

    expect(b2g1NudgeCaption(item(1))).toBeNull();
  });

  test('returns null when the promo is not live', () => {
    setSourcedVariant();

    expect(b2g1NudgeCaption(item(1))).toBeNull();
  });

  test('returns null for an excluded sku', () => {
    setSourcedVariant();
    usePromoSettings.setState({ b2g1Enabled: true, b2g1ExcludedSkus: ['TEST-SKU'] });

    expect(b2g1NudgeCaption(item(1))).toBeNull();
  });

  test('returns null for an untracked variant', () => {
    usePromoSettings.setState({ b2g1Enabled: true });

    expect(b2g1NudgeCaption(item(1))).toBeNull();
  });

  test('returns null for a tracked dose with no admin price', () => {
    setSourcedVariant('TEST-SKU', '5mg', { price_cents: null });
    usePromoSettings.setState({ b2g1Enabled: true });

    expect(b2g1NudgeCaption(item(1))).toBeNull();
  });
});
