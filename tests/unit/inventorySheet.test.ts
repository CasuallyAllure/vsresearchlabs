/**
 * Unit tests for src/lib/inventorySheet.ts — the shared "one row per
 * SKU×dose" sheet spec both AdminImport (blank price_usd template) and
 * AdminInventory (pre-filled export) build from.
 *
 * Pins the row-building rules: sku sort + skuless filtering, the
 * stored-cents vs formula price precedence per dose, product-level fields
 * (hidden/videos/reorder) surfacing on the FIRST dose row only, and the
 * fillPrice fork. The final block pins the full export→import round trip
 * through toCsv → parseCsvRecords, because the column headers ARE the
 * import keys.
 */
import { describe, expect, test } from 'vitest';
import {
  INVENTORY_COLUMNS,
  buildInventoryRows,
  type StockLike,
  type VariantLike,
} from '../../src/lib/inventorySheet';
import { toCsv } from '../../src/lib/exporters';
import { parseCsvRecords } from '../../src/lib/csv';
import { tierPriceCents } from '../../src/lib/pricing';
import { makeProduct } from '../fixtures/product';
import type { Product } from '../../src/types';

const makeStock = (over: Partial<StockLike> = {}): StockLike => ({
  on_hand: 0,
  reorder_at: null,
  hidden: false,
  price_cents_override: null,
  video_url: null,
  video_title: null,
  video_description: null,
  video_thumbnail: null,
  ...over,
});

const makeVariant = (over: Partial<VariantLike> = {}): VariantLike => ({
  on_hand: 0,
  reorder_at: null,
  price_cents: null,
  cost_cents: null,
  lead_days: null,
  ...over,
});

/** Shorthand: build rows with empty override maps unless provided. */
const build = (
  products: Product[],
  over: Partial<Parameters<typeof buildInventoryRows>[0]> = {},
) => buildInventoryRows({ products, stockBySku: {}, variantBySku: {}, fillPrice: true, ...over });

describe('buildInventoryRows — product ordering and filtering', () => {
  test('sorts products by sku and drops products without a sku', () => {
    // Arrange
    const products = [
      makeProduct({ sku: 'ZZZ-1', variants: [{ dose: '5mg' }] }),
      makeProduct({ sku: '', variants: [{ dose: '5mg' }] }),
      makeProduct({ sku: 'AAA-1', variants: [{ dose: '5mg' }] }),
    ];

    // Act
    const rows = build(products);

    // Assert — skuless product gone, remainder sku-sorted.
    expect(rows.map((r) => r.sku)).toEqual(['AAA-1', 'ZZZ-1']);
  });

  test('does not mutate the caller-owned products array while sorting', () => {
    // Arrange
    const products = [
      makeProduct({ sku: 'B', variants: [{ dose: '5mg' }] }),
      makeProduct({ sku: 'A', variants: [{ dose: '5mg' }] }),
    ];

    // Act
    build(products);

    // Assert — input order untouched (sort ran on a copy).
    expect(products.map((p) => p.sku)).toEqual(['B', 'A']);
  });

  test('emits one row per variant dose, in variant order', () => {
    // Arrange
    const products = [
      makeProduct({ sku: 'A', variants: [{ dose: '5mg' }, { dose: '10mg' }, { dose: '20mg' }] }),
    ];

    // Act
    const rows = build(products);

    // Assert
    expect(rows.map((r) => r.dose)).toEqual(['5mg', '10mg', '20mg']);
  });

  test('a product with no variants gets a single blank-dose row', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [] })]);

    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0].dose).toBe('');
  });
});

describe('buildInventoryRows — klass precedence', () => {
  test('family wins when present', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', family: 'GLP Family', variants: [{ dose: '5mg' }] })]);

    // Assert
    expect(rows[0].klass).toBe('GLP Family');
  });

  test('falls back to researchClassification, then category', () => {
    // Arrange — family stripped; one product carries a classification, one neither.
    const withClassification = {
      ...makeProduct({ sku: 'A', variants: [{ dose: '5mg' }] }),
      family: undefined,
      researchClassification: 'regenerative',
    } as unknown as Product;
    const withNeither = {
      ...makeProduct({ sku: 'B', variants: [{ dose: '5mg' }] }),
      family: undefined,
    } as unknown as Product;

    // Act
    const rows = build([withClassification, withNeither]);

    // Assert
    expect(rows[0].klass).toBe('regenerative');
    expect(rows[1].klass).toBe('biopeptide-research-supplies');
  });
});

