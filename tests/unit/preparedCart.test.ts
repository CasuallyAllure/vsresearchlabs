/**
 * src/lib/preparedCart.ts — the pure logic behind an admin-built member cart.
 *
 * Two things must hold or the feature is a production incident waiting to
 * happen, so both are pinned here rather than left to the UI:
 *
 *   1. LINE SHAPE ROUND-TRIPS. A stored `(sku, dose, quantity)` must come back
 *      out as a `(product, dose, quantity)` triple that `variantProduct` turns
 *      into a properly dosed cart line — `id` ending `::<dose>`, `name`
 *      carrying "— <dose>", `priceCents` equal to `effectiveTierPriceCents`.
 *      A bare `add()` (dose dropped) is the $0-order-line incident; the
 *      round-trip test below is its regression guard.
 *
 *   2. PRICE RESOLUTION USES OVERRIDES. Base price must come from
 *      `effectiveTierPriceCents`, so an admin per-dose override wins over the
 *      placeholder hash formula. `tierPriceCents` alone has caused two separate
 *      production price bugs.
 *
 * `isVariantPublic` / `variantPriceCents` read the productOverrides zustand
 * store, so the suite drives that store directly (the cartActions.test.ts
 * pattern) and resets it between tests.
 */
import { afterEach, describe, expect, test } from 'vitest';

import {
  buildVariantIndex,
  findVariantOption,
  memberUnitPriceCents,
  planPreparedCart,
  priceLines,
  variantOptionKey,
  type PreparedCartLine,
} from '../../src/lib/preparedCart';
import { variantProduct } from '../../src/lib/cartActions';
import { effectiveTierPriceCents } from '../../src/lib/pricing';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { makeProduct } from '../fixtures/product';

const INITIAL_STATE = { bySku: {}, variantBySku: {}, loaded: false, loading: false, error: null };

const bpc = makeProduct({
  sku: 'VSR-RS-BPC',
  name: 'BPC-157',
  variants: [{ dose: '5mg' }, { dose: '10mg' }],
});

const reta = makeProduct({
  sku: 'VSR-RS-RETA',
  name: 'Retatrutide',
  variants: [{ dose: '15mg' }],
});

const mixer = makeProduct({
  sku: 'VSR-LE-MIX',
  name: 'Vortex Mixer',
  variants: [],
  priceCents: 12_000,
});

/** Install per-dose overrides the way the master inventory import would. */
function setVariants(entries: Array<{ sku: string; dose: string } & Partial<VariantOverride>>) {
  const variantBySku: Record<string, Record<string, VariantOverride>> = {};
  for (const e of entries) {
    variantBySku[e.sku] = variantBySku[e.sku] ?? {};
    variantBySku[e.sku][e.dose] = {
      sku: e.sku,
      dose: e.dose,
      on_hand: e.on_hand ?? 5,
      inbound_units: e.inbound_units ?? 0,
      price_cents: e.price_cents ?? null,
      lead_days: e.lead_days ?? null,
      hidden: e.hidden ?? false,
    };
  }
  useProductOverrides.setState({ variantBySku });
}

afterEach(() => {
  useProductOverrides.setState(INITIAL_STATE);
});

/* ── buildVariantIndex ─────────────────────────────────────────────────────── */

