/**
 * src/lib/reorder.ts — pure order-line → (product, dose, quantity) mapping.
 *
 * The dose is recovered from the snapshotted `product_name` by the same
 * longest-squashed-dose-contained rule fulfillment uses (_resolve_line_dose,
 * migration 068). Pins:
 *   - the correct dose is picked, including the "5mg" ⊂ "15mg" nesting case;
 *   - unknown skus and unresolvable doses are skipped, never guessed
 *     (a guessed/empty dose is the $0-order-line trap);
 *   - quantity is preserved;
 *   - single-config products (no variants) map with dose ''.
 */
import { describe, expect, test } from 'vitest';

import { planReorder, type ReorderLine } from '../../src/lib/reorder';
import { makeProduct } from '../fixtures/product';

const bpc = makeProduct({
  sku: 'VSR-RS-BPC',
  name: 'BPC-157',
  variants: [{ dose: '5mg' }, { dose: '10mg' }],
});

const reta = makeProduct({
  sku: 'VSR-RS-RETA',
  name: 'Retatrutide',
  variants: [{ dose: '5mg' }, { dose: '15mg' }],
});

const mixer = makeProduct({
  sku: 'VSR-LE-MIX',
  name: 'Vortex Mixer',
  variants: [],
  priceCents: 12000,
});

const line = (overrides: Partial<ReorderLine>): ReorderLine => ({
  sku: 'VSR-RS-BPC',
  product_name: 'BPC-157 — 5mg',
  quantity: 1,
  ...overrides,
});

describe('planReorder', () => {
  test('resolves the dose baked into the line name', () => {
    const plan = planReorder([line({ product_name: 'BPC-157 — 10mg', quantity: 2 })], [bpc]);
    expect(plan.skipped).toEqual([]);
    expect(plan.addable).toEqual([{ product: bpc, dose: '10mg', quantity: 2 }]);
  });

  test('picks the longest matching dose ("5mg" nested inside "15mg")', () => {
    const plan = planReorder(
      [line({ sku: 'VSR-RS-RETA', product_name: 'Retatrutide — 15mg' })],
      [reta],
    );
    expect(plan.addable).toEqual([{ product: reta, dose: '15mg', quantity: 1 }]);
  });

  test('dose matching survives spacing/case differences', () => {
    const plan = planReorder([line({ product_name: 'bpc-157 — 5 MG' })], [bpc]);
    expect(plan.addable).toEqual([{ product: bpc, dose: '5mg', quantity: 1 }]);
  });

  test('unknown sku is skipped by product_name', () => {
    const plan = planReorder([line({ sku: 'VSR-GONE', product_name: 'Retired — 5mg' })], [bpc]);
    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['Retired — 5mg']);
  });

  test('a multi-variant product whose name resolves to no dose is skipped', () => {
    const plan = planReorder([line({ product_name: 'BPC-157' })], [bpc]);
    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['BPC-157']);
  });

  test('a dose no longer in the catalog variants is skipped', () => {
    const plan = planReorder([line({ product_name: 'BPC-157 — 20mg' })], [bpc]);
    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['BPC-157 — 20mg']);
  });

  test('single-config products map with an empty dose', () => {
    const plan = planReorder(
      [line({ sku: 'VSR-LE-MIX', product_name: 'Vortex Mixer', quantity: 3 })],
      [mixer],
    );
    expect(plan.addable).toEqual([{ product: mixer, dose: '', quantity: 3 }]);
  });

  test('mixed orders split into addable and skipped with quantities intact', () => {
    const plan = planReorder(
      [
        line({ product_name: 'BPC-157 — 5mg', quantity: 4 }),
        line({ sku: 'VSR-GONE', product_name: 'Retired product' }),
      ],
      [bpc, reta, mixer],
    );
    expect(plan.addable).toEqual([{ product: bpc, dose: '5mg', quantity: 4 }]);
    expect(plan.skipped).toEqual(['Retired product']);
  });
});
