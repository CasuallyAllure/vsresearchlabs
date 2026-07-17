/**
 * Pins the visibility/stock/pricing rules of src/lib/productOverrides.ts.
 *
 * The store is a Zustand singleton; each test sets `bySku`/`variantBySku`
 * directly via `useProductOverrides.setState(...)` in Arrange, then calls the
 * pure helper functions (which read `useProductOverrides.getState()`
 * internally) in Act. State is reset to the module's initial shape between
 * tests so no test can leak fixtures into another.
 *
 * `src/lib/supabase.ts` is mocked to export `supabase: null` for this file.
 * The repo's checked-in `.env` actually carries real (anon, RLS-gated)
 * Supabase credentials, so without this mock `reload()` would make a live
 * network call to production on every test run — slow, non-deterministic,
 * and exactly the "no backend configured" no-op path this suite means to
 * pin instead.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({ supabase: null }));

import {
  doseAvailability,
  is24hrDose,
  isDoseInStock,
  isProductPublic,
  isSkuInStock,
  isSkuVisible,
  isVariantPublic,
  priceOverrideCents,
  useProductOverrides,
  variantPriceCents,
  videoOverrideFor,
  type ProductOverride,
  type VariantOverride,
} from '../../src/lib/productOverrides';

const INITIAL_STATE = {
  bySku: {},
  variantBySku: {},
  loaded: false,
  loading: false,
  error: null,
};

/** Builds a full ProductOverride row with sane defaults, override any field. */
function makeProductOverride(sku: string, overrides: Partial<ProductOverride> = {}): ProductOverride {
  return {
    sku,
    on_hand: 0,
    hidden: false,
    price_cents_override: null,
    deleted_at: null,
    video_url: null,
    video_title: null,
    video_description: null,
    video_thumbnail: null,
    ...overrides,
  };
}

/** Builds a full VariantOverride row with sane defaults, override any field. */
function makeVariantOverride(sku: string, dose: string, overrides: Partial<VariantOverride> = {}): VariantOverride {
  return {
    sku,
    dose,
    on_hand: 0,
    inbound_units: 0,
    price_cents: null,
    lead_days: null,
    hidden: false,
    ...overrides,
  };
}

beforeEach(() => {
  // Merge (not replace) — a full replace would also wipe the store's
  // load/reload/getOverride actions, which live only on the initial state.
  useProductOverrides.setState(INITIAL_STATE);
});

describe('load() with no Supabase backend configured', () => {
  test('no-ops and flips loaded to true without touching bySku/variantBySku', async () => {
    await useProductOverrides.getState().load();

    const state = useProductOverrides.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.bySku).toEqual({});
    expect(state.variantBySku).toEqual({});
  });
});

describe('isVariantPublic', () => {
  test('SKU with no variant map at all is visible (fresh seed / overrides not loaded)', () => {
    useProductOverrides.setState({ bySku: {}, variantBySku: {} });

    expect(isVariantPublic('VSR-UNTRACKED', '5mg')).toBe(true);
  });

  test('SKU with tracked variants but the asked dose has no row is HIDDEN (dead-end-chip fix)', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { price_cents: 1000 }) } },
    });

    expect(isVariantPublic('VSR-A', '10mg')).toBe(false);
  });

  test('explicit hidden:true row is hidden even with a price set', () => {
    useProductOverrides.setState({
      variantBySku: {
        'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { price_cents: 1000, hidden: true }) },
      },
    });

    expect(isVariantPublic('VSR-A', '5mg')).toBe(false);
  });

  test('row with price_cents set is visible', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { price_cents: 1000 }) } },
    });

    expect(isVariantPublic('VSR-A', '5mg')).toBe(true);
  });

  test('row with no price but on_hand>0 is visible', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { on_hand: 3 }) } },
    });

    expect(isVariantPublic('VSR-A', '5mg')).toBe(true);
  });

  test('row with no price but inbound_units>0 is visible', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { inbound_units: 2 }) } },
    });

    expect(isVariantPublic('VSR-A', '5mg')).toBe(true);
  });

  test('row with no price but lead_days set is visible', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { lead_days: 10 }) } },
    });

    expect(isVariantPublic('VSR-A', '5mg')).toBe(true);
  });

  test('row with no price and no supply signal at all is hidden (master-sheet "xx" convention)', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg') } },
    });

    expect(isVariantPublic('VSR-A', '5mg')).toBe(false);
  });
});

