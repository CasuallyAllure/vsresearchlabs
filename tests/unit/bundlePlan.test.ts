/**
 * Unit tests for supabase/functions/place-order/bundlePlan.ts —
 * buildBundlePlan(), the server-side bundle pair math.
 *
 * The adversarial re-review of the 2026-07-16 integration found the gap the
 * `unverifiedKeys` tests pin: an UNVERIFIED (formula-priced) line carries the
 * client's own number, so a near-zero fake line on one bundle SKU could
 * manufacture 20% off a real, fully-priced line of the other. Unverified
 * lines must never form pairs.
 */
import { describe, expect, test } from 'vitest';
import {
  buildBundlePlan,
  bundleLineKey,
  type BundleLineInput,
} from '../../supabase/functions/place-order/bundlePlan';

const SKU_A = 'VSR-RS-RTT';
const SKU_B = 'VSR-RS-GHK';
const PERCENT = 20;

const line = (over: Partial<BundleLineInput> = {}): BundleLineInput => ({
  sku: SKU_A,
  name: 'Retatrutide — 5mg',
  quantity: 1,
  unitPriceCents: 20000,
  ...over,
});

const plan = (lines: BundleLineInput[], unverifiedKeys?: ReadonlySet<string>) =>
  buildBundlePlan({ lines, skuA: SKU_A, skuB: SKU_B, percent: PERCENT, unverifiedKeys });

describe('pair formation', () => {
  test('one of each forms one pair at 20% of the paired value', () => {
    const p = plan([
      line(),
      line({ sku: SKU_B, name: 'GHK-Cu — 50mg', unitPriceCents: 10000 }),
    ]);
    expect(p.pairs).toBe(1);
    expect(p.value).toBe(Math.round((20000 + 10000) * 0.2)); // 6000
  });

  test('pairs cap at the lesser side', () => {
    const p = plan([
      line({ quantity: 3 }),
      line({ sku: SKU_B, name: 'GHK-Cu — 50mg', quantity: 1, unitPriceCents: 10000 }),
    ]);
    expect(p.pairs).toBe(1);
  });

  test('no pair without both SKUs', () => {
    expect(plan([line({ quantity: 5 })])).toEqual({ pairs: 0, value: 0 });
  });

  test('discount is taken on the dearest qualifying units first', () => {
    const p = plan([
      line({ name: 'Retatrutide — 10mg', unitPriceCents: 30000 }),
      line({ name: 'Retatrutide — 5mg', unitPriceCents: 20000 }),
      line({ sku: SKU_B, name: 'GHK-Cu — 50mg', unitPriceCents: 10000 }),
    ]);
    // 1 pair: dearest Reta (30000) + the GHK (10000), never the 20000 vial.
    expect(p.pairs).toBe(1);
    expect(p.value).toBe(Math.round((30000 + 10000) * 0.2)); // 8000
  });

  test('a $0 line never qualifies', () => {
    const p = plan([
      line({ unitPriceCents: 0 }),
      line({ sku: SKU_B, name: 'GHK-Cu — 50mg', unitPriceCents: 10000 }),
    ]);
    expect(p).toEqual({ pairs: 0, value: 0 });
  });
});

describe('unverified (formula-priced) lines are excluded — regression', () => {
  test('a near-zero unverified line cannot manufacture a pair on a real line', () => {
    // The exploit: 1¢ fake Reta (unpriced dose, client names its own price)
    // paired against a genuine $100 GHK line to extract a real 20% discount.
    const fakeReta = line({ name: 'Retatrutide — 5mg', unitPriceCents: 1 });
    const realGhk = line({ sku: SKU_B, name: 'GHK-Cu — 50mg', unitPriceCents: 10000 });
    const unverified = new Set([bundleLineKey(fakeReta.sku, fakeReta.name)]);
    expect(plan([fakeReta, realGhk], unverified)).toEqual({ pairs: 0, value: 0 });
  });

  test('verified lines of the same SKU still pair when a different dose is unverified', () => {
    const verifiedReta = line({ name: 'Retatrutide — 10mg', unitPriceCents: 30000 });
    const unverifiedReta = line({ name: 'Retatrutide — 5mg', unitPriceCents: 1 });
    const realGhk = line({ sku: SKU_B, name: 'GHK-Cu — 50mg', quantity: 2, unitPriceCents: 10000 });
    const unverified = new Set([bundleLineKey(unverifiedReta.sku, unverifiedReta.name)]);
    const p = plan([verifiedReta, unverifiedReta, realGhk], unverified);
    // Only the verified 10mg Reta pairs; the 1¢ line contributes nothing.
    expect(p.pairs).toBe(1);
    expect(p.value).toBe(Math.round((30000 + 10000) * 0.2));
  });

  test('an unverified line on the OTHER side is excluded too', () => {
    const realReta = line({ unitPriceCents: 20000 });
    const fakeGhk = line({ sku: SKU_B, name: 'GHK-Cu — 50mg', unitPriceCents: 1 });
    const unverified = new Set([bundleLineKey(fakeGhk.sku, fakeGhk.name)]);
    expect(plan([realReta, fakeGhk], unverified)).toEqual({ pairs: 0, value: 0 });
  });

  test('no unverifiedKeys set means no exclusion (back-compat)', () => {
    const p = plan([
      line(),
      line({ sku: SKU_B, name: 'GHK-Cu — 50mg', unitPriceCents: 10000 }),
    ]);
    expect(p.pairs).toBe(1);
  });
});
