/**
 * Unit tests for src/lib/pricing.ts — the client-side price-mirror module.
 *
 * `effectiveTierPriceCents` is the contract the public catalog MUST use (per
 * project convention): admin overrides (per-dose, then per-sku) win, then the
 * product's own catalog price, then NOTHING. These tests pin that priority
 * order and — the point of the module — that an unresolved price stays null.
 *
 * pricing.ts previously derived a placeholder from the dose's mg magnitude
 * (`perMg = 7 + hash(product.id) % 6`) whenever no override had loaded, which
 * turned a transient Supabase failure into a confident wrong price on the
 * storefront. The no-fabrication tests below exist so that cannot come back.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import type { Product } from '../../src/types/product';
import { catalogPriceCents, effectiveTierPriceCents, formatPrice } from '../../src/lib/pricing';
import { useProductOverrides } from '../../src/lib/productOverrides';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-product-a',
    slug: 'test-product-a',
    name: 'Test Product A',
    category: 'biopeptide-research-supplies',
    shortDescription: 'test',
    longDescription: 'test',
    images: [],
    specs: [],
    sku: 'VSR-TEST-A',
    abbreviation: 'TST',
    family: 'Test Family',
    variants: [{ dose: '10mg' }],
    priceCents: null,
    stock: null,
    tags: [],
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const PRODUCT_A_ID = 'test-product-a';

describe('catalogPriceCents — the product’s own price, or nothing', () => {
  test('returns the price a single-config product carries', () => {
    const product = makeProduct({ priceCents: 4999 });

    expect(catalogPriceCents(product)).toBe(4999);
  });

  test('returns null when the product carries no price of its own', () => {
    const product = makeProduct({ priceCents: null });

    expect(catalogPriceCents(product)).toBeNull();
  });
});

describe('pricing never fabricates a figure from the dose', () => {
  // Each dose below would have produced a plausible-looking price under the
  // old mg formula. With no override loaded and no product price, every one
  // of them must come back null instead.
  test.each(['10mg', '5.5mg', '10MG', '0mg', '.mg', '-5mg', '70mg', '1200mg'])(
    'dose %s resolves to null, not a derived price',
    (dose) => {
      useProductOverrides.setState({
        bySku: {},
        variantBySku: {},
        loaded: true,
        loading: false,
        error: null,
      });
      const product = makeProduct({ id: PRODUCT_A_ID, priceCents: null });

      expect(effectiveTierPriceCents(product, dose)).toBeNull();
    },
  );

  test('an mg dose does not outrank the product’s own catalog price', () => {
    useProductOverrides.setState({
      bySku: {},
      variantBySku: {},
      loaded: true,
      loading: false,
      error: null,
    });
    const product = makeProduct({ id: PRODUCT_A_ID, priceCents: 6500 });

    // The old formula ignored priceCents whenever the dose parsed as mg.
    expect(effectiveTierPriceCents(product, '10mg')).toBe(6500);
  });
});

describe('effectiveTierPriceCents — admin-override contract', () => {
  beforeEach(() => {
    useProductOverrides.setState({
      bySku: {},
      variantBySku: {},
      loaded: true,
      loading: false,
      error: null,
    });
  });

  test('resolves to null when no override exists and the product carries no price', () => {
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-TEST-A', priceCents: null });

    expect(effectiveTierPriceCents(product, '10mg')).toBeNull();
  });

  test('a per-dose admin override wins', () => {
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-TEST-A' });
    useProductOverrides.setState({
      variantBySku: {
        'VSR-TEST-A': {
          '10mg': {
            sku: 'VSR-TEST-A',
            dose: '10mg',
            on_hand: 5,
            inbound_units: 0,
            price_cents: 8888,
            lead_days: null,
            hidden: false,
          },
        },
      },
    });

    const result = effectiveTierPriceCents(product, '10mg');

    expect(result).toBe(8888);
  });

  test('a per-sku admin override wins when no per-dose row exists', () => {
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-TEST-A' });
    useProductOverrides.setState({
      bySku: {
        'VSR-TEST-A': {
          sku: 'VSR-TEST-A',
          on_hand: 5,
          hidden: false,
          price_cents_override: 7777,
          deleted_at: null,
          video_url: null,
          video_title: null,
          video_description: null,
          video_thumbnail: null,
        },
      },
    });

    const result = effectiveTierPriceCents(product, '10mg');

    expect(result).toBe(7777);
  });

  test('a per-dose override with price_cents null falls through to the per-sku override', () => {
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-TEST-A' });
    useProductOverrides.setState({
      bySku: {
        'VSR-TEST-A': {
          sku: 'VSR-TEST-A',
          on_hand: 5,
          hidden: false,
          price_cents_override: 6666,
          deleted_at: null,
          video_url: null,
          video_title: null,
          video_description: null,
          video_thumbnail: null,
        },
      },
      variantBySku: {
        'VSR-TEST-A': {
          '10mg': {
            sku: 'VSR-TEST-A',
            dose: '10mg',
            on_hand: 5,
            inbound_units: 0,
            price_cents: null,
            lead_days: null,
            hidden: false,
          },
        },
      },
    });

    const result = effectiveTierPriceCents(product, '10mg');

    expect(result).toBe(6666);
  });

  test('an unconfigured Supabase yields no price rather than an invented one', () => {
    // src/lib/supabase.ts exports `supabase: null` when env vars are absent;
    // productOverrides.reload() short-circuits to an empty, loaded store in
    // that case. An empty store is indistinguishable from a failed load, which
    // is exactly why it must not price anything: this is the path that once
    // rendered admin-priced compounds at fabricated figures in production.
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-UNCONFIGURED', priceCents: null });

    expect(effectiveTierPriceCents(product, '10mg')).toBeNull();
  });

  test('a product carrying its own catalog price still resolves without any override', () => {
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-UNCONFIGURED', priceCents: 10_000 });

    expect(effectiveTierPriceCents(product, '500mcg')).toBe(10_000);
  });
});

describe('formatPrice', () => {
  test('formats null as an em dash', () => {
    expect(formatPrice(null)).toBe('—');
  });

  test('formats a whole-dollar amount without decimals', () => {
    expect(formatPrice(10500)).toBe('$105');
  });

  test('rounds to the nearest dollar (round-half-up)', () => {
    expect(formatPrice(10550)).toBe('$106');
    expect(formatPrice(10549)).toBe('$105');
  });

  test('adds thousands separators for large amounts', () => {
    expect(formatPrice(100000)).toBe('$1,000');
  });

  test('formats zero cents as $0', () => {
    expect(formatPrice(0)).toBe('$0');
  });
});