describe('buildInventoryRows — current_price precedence (stored cents vs formula)', () => {
  test('a per-dose variant price_cents override wins over the formula', () => {
    // Arrange
    const product = makeProduct({ sku: 'A', variants: [{ dose: '10mg' }] });

    // Act
    const rows = build([product], {
      variantBySku: { A: { '10mg': makeVariant({ price_cents: 12_345 }) } },
    });

    // Assert — dollars, not cents.
    expect(rows[0].current_price).toBe(123.45);
  });

  test('without a stored price, a dosed row prices from tierPriceCents', () => {
    // Arrange
    const product = makeProduct({ sku: 'A', variants: [{ dose: '10mg' }] });
    const formulaCents = tierPriceCents(product, '10mg');

    // Act
    const rows = build([product]);

    // Assert — the formula delegation, in dollars.
    expect(formulaCents).not.toBeNull();
    expect(rows[0].current_price).toBe((formulaCents as number) / 100);
  });

  test('a dosed row IGNORES the product-level price_cents_override', () => {
    // Arrange — the sku-level override only applies to doseless products;
    // pin it so nobody "helpfully" lets it leak onto dose rows.
    const product = makeProduct({ sku: 'A', variants: [{ dose: '10mg' }] });
    const formulaCents = tierPriceCents(product, '10mg');

    // Act
    const rows = build([product], {
      stockBySku: { A: makeStock({ price_cents_override: 99_900 }) },
    });

    // Assert — formula, not 999.
    expect(rows[0].current_price).toBe((formulaCents as number) / 100);
  });

  test('a doseless row uses the sku-level price_cents_override when set', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [] })], {
      stockBySku: { A: makeStock({ price_cents_override: 5_500 }) },
    });

    // Assert
    expect(rows[0].current_price).toBe(55);
  });

  test('a doseless row without an override falls back to the product priceCents', () => {
    // Arrange / Act — makeProduct priceCents = 1000.
    const rows = build([makeProduct({ sku: 'A', variants: [] })]);

    // Assert
    expect(rows[0].current_price).toBe(10);
  });

  test('a doseless row with no override and no priceCents prices null', () => {
    // Arrange / Act
    const rows = build([
      { ...makeProduct({ sku: 'A', variants: [] }), priceCents: undefined } as unknown as Product,
    ]);

    // Assert
    expect(rows[0].current_price).toBeNull();
  });
});

describe('buildInventoryRows — fillPrice fork', () => {
  test('fillPrice=true mirrors current_price into price_usd (export sheet)', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [{ dose: '10mg' }] })], {
      variantBySku: { A: { '10mg': makeVariant({ price_cents: 8_000 }) } },
      fillPrice: true,
    });

    // Assert
    expect(rows[0].price_usd).toBe(80);
    expect(rows[0].price_usd).toBe(rows[0].current_price);
  });

  test('fillPrice=false leaves price_usd blank (import template)', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [{ dose: '10mg' }] })], {
      variantBySku: { A: { '10mg': makeVariant({ price_cents: 8_000 }) } },
      fillPrice: false,
    });

    // Assert — current_price still shown for reference; price_usd empty.
    expect(rows[0].current_price).toBe(80);
    expect(rows[0].price_usd).toBeNull();
  });
});

describe('buildInventoryRows — per-dose variant fields', () => {
  test('cost_usd, on_hand, lead_days, reorder_at come from the variant row', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [{ dose: '5mg' }] })], {
      variantBySku: {
        A: { '5mg': makeVariant({ cost_cents: 2_550, on_hand: 7, lead_days: 14, reorder_at: 3 }) },
      },
    });

    // Assert
    expect(rows[0]).toMatchObject({ cost_usd: 25.5, on_hand: 7, lead_days: 14, reorder_at: 3 });
  });

  test('a dose with no variant row leaves the per-dose fields null', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [{ dose: '5mg' }] })]);

    // Assert
    expect(rows[0]).toMatchObject({ cost_usd: null, on_hand: null, lead_days: null, reorder_at: null });
  });

  test('a doseless row takes on_hand from the sku-level stock row', () => {
    // Arrange / Act
    const rows = build([makeProduct({ sku: 'A', variants: [] })], {
      stockBySku: { A: makeStock({ on_hand: 42 }) },
    });

    // Assert
    expect(rows[0].on_hand).toBe(42);
  });
});