describe('isProductPublic', () => {
  test('SKU with no variant map at all is visible', () => {
    useProductOverrides.setState({ variantBySku: {} });

    expect(isProductPublic('VSR-UNTRACKED', ['5mg', '10mg'])).toBe(true);
  });

  test('visible when at least one provided dose is publicly listable', () => {
    useProductOverrides.setState({
      variantBySku: {
        'VSR-A': {
          '5mg': makeVariantOverride('VSR-A', '5mg'), // hidden — no price/supply
          '10mg': makeVariantOverride('VSR-A', '10mg', { price_cents: 2000 }), // visible
        },
      },
    });

    expect(isProductPublic('VSR-A', ['5mg', '10mg'])).toBe(true);
  });

  test('hidden when none of the provided doses are publicly listable', () => {
    useProductOverrides.setState({
      variantBySku: {
        'VSR-A': {
          '5mg': makeVariantOverride('VSR-A', '5mg'),
          '10mg': makeVariantOverride('VSR-A', '10mg', { hidden: true, price_cents: 2000 }),
        },
      },
    });

    expect(isProductPublic('VSR-A', ['5mg', '10mg'])).toBe(false);
  });
});

describe('isSkuVisible', () => {
  test('defaults to visible when there is no override row', () => {
    useProductOverrides.setState({ bySku: {} });

    expect(isSkuVisible('VSR-UNTRACKED')).toBe(true);
  });

  test('hidden when the row has hidden:true', () => {
    useProductOverrides.setState({ bySku: { 'VSR-A': makeProductOverride('VSR-A', { hidden: true }) } });

    expect(isSkuVisible('VSR-A')).toBe(false);
  });

  test('hidden when the row has a deleted_at timestamp', () => {
    useProductOverrides.setState({
      bySku: { 'VSR-A': makeProductOverride('VSR-A', { deleted_at: '2026-07-01T00:00:00Z' }) },
    });

    expect(isSkuVisible('VSR-A')).toBe(false);
  });

  test('visible when the row exists but hidden is false and deleted_at is null', () => {
    useProductOverrides.setState({ bySku: { 'VSR-A': makeProductOverride('VSR-A') } });

    expect(isSkuVisible('VSR-A')).toBe(true);
  });
});

describe('isSkuInStock', () => {
  test('false when the sku row has a deleted_at timestamp, regardless of variants', () => {
    useProductOverrides.setState({
      bySku: { 'VSR-A': makeProductOverride('VSR-A', { deleted_at: '2026-07-01T00:00:00Z', on_hand: 5 }) },
      variantBySku: {
        'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { price_cents: 1000, on_hand: 5 }) },
      },
    });

    expect(isSkuInStock('VSR-A')).toBe(false);
  });

  test('true when at least one publicly-priced dose has genuine 24hr supply', () => {
    useProductOverrides.setState({
      variantBySku: {
        'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { price_cents: 1000, on_hand: 5 }) },
      },
    });

    expect(isSkuInStock('VSR-A')).toBe(true);
  });

  test('false when the only supply-carrying dose has no admin price (not publicly priced)', () => {
    useProductOverrides.setState({
      variantBySku: {
        'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { on_hand: 5 }) }, // no price_cents
      },
    });

    expect(isSkuInStock('VSR-A')).toBe(false);
  });

  test('falls back to the per-sku on_hand when there are no per-dose rows', () => {
    useProductOverrides.setState({
      bySku: { 'VSR-A': makeProductOverride('VSR-A', { on_hand: 4 }) },
      variantBySku: {},
    });

    expect(isSkuInStock('VSR-A')).toBe(true);
  });

  test('false when there is neither a variant map nor a per-sku override', () => {
    useProductOverrides.setState({ bySku: {}, variantBySku: {} });

    expect(isSkuInStock('VSR-UNTRACKED')).toBe(false);
  });
});