describe('buildVariantIndex', () => {
  test('groups sellable doses under their compound and sorts the compound list', () => {
    setVariants([
      { sku: 'VSR-RS-BPC', dose: '5mg', price_cents: 6_000 },
      { sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 },
      { sku: 'VSR-RS-RETA', dose: '15mg', price_cents: 24_000 },
    ]);

    const index = buildVariantIndex([reta, bpc]);

    expect(index.compoundNames).toEqual(['BPC-157', 'Retatrutide']);
    expect(index.byCompound.get('BPC-157')).toEqual([
      { sku: 'VSR-RS-BPC', dose: '5mg', name: 'BPC-157 — 5mg', priceCents: 6_000 },
      { sku: 'VSR-RS-BPC', dose: '10mg', name: 'BPC-157 — 10mg', priceCents: 9_500 },
    ]);
  });

  test('uses the admin per-dose override, not the placeholder formula', () => {
    setVariants([{ sku: 'VSR-RS-BPC', dose: '5mg', price_cents: 4_242 }]);

    const [option] = buildVariantIndex([bpc]).byCompound.get('BPC-157') ?? [];

    expect(option.priceCents).toBe(4_242);
    expect(option.priceCents).toBe(effectiveTierPriceCents(bpc, '5mg'));
  });

  test('omits a dose the master sheet hides', () => {
    setVariants([
      { sku: 'VSR-RS-BPC', dose: '5mg', price_cents: 6_000 },
      { sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500, hidden: true },
    ]);

    const doses = (buildVariantIndex([bpc]).byCompound.get('BPC-157') ?? []).map((o) => o.dose);

    expect(doses).toEqual(['5mg']);
  });

  test('omits a compound whose every dose is unsellable', () => {
    // Tracked sku, tracked dose, no price and no supply signal at all — the
    // master sheet's "xx" convention for "do not offer this".
    setVariants([{ sku: 'VSR-RS-BPC', dose: '5mg', on_hand: 0, inbound_units: 0, price_cents: null }]);

    const index = buildVariantIndex([bpc]);

    expect(index.compoundNames).toEqual([]);
    expect(index.byCompound.get('BPC-157')).toBeUndefined();
  });

  test('skips a dose with no resolvable price', () => {
    // Untracked sku → isVariantPublic passes; a dose with no mg magnitude and a
    // product carrying no own price → effectiveTierPriceCents is null.
    const vials = makeProduct({
      sku: 'VSR-LE-VIAL',
      name: 'Sterile Vials',
      variants: [{ dose: '30 mL' }],
      priceCents: null,
    });

    expect(buildVariantIndex([vials]).compoundNames).toEqual([]);
  });

  test('products with no variants contribute nothing to the picker', () => {
    expect(buildVariantIndex([mixer]).compoundNames).toEqual([]);
  });

  test('a dose-less variant is labelled with the bare product name', () => {
    // Single-config equipment sold as one variant with no dose string: the
    // label must not become "Benchtop Centrifuge — ".
    const centrifuge = makeProduct({
      sku: 'VSR-LE-CENT',
      name: 'Benchtop Centrifuge',
      variants: [{ dose: '' }],
      priceCents: 45_000,
    });

    expect(buildVariantIndex([centrifuge]).byCompound.get('Benchtop Centrifuge')).toEqual([
      { sku: 'VSR-LE-CENT', dose: '', name: 'Benchtop Centrifuge', priceCents: 45_000 },
    ]);
  });
});

/* ── option keys ───────────────────────────────────────────────────────────── */

describe('variantOptionKey / findVariantOption', () => {
  test('an option round-trips through its key — no SKU is ever parsed from a label', () => {
    setVariants([{ sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 }]);
    const index = buildVariantIndex([bpc]);

    const found = findVariantOption(index, 'VSR-RS-BPC|10mg');

    expect(found).toMatchObject({ sku: 'VSR-RS-BPC', dose: '10mg', priceCents: 9_500 });
    expect(variantOptionKey(found!)).toBe('VSR-RS-BPC|10mg');
  });

  test('returns null for an empty key and for a key no longer in the index', () => {
    setVariants([{ sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 }]);
    const index = buildVariantIndex([bpc]);

    expect(findVariantOption(index, '')).toBeNull();
    expect(findVariantOption(index, 'VSR-RS-BPC|999mg')).toBeNull();
  });
});

/* ── member price ──────────────────────────────────────────────────────────── */

