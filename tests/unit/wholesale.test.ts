/**
 * Unit tests for src/lib/wholesale.ts — the client display mirror of the
 * standing wholesale offer (full case ×10 @ 40% off, half kit ×5 @ 27% off).
 *
 * wholesaleDoses()/isWholesaleEligible() read the productOverrides zustand
 * store directly, so these tests drive real store state via
 * useProductOverrides.setState(...) rather than mocking the module — the
 * store falls back to "no override" when supabase is null (no
 * VITE_SUPABASE_URL in the test env), so this is safe and network-free.
 *
 * Money math (wholesalePackPricing/formatPerVial) is pinned against the
 * module's own doc comment example: a $60 vial → $36 case, $43.80 half-kit
 * vial. WHOLESALE_PACKS itself is pinned since place-order keeps a
 * duplicate copy (WHOLESALE_CASE/WHOLESALE_HALF) that must stay in sync.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import {
  WHOLESALE_PACKS,
  wholesaleDoses,
  isWholesaleEligible,
  formatPerVial,
  wholesalePackPricing,
} from '../../src/lib/wholesale';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import type { Product } from '../../src/types/product';

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'test-product',
    slug: 'test-product',
    name: 'Test Compound',
    category: 'biopeptide-research-supplies',
    shortDescription: 'test',
    longDescription: 'test',
    images: [],
    specs: [],
    sku: 'TEST-SKU',
    abbreviation: 'TST',
    family: 'Test Family',
    variants: [],
    priceCents: null,
    stock: null,
    tags: [],
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function variantRow(sku: string, dose: string, over: Partial<VariantOverride> = {}): VariantOverride {
  return {
    sku,
    dose,
    on_hand: 0,
    inbound_units: 0,
    price_cents: null,
    lead_days: null,
    hidden: false,
    ...over,
  };
}

beforeEach(() => {
  useProductOverrides.setState({ bySku: {}, variantBySku: {} });
});

describe('WHOLESALE_PACKS — pinned against the server copy', () => {
  test('full case is 10 vials at 40% off, half kit is 5 vials at 27% off', () => {
    expect(WHOLESALE_PACKS).toEqual([
      { key: 'case', size: 10, percent: 40, label: 'Full case', noun: 'case' },
      { key: 'half', size: 5, percent: 27, label: 'Half kit', noun: 'kit' },
    ]);
  });
});

describe('wholesaleDoses / isWholesaleEligible', () => {
  test('includes both a 24hr and a sourced dose — ship speed does not gate eligibility', () => {
    const product = makeProduct({
      sku: 'TEST-SKU-A',
      variants: [{ dose: '10mg' }, { dose: '20mg' }],
    });
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-A': {
          '10mg': variantRow('TEST-SKU-A', '10mg', { price_cents: 6_000, on_hand: 5 }),
          '20mg': variantRow('TEST-SKU-A', '20mg', { price_cents: 12_000, lead_days: 10 }),
        },
      },
    });

    expect(wholesaleDoses(product)).toEqual(['10mg', '20mg']);
    expect(isWholesaleEligible(product)).toBe(true);
  });

  test('excludes a dose explicitly hidden per-dose even though it has a real price', () => {
    const product = makeProduct({ sku: 'TEST-SKU-B', variants: [{ dose: '10mg' }] });
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-B': {
          '10mg': variantRow('TEST-SKU-B', '10mg', { price_cents: 6_000, on_hand: 5, hidden: true }),
        },
      },
    });

    expect(wholesaleDoses(product)).toEqual([]);
    expect(isWholesaleEligible(product)).toBe(false);
  });

  test('excludes a dose tracked on the SKU but with no per-dose row (dead-end chip)', () => {
    const product = makeProduct({
      sku: 'TEST-SKU-C',
      variants: [{ dose: '10mg' }, { dose: '99mg' }],
    });
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-C': {
          '10mg': variantRow('TEST-SKU-C', '10mg', { price_cents: 6_000, on_hand: 5 }),
        },
      },
    });

    expect(wholesaleDoses(product)).toEqual(['10mg']);
  });

  test('excludes a publicly-visible dose that still has no usable price (a case cannot sell at $0)', () => {
    // "Sample" has no mg magnitude, so the formula fallback in lib/pricing
    // can't price it either — with no admin override and no product-level
    // priceCents, effectiveTierPriceCents is null.
    const product = makeProduct({
      sku: 'TEST-SKU-D',
      priceCents: null,
      variants: [{ dose: 'Sample' }],
    });
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-D': {
          // on_hand > 0 makes it publicly visible (real, sellable, unpriced)
          // per isVariantPublic — this is the case the price filter guards.
          Sample: variantRow('TEST-SKU-D', 'Sample', { on_hand: 2, price_cents: null }),
        },
      },
    });

    expect(wholesaleDoses(product)).toEqual([]);
    expect(isWholesaleEligible(product)).toBe(false);
  });

  test('a product with no tracked overrides at all has zero wholesale-eligible doses', () => {
    // No variantBySku entry for the SKU → doseAvailability is 'unknown' for
    // every dose, regardless of isVariantPublic defaulting to true.
    const product = makeProduct({
      sku: 'TEST-SKU-UNTRACKED',
      variants: [{ dose: '10mg' }, { dose: '20mg' }],
    });

    expect(wholesaleDoses(product)).toEqual([]);
    expect(isWholesaleEligible(product)).toBe(false);
  });

  test('a product with no variants at all is never eligible', () => {
    const product = makeProduct({ sku: 'TEST-SKU-EMPTY', variants: [] });
    expect(wholesaleDoses(product)).toEqual([]);
    expect(isWholesaleEligible(product)).toBe(false);
  });

  test('tolerates a missing variants array defensively (nullish product data)', () => {
    // The Product type declares `variants` as required, but this guards the
    // `?? []` defensive fallback in wholesaleDoses against malformed data.
    const product = { ...makeProduct({ sku: 'TEST-SKU-NULL' }), variants: undefined } as unknown as Product;
    expect(wholesaleDoses(product)).toEqual([]);
  });
});

describe('wholesalePackPricing — case math ($60 vial → $36, per the tooltip)', () => {
  const product = makeProduct({ sku: 'TEST-SKU-PRICE' });

  beforeEach(() => {
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-PRICE': {
          '10mg': variantRow('TEST-SKU-PRICE', '10mg', { price_cents: 6_000, on_hand: 5 }),
        },
      },
    });
  });

  test('full case: $60/vial × 10 × 40% off = $360 pack, $36/vial', () => {
    const pack = WHOLESALE_PACKS.find((p) => p.key === 'case')!;
    const pricing = wholesalePackPricing(product, '10mg', pack);

    expect(pricing).toEqual({
      unitCents: 6_000,
      regularCents: 60_000,
      discountCents: 24_000,
      packCents: 36_000,
      perVialCents: 3_600,
    });
  });

  test('half kit: $60/vial × 5 × 27% off = $219 pack, $43.80/vial', () => {
    const pack = WHOLESALE_PACKS.find((p) => p.key === 'half')!;
    const pricing = wholesalePackPricing(product, '10mg', pack);

    expect(pricing).toEqual({
      unitCents: 6_000,
      regularCents: 30_000,
      discountCents: 8_100,
      packCents: 21_900,
      perVialCents: 4_380,
    });
  });

  test('rounds discountCents and perVialCents from a price that does not divide evenly', () => {
    // $19.90/vial half kit: regular = 9950, discount = round(9950*0.27) = round(2686.5) = 2687
    // pack = 9950 - 2687 = 7263, perVial = round(7263/5) = round(1452.6) = 1453
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-PRICE': {
          '10mg': variantRow('TEST-SKU-PRICE', '10mg', { price_cents: 1_990, on_hand: 5 }),
        },
      },
    });
    const pack = WHOLESALE_PACKS.find((p) => p.key === 'half')!;
    const pricing = wholesalePackPricing(product, '10mg', pack);

    expect(pricing).toEqual({
      unitCents: 1_990,
      regularCents: 9_950,
      discountCents: 2_687,
      packCents: 7_263,
      perVialCents: 1_453,
    });
  });

  test('returns null when the dose has no admin-set price (never show a $0 pack)', () => {
    const priceless = makeProduct({ sku: 'TEST-SKU-NOPRICE', priceCents: null });
    const pack = WHOLESALE_PACKS.find((p) => p.key === 'case')!;

    // "Sample" carries no mg magnitude, so tierPriceCents' formula fallback
    // also can't price it — effectiveTierPriceCents is null.
    expect(wholesalePackPricing(priceless, 'Sample', pack)).toBeNull();
  });

  test('returns null when the resolved price is zero', () => {
    useProductOverrides.setState({
      variantBySku: {
        'TEST-SKU-PRICE': {
          '10mg': variantRow('TEST-SKU-PRICE', '10mg', { price_cents: 0, on_hand: 5 }),
        },
      },
    });
    const pack = WHOLESALE_PACKS.find((p) => p.key === 'case')!;
    expect(wholesalePackPricing(product, '10mg', pack)).toBeNull();
  });
});

describe('formatPerVial — whole dollars stay clean, fractional cents keep both digits', () => {
  test('an integer dollar amount has no decimal places', () => {
    expect(formatPerVial(3_600)).toBe('$36');
  });

  test('a fractional dollar amount keeps exactly two decimal places', () => {
    expect(formatPerVial(4_380)).toBe('$43.80');
  });

  test('formats large integer amounts with a thousands separator', () => {
    expect(formatPerVial(150_000)).toBe('$1,500');
  });

  test('formats large fractional amounts with a thousands separator and two decimals', () => {
    expect(formatPerVial(123_456)).toBe('$1,234.56');
  });

  test('formats zero as a whole dollar amount', () => {
    expect(formatPerVial(0)).toBe('$0');
  });
});