describe('is24hrDose / isDoseInStock', () => {
  test('true when on_hand > 0', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { on_hand: 1 }) } },
    });

    expect(is24hrDose('VSR-A', '5mg')).toBe(true);
  });

  test('true when inbound_units > 0', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { inbound_units: 1 }) } },
    });

    expect(is24hrDose('VSR-A', '5mg')).toBe(true);
  });

  test('false when only lead_days is set (drop-ship SLA is not a 24hr signal)', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { lead_days: 5 }) } },
    });

    expect(is24hrDose('VSR-A', '5mg')).toBe(false);
  });

  test('false when there is no per-dose row (no fabricated in-stock)', () => {
    useProductOverrides.setState({ variantBySku: {} });

    expect(is24hrDose('VSR-A', '5mg')).toBe(false);
  });

  test('isDoseInStock is a back-compat alias for is24hrDose', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { on_hand: 1 }) } },
    });

    expect(isDoseInStock('VSR-A', '5mg')).toBe(is24hrDose('VSR-A', '5mg'));
    expect(isDoseInStock('VSR-A', '5mg')).toBe(true);
  });
});

describe('doseAvailability', () => {
  test('unknown when there is no per-dose row', () => {
    useProductOverrides.setState({ variantBySku: {} });

    expect(doseAvailability('VSR-A', '5mg')).toEqual({ state: 'unknown' });
  });

  test('in_stock with fast:true when the dose has genuine 24hr supply', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { on_hand: 2 }) } },
    });

    expect(doseAvailability('VSR-A', '5mg')).toEqual({ state: 'in_stock', fast: true });
  });

  test('sourced when the dose is tracked but has no 24hr supply', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { lead_days: 7 }) } },
    });

    expect(doseAvailability('VSR-A', '5mg')).toEqual({ state: 'sourced' });
  });
});

describe('priceOverrideCents', () => {
  test('returns the per-sku price_cents_override when set', () => {
    useProductOverrides.setState({
      bySku: { 'VSR-A': makeProductOverride('VSR-A', { price_cents_override: 5000 }) },
    });

    expect(priceOverrideCents('VSR-A')).toBe(5000);
  });

  test('returns null when there is no override row', () => {
    useProductOverrides.setState({ bySku: {} });

    expect(priceOverrideCents('VSR-UNTRACKED')).toBeNull();
  });

  test('returns null when the row exists but price_cents_override is null', () => {
    useProductOverrides.setState({ bySku: { 'VSR-A': makeProductOverride('VSR-A') } });

    expect(priceOverrideCents('VSR-A')).toBeNull();
  });
});

describe('variantPriceCents', () => {
  test('returns the per-dose price_cents when set', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg', { price_cents: 3000 }) } },
      bySku: { 'VSR-A': makeProductOverride('VSR-A', { price_cents_override: 9999 }) },
    });

    expect(variantPriceCents('VSR-A', '5mg')).toBe(3000);
  });

  test('falls back to the per-sku override when the per-dose price is null', () => {
    useProductOverrides.setState({
      variantBySku: { 'VSR-A': { '5mg': makeVariantOverride('VSR-A', '5mg') } },
      bySku: { 'VSR-A': makeProductOverride('VSR-A', { price_cents_override: 4200 }) },
    });

    expect(variantPriceCents('VSR-A', '5mg')).toBe(4200);
  });

  test('falls back to null when neither a per-dose nor per-sku price exists', () => {
    useProductOverrides.setState({ variantBySku: {}, bySku: {} });

    expect(variantPriceCents('VSR-A', '5mg')).toBeNull();
  });
});

describe('videoOverrideFor', () => {
  test('returns null when there is no video_url override', () => {
    useProductOverrides.setState({ bySku: { 'VSR-A': makeProductOverride('VSR-A') } });

    expect(videoOverrideFor('VSR-A')).toBeNull();
  });

  test('returns the video fields when video_url is set', () => {
    useProductOverrides.setState({
      bySku: {
        'VSR-A': makeProductOverride('VSR-A', {
          video_url: 'https://example.com/clip.mp4',
          video_title: 'Title',
          video_description: 'Description',
          video_thumbnail: 'https://example.com/thumb.jpg',
        }),
      },
    });

    expect(videoOverrideFor('VSR-A')).toEqual({
      url: 'https://example.com/clip.mp4',
      title: 'Title',
      description: 'Description',
      thumbnail: 'https://example.com/thumb.jpg',
    });
  });
});