describe('buildInventoryRows — product-level fields on the first dose row only', () => {
  const twoDose = () => makeProduct({ sku: 'A', variants: [{ dose: '5mg' }, { dose: '10mg' }] });

  test('hidden="true" appears only on the first row when the sku is hidden', () => {
    // Arrange / Act
    const rows = build([twoDose()], { stockBySku: { A: makeStock({ hidden: true }) } });

    // Assert
    expect(rows.map((r) => r.hidden)).toEqual(['true', '']);
  });

  test('hidden stays blank everywhere when the sku is visible', () => {
    // Arrange / Act
    const rows = build([twoDose()], { stockBySku: { A: makeStock({ hidden: false }) } });

    // Assert
    expect(rows.map((r) => r.hidden)).toEqual(['', '']);
  });

  test('video fields repeat on the first row only, blank after', () => {
    // Arrange / Act
    const rows = build([twoDose()], {
      stockBySku: {
        A: makeStock({
          video_url: 'https://v.example/clip',
          video_title: 'Clip',
          video_description: 'About the clip',
          video_thumbnail: 'https://v.example/thumb.jpg',
        }),
      },
    });

    // Assert
    expect(rows[0]).toMatchObject({
      video_url: 'https://v.example/clip',
      video_title: 'Clip',
      video_description: 'About the clip',
      video_thumbnail: 'https://v.example/thumb.jpg',
    });
    expect(rows[1]).toMatchObject({
      video_url: '', video_title: '', video_description: '', video_thumbnail: '',
    });
  });

  test('sku-level reorder_at lands on the first row; a variant reorder_at beats it', () => {
    // Arrange / Act — sku-level 5, but the second dose carries its own 9.
    const rows = build([twoDose()], {
      stockBySku: { A: makeStock({ reorder_at: 5 }) },
      variantBySku: { A: { '10mg': makeVariant({ reorder_at: 9 }) } },
    });

    // Assert — first row inherits the sku-level value, second uses its own.
    expect(rows.map((r) => r.reorder_at)).toEqual([5, 9]);
  });
});

describe('INVENTORY_COLUMNS — export→import round trip', () => {
  test('headers are the exact import keys, already normalized', () => {
    // Arrange / Act
    const headers = INVENTORY_COLUMNS.map((c) => c.header);

    // Assert — lower-case snake keys → parseCsvRecords normalization is a no-op.
    expect(headers).toEqual([
      'sku', 'name', 'class', 'dose', 'current_price', 'cost_usd', 'on_hand',
      'price_usd', 'lead_days', 'hidden', 'reorder_at', 'video_url',
      'video_title', 'video_description', 'video_thumbnail',
    ]);
    expect(headers).toEqual(headers.map((h) => h.trim().toLowerCase()));
  });

  test('an exported sheet re-parses to the same values (CSV round trip)', () => {
    // Arrange — a two-dose sku exercising prices, costs, stock, hidden, video.
    const products = [makeProduct({
      sku: 'RT-10', name: 'Retatrutide', family: 'Incretin',
      variants: [{ dose: '5mg' }, { dose: '10mg' }],
    })];
    const rows = buildInventoryRows({
      products,
      stockBySku: { 'RT-10': makeStock({ hidden: true, reorder_at: 2, video_url: 'https://v/x' }) },
      variantBySku: {
        'RT-10': {
          '5mg': makeVariant({ price_cents: 6_050, cost_cents: 1_525, on_hand: 12, lead_days: 7 }),
          '10mg': makeVariant({ price_cents: 11_000, on_hand: 0 }),
        },
      },
      fillPrice: true,
    });

    // Act — export exactly as AdminInventory does, re-import as AdminImport does.
    const { headers, records } = parseCsvRecords(toCsv(INVENTORY_COLUMNS, rows));

    // Assert — every cell survives; numbers as decimal strings, nulls as ''.
    expect(headers).toEqual(INVENTORY_COLUMNS.map((c) => c.header));
    expect(records).toEqual([
      {
        sku: 'RT-10', name: 'Retatrutide', class: 'Incretin', dose: '5mg',
        current_price: '60.5', cost_usd: '15.25', on_hand: '12', price_usd: '60.5',
        lead_days: '7', hidden: 'true', reorder_at: '2', video_url: 'https://v/x',
        video_title: '', video_description: '', video_thumbnail: '',
      },
      {
        sku: 'RT-10', name: 'Retatrutide', class: 'Incretin', dose: '10mg',
        current_price: '110', cost_usd: '', on_hand: '0', price_usd: '110',
        lead_days: '', hidden: '', reorder_at: '', video_url: '',
        video_title: '', video_description: '', video_thumbnail: '',
      },
    ]);
  });
});
