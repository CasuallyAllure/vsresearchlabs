/**
 * Unit tests for the store-reading and arbitration helpers in
 * src/lib/bogoPreview.ts, plus the store-backed clock helpers in
 * src/lib/promoSettings.ts that only BOGO uses.
 *
 * The cross-implementation agreement lives in tests/unit/bogoParity.test.ts and
 * the promo window in tests/unit/bogoWindow.test.ts; this file covers the thin
 * store-reading seams those two deliberately bypass by passing values directly.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import {
  bogoBeatsAccount,
  bogoPreviewFromStore,
  freePlanValue,
} from '../../src/lib/bogoPreview';
import {
  isBogoActive,
  serverNowMs,
  usePromoSettings,
} from '../../src/lib/promoSettings';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { makeCartItem } from '../fixtures/product';

const ENDS_AT = '2026-08-04T07:00:00.000Z'; // Tue 00:00 America/Los_Angeles
const INSIDE_WINDOW = Date.parse('2026-08-02T18:00:00.000Z');
const AFTER_WINDOW = Date.parse('2026-08-05T18:00:00.000Z');

function fastVariant(sku = 'TEST-SKU', dose = '5mg', priceCents = 6_000): VariantOverride {
  return {
    sku, dose,
    on_hand: 5,        // genuine 24-hour supply → BOGO-eligible
    inbound_units: 0,
    price_cents: priceCents,
    lead_days: null,
    hidden: false,
  };
}

/** Pin the store's server clock to a chosen instant, with zero elapsed time. */
function pinServerClock(instantMs: number | null) {
  usePromoSettings.setState({
    serverNowMs: instantMs,
    // performance.now() is monotonic and only its DELTA is used; anchoring
    // fetchedAt to a value far above any plausible reading keeps elapsed at 0
    // via the Math.max clamp, so these tests are deterministic.
    fetchedAtMs: instantMs == null ? null : Number.MAX_SAFE_INTEGER,
  });
}

beforeEach(() => {
  useProductOverrides.setState({
    bySku: {},
    variantBySku: { 'TEST-SKU': { '5mg': fastVariant() } },
  });
  usePromoSettings.setState({
    b2g1Enabled: false, b2g1EndsAt: null, b2g1ExcludedSkus: [],
    bogoEnabled: true, bogoEndsAt: ENDS_AT, bogoExcludedSkus: [],
    serverNowMs: null, fetchedAtMs: null,
    loaded: true, loading: false,
  });
});

const cart = (qty: number) =>
  [makeCartItem({ sku: 'TEST-SKU', name: 'Test Compound — 5mg' }, qty)];

describe('bogoPreviewFromStore — reads liveness from the SERVER clock', () => {
  test('inside the window, a member sees the discount', () => {
    pinServerClock(INSIDE_WINDOW);
    expect(bogoPreviewFromStore(cart(2), true)).toEqual({
      lines: [{ idx: 0, freeUnits: 1, unit: 6_000 }],
      totalCents: 6_000,
    });
  });

  test('after the window closed, the same cart previews nothing', () => {
    pinServerClock(AFTER_WINDOW);
    expect(bogoPreviewFromStore(cart(2), true)).toEqual({ lines: [], totalCents: 0 });
  });

  test('FAILS CLOSED with no server clock — never falls back to the device clock', () => {
    pinServerClock(null);
    expect(bogoPreviewFromStore(cart(2), true)).toEqual({ lines: [], totalCents: 0 });
  });

  test('a guest sees nothing even inside the window', () => {
    pinServerClock(INSIDE_WINDOW);
    expect(bogoPreviewFromStore(cart(2), false)).toEqual({ lines: [], totalCents: 0 });
  });

  test('the master switch off beats a still-open window', () => {
    pinServerClock(INSIDE_WINDOW);
    usePromoSettings.setState({ bogoEnabled: false });
    expect(bogoPreviewFromStore(cart(2), true)).toEqual({ lines: [], totalCents: 0 });
  });

  test('an excluded sku from the store list earns nothing', () => {
    pinServerClock(INSIDE_WINDOW);
    usePromoSettings.setState({ bogoExcludedSkus: ['TEST-SKU'] });
    expect(bogoPreviewFromStore(cart(4), true)).toEqual({ lines: [], totalCents: 0 });
  });
});

describe('serverNowMs / isBogoActive read through the store', () => {
  test('serverNowMs is null until settings have loaded', () => {
    pinServerClock(null);
    expect(serverNowMs()).toBeNull();
  });

  test('serverNowMs returns the pinned server instant', () => {
    pinServerClock(INSIDE_WINDOW);
    expect(serverNowMs()).toBe(INSIDE_WINDOW);
  });

  test('isBogoActive is true inside the window for a non-excluded sku', () => {
    pinServerClock(INSIDE_WINDOW);
    expect(isBogoActive('TEST-SKU')).toBe(true);
  });

  test('isBogoActive is false for an excluded sku', () => {
    pinServerClock(INSIDE_WINDOW);
    usePromoSettings.setState({ bogoExcludedSkus: ['TEST-SKU'] });
    expect(isBogoActive('TEST-SKU')).toBe(false);
  });

  test('isBogoActive is false after the window, and with no clock at all', () => {
    pinServerClock(AFTER_WINDOW);
    expect(isBogoActive('TEST-SKU')).toBe(false);
    pinServerClock(null);
    expect(isBogoActive('TEST-SKU')).toBe(false);
  });
});

describe('bogoBeatsAccount — no-stack arbitration, tie goes to BOGO', () => {
  test('BOGO larger wins', () => {
    expect(bogoBeatsAccount(5_000, 3_000)).toBe(true);
  });

  test('the account percentage larger wins', () => {
    expect(bogoBeatsAccount(3_000, 5_000)).toBe(false);
  });

  test('an exact tie goes to BOGO', () => {
    expect(bogoBeatsAccount(4_200, 4_200)).toBe(true);
  });

  test('both zero → BOGO nominally "wins" nothing, which is harmless', () => {
    expect(bogoBeatsAccount(0, 0)).toBe(true);
  });
});

describe('freePlanValue', () => {
  test('sums freeUnits × unit across lines, in integer cents', () => {
    expect(freePlanValue([
      { freeUnits: 2, unit: 6_000 },
      { freeUnits: 1, unit: 3_333 },
    ])).toBe(15_333);
  });

  test('an empty plan is worth zero', () => {
    expect(freePlanValue([])).toBe(0);
  });
});
