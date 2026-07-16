/**
 * Unit tests for supabase/functions/place-order/priceCheck.ts —
 * findPriceMismatches() / serverPriceForLine().
 *
 * The checkout security net: client-sent line prices are compared against the
 * admin-set price (per-dose product_variant_stock.price_cents, else per-sku
 * product_stock.price_cents_override). Formula-priced lines (no admin price
 * anywhere) are unverifiable and must be skipped, never flagged.
 */
import { describe, expect, test } from 'vitest';
import {
  findPriceMismatches,
  serverPriceForLine,
  type PriceCheckLine,
  type SkuOverrideRow,
  type VariantPriceRow,
} from '../../supabase/functions/place-order/priceCheck';

const line = (over: Partial<PriceCheckLine> = {}): PriceCheckLine => ({
  sku: 'BPC-157',
  name: 'BPC-157 — 5mg',
  unitPriceCents: 6_500,
  ...over,
});

const variant = (over: Partial<VariantPriceRow> = {}): VariantPriceRow => ({
  sku: 'BPC-157',
  dose: '5mg',
  price_cents: 6_500,
  ...over,
});

describe('findPriceMismatches — flag vs pass vs skip', () => {
  test('flags a line whose client price differs from the admin per-dose price', () => {
    // Arrange
    const lines = [line({ unitPriceCents: 100 })];
    const variants = [variant({ price_cents: 6_500 })];

    // Act
    const mismatches = findPriceMismatches(lines, variants, []);

    // Assert
    expect(mismatches).toEqual([
      { sku: 'BPC-157', name: 'BPC-157 — 5mg', clientCents: 100, serverCents: 6_500 },
    ]);
  });

  test('passes a line whose client price equals the admin per-dose price', () => {
    const mismatches = findPriceMismatches([line()], [variant()], []);
    expect(mismatches).toEqual([]);
  });

  test('skips a formula-priced line (no priced row for the sku anywhere)', () => {
    // A $1 price on a line the server genuinely can’t price must NOT be flagged.
    const lines = [line({ unitPriceCents: 100 })];
    expect(findPriceMismatches(lines, [], [])).toEqual([]);
  });

  test('FLAGS a valid-sku line whose dose does not resolve (evasion guard)', () => {
    // Attacker keeps a real sku but rewords the name so no dose matches — the
    // sku HAS priced rows, so this must be flagged (serverCents=null), not
    // silently skipped.
    const lines = [line({ name: 'BPC-157 (peptide)', unitPriceCents: 100 })];
    const variants = [variant({ dose: '5mg', price_cents: 6_500 })];
    const mismatches = findPriceMismatches(lines, variants, []);
    expect(mismatches).toEqual([
      { sku: 'BPC-157', name: 'BPC-157 (peptide)', clientCents: 100, serverCents: null },
    ]);
  });

  test('a zero-width character cannot hide the dose from the matcher', () => {
    // U+200B inserted mid-token used to break the substring match; the squash
    // normalizer strips format/control chars so the dose still matches.
    const lines = [line({ name: 'BPC-157 — 5​mg', unitPriceCents: 100 })];
    const variants = [variant({ dose: '5mg', price_cents: 6_500 })];
    const mismatches = findPriceMismatches(lines, variants, []);
    expect(mismatches).toEqual([
      { sku: 'BPC-157', name: 'BPC-157 — 5​mg', clientCents: 100, serverCents: 6_500 },
    ]);
  });

  test('flags a client-sent $0 price on an admin-priced line', () => {
    const lines = [line({ unitPriceCents: 0 })];
    const mismatches = findPriceMismatches(lines, [variant()], []);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].serverCents).toBe(6_500);
  });

  test('skips lines without a sku', () => {
    const lines = [line({ sku: undefined, unitPriceCents: 100 })];
    expect(findPriceMismatches(lines, [variant()], [])).toEqual([]);
  });

  test('flags each mismatching line independently in a mixed cart', () => {
    const lines = [
      line(), // exact match — passes
      line({ name: 'BPC-157 — 10mg', unitPriceCents: 500 }),
      line({ sku: 'TB-500', name: 'TB-500 — 2mg', unitPriceCents: 4_200 }), // unverifiable — skipped
    ];
    const variants = [
      variant(),
      variant({ dose: '10mg', price_cents: 11_000 }),
    ];
    const mismatches = findPriceMismatches(lines, variants, []);
    expect(mismatches).toEqual([
      { sku: 'BPC-157', name: 'BPC-157 — 10mg', clientCents: 500, serverCents: 11_000 },
    ]);
  });
});

describe('serverPriceForLine — dose matching', () => {
  const overrides = new Map<string, number>();

  test('matches the dose baked into the line name (whitespace/case squashed)', () => {
    const rows = [variant({ dose: '5 MG', price_cents: 7_200 })];
    expect(serverPriceForLine(line({ name: 'bpc-157 — 5mg' }), rows, overrides)).toBe(7_200);
  });

  test('longest matching dose wins — "15mg" is never claimed by the "5mg" row', () => {
    const rows = [
      variant({ dose: '5mg', price_cents: 6_500 }),
      variant({ dose: '15mg', price_cents: 15_500 }),
    ];
    expect(serverPriceForLine(line({ name: 'BPC-157 — 15mg' }), rows, overrides)).toBe(15_500);
  });

  test('matches a dose carried in the line note', () => {
    const rows = [variant({ dose: '10mg', price_cents: 11_000 })];
    const l = line({ name: 'BPC-157', note: 'dose: 10mg', unitPriceCents: 11_000 });
    expect(serverPriceForLine(l, rows, overrides)).toBe(11_000);
  });

  test('ignores variant rows with null price and rows for other SKUs', () => {
    const rows = [
      variant({ price_cents: null }),
      variant({ sku: 'TB-500', price_cents: 9_900 }),
    ];
    expect(serverPriceForLine(line(), rows, overrides)).toBeNull();
  });

  test('ignores empty-dose rows instead of matching every line', () => {
    const rows = [variant({ dose: '', price_cents: 9_900 })];
    expect(serverPriceForLine(line(), rows, overrides)).toBeNull();
  });
});

describe('per-sku override fallback', () => {
  test('falls back to product_stock.price_cents_override when no dose row matches', () => {
    const overrideRows: SkuOverrideRow[] = [{ sku: 'BPC-157', price_cents_override: 8_000 }];
    const lines = [line({ unitPriceCents: 8_000 })];
    expect(findPriceMismatches(lines, [], overrideRows)).toEqual([]);

    const tampered = [line({ unitPriceCents: 100 })];
    expect(findPriceMismatches(tampered, [], overrideRows)).toHaveLength(1);
  });

  test('per-dose price beats the per-sku override', () => {
    const overrideRows: SkuOverrideRow[] = [{ sku: 'BPC-157', price_cents_override: 8_000 }];
    const rows = [variant({ price_cents: 6_500 })];
    const overrides = new Map([['BPC-157', 8_000]]);
    expect(serverPriceForLine(line(), rows, overrides)).toBe(6_500);
    // And a client sending the per-dose price passes even though the sku
    // override differs.
    expect(findPriceMismatches([line({ unitPriceCents: 6_500 })], rows, overrideRows)).toEqual([]);
  });

  test('a null override is not a price of 0', () => {
    const overrideRows: SkuOverrideRow[] = [{ sku: 'BPC-157', price_cents_override: null }];
    expect(findPriceMismatches([line({ unitPriceCents: 100 })], [], overrideRows)).toEqual([]);
  });
});