describe('memberUnitPriceCents', () => {
  test('applies the checkout rounding rule exactly', () => {
    // 7395 × 15% = 1109.25 → round 1109 → 6286. The same
    // Math.round(base * percent / 100) the server's account slice uses.
    expect(memberUnitPriceCents(7_395, 15)).toBe(6_286);
    expect(memberUnitPriceCents(10_000, 20)).toBe(8_000);
  });

  test('a pro member at 20% pays less than a member at 15%', () => {
    expect(memberUnitPriceCents(10_000, 20)).toBeLessThan(memberUnitPriceCents(10_000, 15)!);
  });

  test('null / non-positive / non-finite bases have no member price to show', () => {
    expect(memberUnitPriceCents(null, 15)).toBeNull();
    expect(memberUnitPriceCents(0, 15)).toBeNull();
    expect(memberUnitPriceCents(-100, 15)).toBeNull();
    expect(memberUnitPriceCents(Number.NaN, 15)).toBeNull();
  });

  test('a nonsensical percent degrades to list price, never to a bigger promise', () => {
    expect(memberUnitPriceCents(10_000, 0)).toBe(10_000);
    expect(memberUnitPriceCents(10_000, -5)).toBe(10_000);
    expect(memberUnitPriceCents(10_000, Number.NaN)).toBe(10_000);
  });

  test('a 100% rate floors at zero rather than going negative', () => {
    expect(memberUnitPriceCents(10_000, 150)).toBe(0);
  });
});

/* ── priceLines ────────────────────────────────────────────────────────────── */

describe('priceLines', () => {
  test('prices each line at the member rate and totals both columns', () => {
    setVariants([
      { sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 },
      { sku: 'VSR-RS-RETA', dose: '15mg', price_cents: 24_000 },
    ]);
    const index = buildVariantIndex([bpc, reta]);

    const pricing = priceLines(
      [
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
        { sku: 'VSR-RS-RETA', dose: '15mg', quantity: 1 },
      ],
      index,
      15,
    );

    expect(pricing.lines.map((l) => l.name)).toEqual(['BPC-157 — 10mg', 'Retatrutide — 15mg']);
    expect(pricing.lines[0]).toMatchObject({
      listUnitCents: 9_500, memberUnitCents: 8_075, listLineCents: 19_000, memberLineCents: 16_150,
    });
    expect(pricing.listTotalCents).toBe(19_000 + 24_000);
    expect(pricing.memberTotalCents).toBe(16_150 + 20_400);
    expect(pricing.savingsCents).toBe(pricing.listTotalCents - pricing.memberTotalCents);
    expect(pricing.unpriced).toEqual([]);
  });

  test('a line whose variant left the catalog is reported, never priced at zero', () => {
    setVariants([{ sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 }]);
    const index = buildVariantIndex([bpc]);

    const gone: PreparedCartLine = { sku: 'VSR-RS-GONE', dose: '5mg', quantity: 3 };
    const pricing = priceLines([gone, { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 }], index, 15);

    expect(pricing.unpriced).toEqual([gone]);
    expect(pricing.lines).toHaveLength(1);
    expect(pricing.listTotalCents).toBe(9_500);
  });

  test('an empty cart prices to zero without inventing a saving', () => {
    const pricing = priceLines([], buildVariantIndex([]), 15);

    expect(pricing).toMatchObject({ listTotalCents: 0, memberTotalCents: 0, savingsCents: 0 });
  });
});

/* ── the claim seam: line shape round-tripping ─────────────────────────────── */

