/**
 * Unit tests for src/lib/pricing.ts — the client-side price-mirror module.
 *
 * `effectiveTierPriceCents` is the contract the public catalog MUST use (per
 * project convention): admin overrides (per-dose, then per-sku) win over the
 * placeholder formula in `tierPriceCents`. These tests pin that priority
 * order plus the formula's own edge cases (no mg magnitude, zero mg, case
 * insensitivity, decimal mg, per-product rate variation).
 *
 * The formula in tierPriceCents is deterministic (hash of product.id mod 6),
 * so exact expected cents below were computed by mirroring the same
 * algorithm offline — see the comment above EXPECTED for the derivation.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import type { Product } from '../../src/types/product';
import { effectiveTierPriceCents, formatPrice, tierPriceCents } from '../../src/lib/pricing';
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

// perMg = 7 + (hashKey(product.id) % 6); base = 20
// price = Math.round(base + mg * perMg) * 100
//
// hashKey('test-product-a') % 6 === 2  → perMg = 9
// hashKey('VSR-RS-BPC')     % 6 === 5  → perMg = 12  (different id → different rate)
const PRODUCT_A_ID = 'test-product-a';
const PRODUCT_B_ID = 'VSR-RS-BPC';

describe('tierPriceCents — placeholder mg-based formula', () => {
  test('returns the formula price for a whole-number mg dose', () => {
    const product = makeProduct({ id: PRODUCT_A_ID });

    const result = tierPriceCents(product, '10mg');

    expect(result).toBe(11000); // 20 + 10*9 = 110 → $110.00
  });

  test('returns the formula price for a decimal mg dose', () => {
    const product = makeProduct({ id: PRODUCT_A_ID });

    const result = tierPriceCents(product, '5.5mg');

    expect(result).toBe(7000); // round(20 + 5.5*9) = round(69.5) = 70 → $70.00
  });

  test('matches "mg" case-insensitively', () => {
    const product = makeProduct({ id: PRODUCT_A_ID });

    expect(tierPriceCents(product, '10MG')).toBe(tierPriceCents(product, '10mg'));
  });

  test('different product ids yield different per-mg rates for the same dose', () => {
    const productA = makeProduct({ id: PRODUCT_A_ID });
    const productB = makeProduct({ id: PRODUCT_B_ID });

    expect(tierPriceCents(productA, '1mg')).toBe(2900); // perMg 9 → 20+9=29
    expect(tierPriceCents(productB, '1mg')).toBe(3200); // perMg 12 → 20+12=32
    expect(tierPriceCents(productA, '1mg')).not.toBe(tierPriceCents(productB, '1mg'));
  });

  test('is deterministic across repeated calls for the same product+dose', () => {
    const product = makeProduct({ id: PRODUCT_A_ID });

    const first = tierPriceCents(product, '10mg');
    const second = tierPriceCents(product, '10mg');

    expect(first).toBe(second);
  });

  test('falls back to the product priceCents when the dose has no mg magnitude', () => {
    const product = makeProduct({ priceCents: 4999 });

    const result = tierPriceCents(product, '30 mL');

    expect(result).toBe(4999);
  });

  test('returns null when the dose has no mg magnitude and priceCents is null', () => {
    const product = makeProduct({ priceCents: null });

    const result = tierPriceCents(product, 'Box of 100');

    expect(result).toBeNull();
  });

  test('falls back to priceCents when the mg magnitude is zero', () => {
    const product = makeProduct({ priceCents: 1000 });

    const result = tierPriceCents(product, '0mg');

    expect(result).toBe(1000);
  });

  test('falls back to priceCents when the mg capture is not a finite number', () => {
    // ".mg" matches /([\d.]+)\s*mg/i (the class allows a lone dot) but
    // parseFloat('.') is NaN — this exercises the Number.isFinite(mg) guard,
    // not just the mg <= 0 guard.
    const product = makeProduct({ priceCents: 2500 });

    const result = tierPriceCents(product, '.mg');

    expect(result).toBe(2500);
  });

  test('a leading minus sign on the dose is ignored by the mg regex (documented quirk, not a negative dose)', () => {
    // The regex /([\d.]+)\s*mg/i has no sign-handling group, so "-5mg" still
    // matches "5mg" and prices as a positive 5mg dose rather than falling
    // back or rejecting the input.
    const product = makeProduct({ id: PRODUCT_A_ID, priceCents: null });

    const result = tierPriceCents(product, '-5mg');

    expect(result).toBe(6500); // round(20 + 5*9) = 65 → $65.00, same as "5mg"
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

  test('returns the formula price when no override exists for the sku or dose', () => {
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-TEST-A' });

    const result = effectiveTierPriceCents(product, '10mg');

    expect(result).toBe(11000);
    expect(result).toBe(tierPriceCents(product, '10mg'));
  });

  test('a per-dose admin override wins over the formula price', () => {
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
    expect(result).not.toBe(tierPriceCents(product, '10mg'));
  });

  test('a per-sku admin override wins over the formula price when no per-dose row exists', () => {
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

  test('works when Supabase is not configured (node test env has no VITE_SUPABASE_* env vars)', () => {
    // src/lib/supabase.ts exports `supabase: null` when env vars are absent;
    // productOverrides.reload() short-circuits to an empty, loaded store in
    // that case. effectiveTierPriceCents must still resolve via the formula.
    const product = makeProduct({ id: PRODUCT_A_ID, sku: 'VSR-UNCONFIGURED' });

    const result = effectiveTierPriceCents(product, '10mg');

    expect(result).toBe(11000);
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
