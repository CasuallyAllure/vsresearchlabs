/**
 * Unit tests for supabase/functions/place-order/priceCheck.ts —
 * verifyLinePrices() / resolveLinePrice() / resolveVariantRow().
 *
 * The checkout price authority (P0-1). Client-sent line prices are verified
 * against the admin-set price (per-dose product_variant_stock.price_cents, else
 * per-sku product_stock.price_cents_override) and the order is REFUSED on any
 * discrepancy — exact cents, no tolerance.
 *
 * The one line allowed through unverified is a real catalog dose with no admin
 * price (the client formula-prices it and the server has nothing to compare
 * against). It is reported so it lands on the admin order timeline.
 */
import { describe, expect, test } from 'vitest';
import {
  priceFailureMessage,
  resolveLinePrice,
  resolveVariantRow,
  verifyLinePrices,
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

const priceOf = (
  l: PriceCheckLine,
  rows: VariantPriceRow[],
  overrides = new Map<string, number>(),
): number | null => {
  const r = resolveLinePrice(l, rows, overrides);
  return r.kind === 'priced' ? r.cents : null;
};

describe('verifyLinePrices — reject vs pass vs allow-unverified', () => {
  test('REFUSES the order when a client price differs from the admin per-dose price', () => {
    // Arrange — the P0-1 attack: invoice yourself $1 for a $65 vial.
    const lines = [line({ unitPriceCents: 100 })];
    const variants = [variant({ price_cents: 6_500 })];

    // Act
    const verdict = verifyLinePrices(lines, variants, []);

    // Assert
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual([
      {
        sku: 'BPC-157',
        name: 'BPC-157 — 5mg',
        clientCents: 100,
        serverCents: 6_500,
        reason: 'price_mismatch',
      },
    ]);
  });

  test('passes a line whose client price equals the admin per-dose price', () => {
    const verdict = verifyLinePrices([line()], [variant()], []);
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.unverified).toEqual([]);
  });

  test('rejects an off-by-one-cent price — exact match, no tolerance', () => {
    const verdict = verifyLinePrices([line({ unitPriceCents: 6_499 })], [variant()], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('price_mismatch');
  });

  test('rejects a price ABOVE the catalog price too (overbilling is a failure)', () => {
    const verdict = verifyLinePrices([line({ unitPriceCents: 9_999 })], [variant()], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('price_mismatch');
  });

  test('ALLOWS but reports a formula-priced dose (real row, no admin price)', () => {
    // Live shape: TB-500 5mg — 8 on hand, ships 24hr, no admin price, while the
    // sku's 10mg IS priced. Refusing this would break a real buy path; billing
    // it silently would hide it. So: allowed, reported.
    const lines = [line({ name: 'TB-500 — 5mg', sku: 'TB-500', unitPriceCents: 5_000 })];
    const variants: VariantPriceRow[] = [
      { sku: 'TB-500', dose: '5mg', price_cents: null },
      { sku: 'TB-500', dose: '10mg', price_cents: 7_100 },
    ];

    const verdict = verifyLinePrices(lines, variants, []);

    expect(verdict.ok).toBe(true);
    expect(verdict.unverified).toEqual([
      { sku: 'TB-500', name: 'TB-500 — 5mg', clientCents: 5_000 },
    ]);
  });

  test('REFUSES a valid-sku line whose dose does not resolve (evasion guard)', () => {
    // Attacker keeps a real sku but rewords the name so no dose matches.
    const lines = [line({ name: 'BPC-157 (peptide)', unitPriceCents: 100 })];
    const variants = [variant({ dose: '5mg', price_cents: 6_500 })];
    const verdict = verifyLinePrices(lines, variants, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toMatchObject({ reason: 'dose_unresolved', serverCents: null });
  });

  test('a zero-width character cannot hide the dose from the matcher', () => {
    // U+200B inserted mid-token used to break the substring match; the squash
    // normalizer strips format/control chars so the dose still resolves — and
    // the tampered $1 price is refused.
    const lines = [line({ name: 'BPC-157 — 5​mg', unitPriceCents: 100 })];
    const verdict = verifyLinePrices(lines, [variant({ dose: '5mg', price_cents: 6_500 })], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toMatchObject({ reason: 'price_mismatch', serverCents: 6_500 });
  });

  test('REFUSES a client-sent $0 line unconditionally', () => {
    // The client never legitimately sends a free line — server-generated free
    // promo lines are appended after this gate. Kills the reachable $0-line
    // class (HCG 1000iu et al, whose non-mg dose formula-resolves to null → 0).
    const verdict = verifyLinePrices([line({ unitPriceCents: 0 })], [variant()], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('zero_price');
  });

  test('REFUSES a $0 line even when the sku is unpriceable', () => {
    const verdict = verifyLinePrices(
      [line({ sku: 'HCG', name: 'HCG — 5000iu', unitPriceCents: 0 })],
      [{ sku: 'HCG', dose: '5000iu', price_cents: null }],
      [],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('zero_price');
  });

  test('REFUSES a line with no sku (unverifiable by construction)', () => {
    // Every catalog product has a sku, so dropping it is an evasion attempt —
    // and under flag-only it was the cheapest way to skip the check entirely.
    const verdict = verifyLinePrices([line({ sku: undefined, unitPriceCents: 100 })], [variant()], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('missing_sku');
  });

  test('REFUSES a malformed sku instead of silently skipping it', () => {
    // A sku outside the catalog charset is kept out of the .in() query it could
    // malform — but it must not therefore escape verification.
    const verdict = verifyLinePrices([line({ sku: 'BPC-157 ' })], [variant()], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('malformed_sku');
  });

  test('REFUSES an unknown sku (no catalog price data anywhere)', () => {
    // Bogus sku + a real-looking name would otherwise be billed at whatever the
    // client claimed.
    const verdict = verifyLinePrices(
      [line({ sku: 'NOT-A-SKU', name: 'Retatrutide — 10mg', unitPriceCents: 100 })],
      [variant()],
      [],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('unknown_sku');
  });

  test('one bad line refuses the whole order, and every failure is reported', () => {
    const lines = [
      line(), // exact match — passes
      line({ name: 'BPC-157 — 10mg', unitPriceCents: 500 }), // tampered
      line({ sku: 'TB-500', name: 'TB-500 — 2mg', unitPriceCents: 4_200 }), // unknown sku
    ];
    const variants = [variant(), variant({ dose: '10mg', price_cents: 11_000 })];

    const verdict = verifyLinePrices(lines, variants, []);

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.reason)).toEqual(['price_mismatch', 'unknown_sku']);
  });

  test('an empty order verifies clean (nothing to check)', () => {
    expect(verifyLinePrices([], [], [])).toEqual({ ok: true, failures: [], unverified: [] });
  });
});

describe('resolveLinePrice — dose matching', () => {
  test('matches the dose baked into the line name (whitespace/case squashed)', () => {
    const rows = [variant({ dose: '5 MG', price_cents: 7_200 })];
    expect(priceOf(line({ name: 'bpc-157 — 5mg' }), rows)).toBe(7_200);
  });

  test('longest matching dose wins — "15mg" is never claimed by the "5mg" row', () => {
    const rows = [
      variant({ dose: '5mg', price_cents: 6_500 }),
      variant({ dose: '15mg', price_cents: 15_500 }),
    ];
    expect(priceOf(line({ name: 'BPC-157 — 15mg' }), rows)).toBe(15_500);
  });

  test('the note is NOT an identity signal — a dose only in the note resolves nothing', () => {
    // `note` is a free-text message to the seller. The dose lives in the name by
    // construction (cartActions.variantProduct), which is also what the operator
    // reads when picking the vial — so it is the only field where "billed for"
    // and "shipped" are the same string.
    const rows = [variant({ dose: '10mg', price_cents: 11_000 })];
    const l = line({ name: 'BPC-157', note: 'dose: 10mg', unitPriceCents: 11_000 });
    expect(priceOf(l, rows)).toBeNull();
    expect(verifyLinePrices([l], rows, []).failures[0].reason).toBe('dose_unresolved');
  });

  test('a note cannot pull the price down to a cheaper dose', () => {
    const rows = [
      variant({ dose: '5mg', price_cents: 6_000 }),
      variant({ dose: '20mg', price_cents: 20_000 }),
    ];
    const l = line({ name: 'BPC-157 — 20mg', note: '5mg', unitPriceCents: 6_000 });
    expect(priceOf(l, rows)).toBe(20_000);
    expect(verifyLinePrices([l], rows, []).failures[0].reason).toBe('price_mismatch');
  });

  test('ignores rows for other SKUs', () => {
    const rows = [variant({ sku: 'TB-500', price_cents: 9_900 })];
    expect(resolveLinePrice(line(), rows, new Map()).kind).toBe('unknown');
  });

  test('a null-priced matched row is "unpriced", not a price of 0', () => {
    const rows = [variant({ price_cents: null })];
    expect(resolveLinePrice(line(), rows, new Map()).kind).toBe('unpriced');
  });

  test('ignores empty-dose rows instead of matching every line', () => {
    const rows = [variant({ dose: '', price_cents: 9_900 })];
    expect(priceOf(line(), rows)).toBeNull();
  });
});

describe('resolveVariantRow — shared by the price check and the promo planner', () => {
  test('returns the whole row, so callers can read their own columns off it', () => {
    const rows = [
      { sku: 'BPC-157', dose: '5mg', wholesale_eligible: true },
      { sku: 'BPC-157', dose: '10mg', wholesale_eligible: false },
    ];
    expect(resolveVariantRow('BPC-157', 'BPC-157 — 10mg', rows)).toEqual(rows[1]);
  });

  test('returns null when nothing matches', () => {
    expect(resolveVariantRow('BPC-157', 'BPC-157 (peptide)', [
      { sku: 'BPC-157', dose: '5mg' },
    ])).toBeNull();
  });

  test('IGF-1 LR3 collision: "0.1mg" is not claimed by the "1mg" row', () => {
    // Live catalog data (VSR-RS-IGF): squash("igf-1lr3—0.1mg") contains "1mg",
    // so a naive substring match resolves the 0.1mg line onto the 1mg row.
    // Longest-match wins prevents it.
    const rows = [
      { sku: 'VSR-RS-IGF', dose: '1mg' },
      { sku: 'VSR-RS-IGF', dose: '0.1mg' },
    ];
    expect(resolveVariantRow('VSR-RS-IGF', 'IGF-1 LR3 — 0.1mg', rows)).toEqual(rows[1]);
  });

  test('text naming TWO doses is ambiguous → unresolved, not longest-wins', () => {
    // The exploit longest-match alone allows, on live data (VSR-RS-IGF):
    // squashing removes the space, so "IGF-1 LR3 — 1mg 0.1mg" contains both
    // "1mg" and "0.1mg"; the longer wins and an honest-looking 1mg line bills at
    // the 0.1mg price, while the operator ships what the name says. The two
    // matches sit on non-overlapping regions — a real line names its dose once.
    const rows = [
      { sku: 'VSR-RS-IGF', dose: '1mg' },
      { sku: 'VSR-RS-IGF', dose: '0.1mg' },
    ];
    expect(resolveVariantRow('VSR-RS-IGF', 'IGF-1 LR3 — 1mg 0.1mg', rows)).toBeNull();
    expect(resolveVariantRow('VSR-RS-IGF', 'IGF-1 LR3 — 0.1mg 1mg', rows)).toBeNull();
  });

  test('a nested dose is not a second dose — the honest line still resolves', () => {
    // "1mg" matches INSIDE "0.1mg" (overlapping), which is the normal case and
    // must not be mistaken for ambiguity.
    const rows = [
      { sku: 'VSR-RS-IGF', dose: '1mg' },
      { sku: 'VSR-RS-IGF', dose: '0.1mg' },
    ];
    expect(resolveVariantRow('VSR-RS-IGF', 'IGF-1 LR3 — 0.1mg', rows)).toEqual(rows[1]);
    expect(resolveVariantRow('VSR-RS-IGF', 'IGF-1 LR3 — 1mg', rows)).toEqual(rows[0]);
  });
});

describe('dose substitution (the whole point of resolving server-side)', () => {
  test('REFUSES a 1mg line billed at the 0.1mg price via the note', () => {
    // The note is not read at all, so the name resolves honestly to the 1mg row
    // and the tampered price is caught as a plain mismatch against the real $50.
    const rows: VariantPriceRow[] = [
      { sku: 'VSR-RS-IGF', dose: '1mg', price_cents: 5_000 },
      { sku: 'VSR-RS-IGF', dose: '0.1mg', price_cents: 1_000 },
    ];
    const attack = line({ sku: 'VSR-RS-IGF', name: 'IGF-1 LR3 — 1mg', note: '0.1mg', unitPriceCents: 1_000 });

    const verdict = verifyLinePrices([attack], rows, []);

    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toMatchObject({ reason: 'price_mismatch', serverCents: 5_000 });
  });

  test('REFUSES a 1mg line billed at the 0.1mg price via a second dose in the NAME', () => {
    // Moving the token into the name is the same attack without the note. Here
    // the text genuinely names two doses, so it resolves to neither.
    const rows: VariantPriceRow[] = [
      { sku: 'VSR-RS-IGF', dose: '1mg', price_cents: 5_000 },
      { sku: 'VSR-RS-IGF', dose: '0.1mg', price_cents: 1_000 },
    ];
    const attack = line({ sku: 'VSR-RS-IGF', name: 'IGF-1 LR3 — 1mg 0.1mg', unitPriceCents: 1_000 });

    const verdict = verifyLinePrices([attack], rows, []);

    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('dose_unresolved');
  });

  test('the honest 1mg and 0.1mg orders both still go through', () => {
    const rows: VariantPriceRow[] = [
      { sku: 'VSR-RS-IGF', dose: '1mg', price_cents: 5_000 },
      { sku: 'VSR-RS-IGF', dose: '0.1mg', price_cents: 1_000 },
    ];
    expect(verifyLinePrices(
      [line({ sku: 'VSR-RS-IGF', name: 'IGF-1 LR3 — 1mg', unitPriceCents: 5_000 })], rows, [],
    ).ok).toBe(true);
    expect(verifyLinePrices(
      [line({ sku: 'VSR-RS-IGF', name: 'IGF-1 LR3 — 0.1mg', unitPriceCents: 1_000 })], rows, [],
    ).ok).toBe(true);
  });
});

describe('per-sku override fallback', () => {
  test('falls back to product_stock.price_cents_override when no dose row matches', () => {
    // The live shape for lab equipment: no variant rows, price on product_stock.
    const overrideRows: SkuOverrideRow[] = [{ sku: 'VSR-LE-BAL-220', price_cents_override: 246_500 }];
    const equip = (cents: number) =>
      line({ sku: 'VSR-LE-BAL-220', name: 'Analytical Balance', unitPriceCents: cents });

    expect(verifyLinePrices([equip(246_500)], [], overrideRows).ok).toBe(true);
    expect(verifyLinePrices([equip(100)], [], overrideRows).failures[0]).toMatchObject({
      reason: 'price_mismatch',
      serverCents: 246_500,
    });
  });

  test('per-dose price beats the per-sku override', () => {
    const overrideRows: SkuOverrideRow[] = [{ sku: 'BPC-157', price_cents_override: 8_000 }];
    const rows = [variant({ price_cents: 6_500 })];
    expect(priceOf(line(), rows, new Map([['BPC-157', 8_000]]))).toBe(6_500);
    // A client sending the per-dose price passes even though the sku override differs.
    expect(verifyLinePrices([line({ unitPriceCents: 6_500 })], rows, overrideRows).ok).toBe(true);
  });

  test('a null override is not a price of 0', () => {
    const overrideRows: SkuOverrideRow[] = [{ sku: 'BPC-157', price_cents_override: null }];
    // No rows, no usable override → unknown sku → refused (not billed at $1).
    const verdict = verifyLinePrices([line({ unitPriceCents: 100 })], [], overrideRows);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].reason).toBe('unknown_sku');
  });
});

describe('priceFailureMessage', () => {
  test('names the repriced item when every failure is a stale price', () => {
    const msg = priceFailureMessage([
      { sku: 'BPC-157', name: 'BPC-157 — 5mg', clientCents: 6_000, serverCents: 6_500, reason: 'price_mismatch' },
    ]);
    expect(msg).toContain('BPC-157 — 5mg');
    expect(msg).toContain('Refresh your cart');
  });

  test('falls back to a generic message for non-reprice failures', () => {
    const msg = priceFailureMessage([
      { sku: 'X', name: 'X', clientCents: 1, serverCents: null, reason: 'unknown_sku' },
    ]);
    expect(msg).toContain("couldn't verify");
  });
});