describe('planPreparedCart', () => {
  test('a stored line round-trips into a properly DOSED cart line', () => {
    // The $0-order-line regression test. A bare add() implementation — one that
    // pushed `product` without threading `dose` through variantProduct — fails
    // every assertion below.
    setVariants([{ sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 }]);

    const plan = planPreparedCart([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }], [bpc]);

    expect(plan.skipped).toEqual([]);
    expect(plan.addable).toEqual([{ product: bpc, dose: '10mg', quantity: 2 }]);

    const line = variantProduct(plan.addable[0].product, plan.addable[0].dose);
    expect(line.id).toBe('VSR-RS-BPC::10mg');
    expect(line.name).toBe('BPC-157 — 10mg');
    expect(line.priceCents).toBe(9_500);
    expect(line.priceCents).toBe(effectiveTierPriceCents(bpc, '10mg'));
  });

  test('distinct doses of one compound stay distinct cart lines', () => {
    setVariants([
      { sku: 'VSR-RS-BPC', dose: '5mg', price_cents: 6_000 },
      { sku: 'VSR-RS-BPC', dose: '10mg', price_cents: 9_500 },
    ]);

    const ids = planPreparedCart(
      [
        { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 },
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 },
      ],
      [bpc],
    ).addable.map((i) => variantProduct(i.product, i.dose).id);

    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(['VSR-RS-BPC::5mg', 'VSR-RS-BPC::10mg']);
  });

  test('a multi-variant line with NO dose is skipped, never added dose-less', () => {
    const plan = planPreparedCart([{ sku: 'VSR-RS-BPC', dose: '', quantity: 1 }], [bpc]);

    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['VSR-RS-BPC']);
  });

  test('a dose the product does not sell is skipped', () => {
    const plan = planPreparedCart([{ sku: 'VSR-RS-BPC', dose: '50mg', quantity: 1 }], [bpc]);

    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['VSR-RS-BPC · 50mg']);
  });

  test('an unknown sku is skipped and reported', () => {
    const plan = planPreparedCart([{ sku: 'VSR-RS-NOPE', dose: '5mg', quantity: 1 }], [bpc]);

    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['VSR-RS-NOPE · 5mg']);
  });

  test('non-positive and non-integer quantities are skipped', () => {
    const plan = planPreparedCart(
      [
        { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 0 },
        { sku: 'VSR-RS-BPC', dose: '5mg', quantity: -2 },
        { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1.5 },
      ],
      [bpc],
    );

    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toHaveLength(3);
  });

  test('a single-config product maps with dose "" and passes through variantProduct unchanged', () => {
    const plan = planPreparedCart([{ sku: 'VSR-LE-MIX', dose: '', quantity: 1 }], [mixer]);

    expect(plan.addable).toEqual([{ product: mixer, dose: '', quantity: 1 }]);
    expect(variantProduct(mixer, '')).toBe(mixer);
  });

  test('a stray dose on a single-config product is normalized away', () => {
    const plan = planPreparedCart([{ sku: 'VSR-LE-MIX', dose: '10mg', quantity: 1 }], [mixer]);

    expect(plan.addable).toEqual([{ product: mixer, dose: '', quantity: 1 }]);
  });

  test('a dose with no resolvable price is skipped rather than added at $0', () => {
    const vials = makeProduct({
      sku: 'VSR-LE-VIAL',
      name: 'Sterile Vials',
      variants: [{ dose: '30 mL' }],
      priceCents: null,
    });

    const plan = planPreparedCart([{ sku: 'VSR-LE-VIAL', dose: '30 mL', quantity: 1 }], [vials]);

    expect(plan.addable).toEqual([]);
    expect(plan.skipped).toEqual(['VSR-LE-VIAL · 30 mL']);
  });

  test('good lines still come through when a sibling line is unresolvable', () => {
    setVariants([{ sku: 'VSR-RS-BPC', dose: '5mg', price_cents: 6_000 }]);

    const plan = planPreparedCart(
      [
        { sku: 'VSR-RS-NOPE', dose: '5mg', quantity: 1 },
        { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 4 },
      ],
      [bpc],
    );

    expect(plan.addable).toEqual([{ product: bpc, dose: '5mg', quantity: 4 }]);
    expect(plan.skipped).toEqual(['VSR-RS-NOPE · 5mg']);
  });
});
