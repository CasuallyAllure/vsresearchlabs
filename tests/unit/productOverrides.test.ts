/**
 * Pins the visibility/stock/pricing rules of src/lib/productOverrides.ts.
 *
 * The store is a Zustand singleton; each test sets `bySku`/`variantBySku`
 * directly via `useProductOverrides.setState(...)` in Arrange, then calls the
 * pure helper functions (which read `useProductOverrides.getState()`
 * internally) in Act. State is reset to the module's initial shape between
 * tests so no test can leak fixtures into another.
 *
 * `src/lib/supabase.ts` is mocked behind a swappable ref for this file.
 * The repo's checked-in `.env` actually carries real (anon, RLS-gated)
 * Supabase credentials, so without this mock `reload()` would make a live
 * network call to production on every test run — slow, non-deterministic,
 * and exactly the "no backend configured" no-op path this suite means to
 * pin instead. The ref defaults to `null` (backend not configured); the
 * reload() suites swap in a scripted fake client per-test to exercise the
 * fetch / column-shedding / retry paths fully offline.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const supabaseRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return supabaseRef.current;
  },
}));

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
  supabaseRef.current = null;
});

afterEach(() => {
  vi.useRealTimers();
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

// ── reload() fetch paths (scripted Supabase client) ──────────────────────────
//
// The store issues its selects in a fixed order per attempt:
//   1. product overrides, FULL columns (with video fields)
//   2. product overrides, BASE columns        (only if 1 errored)
//   3. variant overrides, migration-047 shape (with `hidden`)
//   4. variant overrides, migration-018 shape (only if 3 errored)
//   5. variant overrides, pre-018 shape       (only if 4 errored)
// so a flat response script consumed in call order is fully deterministic.

interface ScriptedResponse {
  data?: unknown;
  error?: { message: string } | null;
}

/** Fake supabase client that answers `.from(t).select(c)` from a response
 *  script in call order. `cycle: true` repeats the script per retry attempt
 *  (each failed attempt re-issues the identical call sequence). */
function scriptedSupabase(script: ScriptedResponse[], opts: { cycle?: boolean } = {}) {
  let call = 0;
  const calls: { table: string; columns: string }[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ table, columns });
          const idx = opts.cycle ? call % script.length : call;
          call += 1;
          const step = script[idx] ?? { data: null, error: { message: 'script exhausted' } };
          return Promise.resolve({ data: step.data ?? null, error: step.error ?? null });
        },
      };
    },
  };
  return { client, calls };
}

/** Runs reload() under fake timers so the 500ms/1200ms retry backoff does not
 *  slow the suite down. Advances in chunks (flushing microtasks in between)
 *  until the whole retry ladder has had time to run, then awaits the result. */
async function reloadThroughRetries(): Promise<void> {
  vi.useFakeTimers();
  const done = useProductOverrides.getState().reload();
  for (let i = 0; i < 4; i += 1) {
    await vi.advanceTimersByTimeAsync(1200);
  }
  await done;
}

const PRODUCT_ROW_FULL = {
  sku: 'VSR-A',
  on_hand: 2,
  hidden: false,
  price_cents_override: 1234,
  deleted_at: null,
  video_url: 'https://example.com/v.mp4',
  video_title: 'Clip',
  video_description: null,
  video_thumbnail: null,
};

const VARIANT_ROW_FULL = {
  sku: 'VSR-A',
  dose: '5mg',
  on_hand: 1,
  inbound_units: 2,
  price_cents: 1000,
  lead_days: 3,
  hidden: false,
};

describe('reload() against a scripted Supabase client', () => {
  test('commits both override maps on a clean first attempt', async () => {
    const { client, calls } = scriptedSupabase([
      { data: [PRODUCT_ROW_FULL] },
      {
        data: [
          VARIANT_ROW_FULL,
          { sku: 'VSR-B', dose: '10mg' }, // sparse row — every field defaulted
          { dose: '5mg' }, // no sku — skipped
          { sku: 'VSR-C' }, // no dose — skipped
        ],
      },
    ]);
    supabaseRef.current = client;

    await useProductOverrides.getState().reload();

    const state = useProductOverrides.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.bySku['VSR-A']).toEqual(PRODUCT_ROW_FULL);
    expect(state.variantBySku['VSR-A']['5mg']).toEqual(VARIANT_ROW_FULL);
    expect(state.variantBySku['VSR-B']['10mg']).toEqual(
      makeVariantOverride('VSR-B', '10mg'), // on_hand 0, inbound 0, nulls, hidden false
    );
    expect(state.variantBySku['VSR-C']).toBeUndefined();
    expect(calls).toEqual([
      { table: 'public_product_overrides', columns: expect.stringContaining('video_url') },
      { table: 'public_variant_overrides', columns: expect.stringContaining('hidden') },
    ]);
  });

  test('falls back to the base product columns when the video columns are not live', async () => {
    const baseRow = { sku: 'VSR-A', on_hand: 1, hidden: false, price_cents_override: null, deleted_at: null };
    const { client, calls } = scriptedSupabase([
      { error: { message: 'column video_url does not exist' } },
      { data: [baseRow] },
      { data: [] },
    ]);
    supabaseRef.current = client;

    await useProductOverrides.getState().reload();

    const state = useProductOverrides.getState();
    expect(state.error).toBeNull();
    // The base row is committed with the missing video fields defaulted null.
    expect(state.bySku['VSR-A']).toEqual(makeProductOverride('VSR-A', { on_hand: 1 }));
    expect(calls[1].columns).not.toContain('video_url');
  });

  test('sheds the variant `hidden` column when migration 047 is not live yet', async () => {
    const pre047Row = { sku: 'VSR-A', dose: '5mg', on_hand: 0, inbound_units: 4, price_cents: 900, lead_days: null };
    const { client } = scriptedSupabase([
      { data: [PRODUCT_ROW_FULL] },
      { error: { message: 'column hidden does not exist' } },
      { data: [pre047Row] },
    ]);
    supabaseRef.current = client;

    await useProductOverrides.getState().reload();

    const state = useProductOverrides.getState();
    expect(state.error).toBeNull();
    expect(state.variantBySku['VSR-A']['5mg']).toEqual(
      makeVariantOverride('VSR-A', '5mg', { inbound_units: 4, price_cents: 900 }), // hidden defaults false
    );
  });

  test('sheds down to the pre-018 variant shape; inbound_units defaults to 0', async () => {
    const pre018Row = { sku: 'VSR-A', dose: '5mg', on_hand: 6, price_cents: null, lead_days: 10 };
    const { client } = scriptedSupabase([
      { data: [PRODUCT_ROW_FULL] },
      { error: { message: 'column hidden does not exist' } },
      { error: { message: 'column inbound_units does not exist' } },
      { data: [pre018Row] },
    ]);
    supabaseRef.current = client;

    await useProductOverrides.getState().reload();

    const state = useProductOverrides.getState();
    expect(state.error).toBeNull();
    expect(state.variantBySku['VSR-A']['5mg']).toEqual(
      makeVariantOverride('VSR-A', '5mg', { on_hand: 6, lead_days: 10 }),
    );
  });

  test('total product-fetch failure retries 3x then flips loaded with the error kept', async () => {
    const { client, calls } = scriptedSupabase(
      [
        { error: { message: 'full boom' } },
        { error: { message: 'base boom' } },
      ],
      { cycle: true },
    );
    supabaseRef.current = client;

    await reloadThroughRetries();

    const state = useProductOverrides.getState();
    expect(state.loaded).toBe(true); // catalog must not skeleton forever
    expect(state.loading).toBe(false);
    expect(state.error).toBe('base boom'); // data-dependent UI hides on this
    expect(state.bySku).toEqual({});
    expect(state.variantBySku).toEqual({});
    expect(calls).toHaveLength(6); // 2 product selects × 3 attempts, no variant calls
  });

  test('a failed variant fetch fails the whole attempt instead of committing half-empty', async () => {
    const { client, calls } = scriptedSupabase(
      [
        { data: [PRODUCT_ROW_FULL] },
        { error: { message: 'v hidden boom' } },
        { error: { message: 'v full boom' } },
        { error: { message: 'v base boom' } },
      ],
      { cycle: true },
    );
    supabaseRef.current = client;

    await reloadThroughRetries();

    const state = useProductOverrides.getState();
    expect(state.error).toBe('v base boom');
    expect(state.loaded).toBe(true);
    // The successful product half must NOT have been committed on its own.
    expect(state.bySku).toEqual({});
    expect(calls).toHaveLength(12); // 4 selects × 3 attempts
  });

  test('recovers when a retry attempt succeeds after a failed first attempt', async () => {
    const { client } = scriptedSupabase([
      // Attempt 1 — both product selects fail.
      { error: { message: 'full boom' } },
      { error: { message: 'base boom' } },
      // Attempt 2 — clean.
      { data: [PRODUCT_ROW_FULL] },
      { data: [VARIANT_ROW_FULL] },
    ]);
    supabaseRef.current = client;

    await reloadThroughRetries();

    const state = useProductOverrides.getState();
    expect(state.error).toBeNull();
    expect(state.loaded).toBe(true);
    expect(state.bySku['VSR-A']).toEqual(PRODUCT_ROW_FULL);
    expect(state.variantBySku['VSR-A']['5mg']).toEqual(VARIANT_ROW_FULL);
  });
});

describe('load() guards', () => {
  test('no-ops when overrides are already loaded', async () => {
    const { client, calls } = scriptedSupabase([{ data: [PRODUCT_ROW_FULL] }]);
    supabaseRef.current = client;
    useProductOverrides.setState({ loaded: true });

    await useProductOverrides.getState().load();

    expect(calls).toHaveLength(0);
  });

  test('no-ops when a load is already in flight', async () => {
    const { client, calls } = scriptedSupabase([{ data: [PRODUCT_ROW_FULL] }]);
    supabaseRef.current = client;
    useProductOverrides.setState({ loading: true });

    await useProductOverrides.getState().load();

    expect(calls).toHaveLength(0);
  });

  test('delegates to reload() and commits on first load', async () => {
    const { client, calls } = scriptedSupabase([
      { data: [PRODUCT_ROW_FULL] },
      { data: [VARIANT_ROW_FULL] },
    ]);
    supabaseRef.current = client;

    await useProductOverrides.getState().load();

    expect(calls).toHaveLength(2);
    expect(useProductOverrides.getState().bySku['VSR-A']).toEqual(PRODUCT_ROW_FULL);
  });
});

describe('getOverride', () => {
  test('returns the per-sku row when present', () => {
    const row = makeProductOverride('VSR-A', { on_hand: 3 });
    useProductOverrides.setState({ bySku: { 'VSR-A': row } });

    expect(useProductOverrides.getState().getOverride('VSR-A')).toEqual(row);
  });

  test('returns null for an untracked sku', () => {
    useProductOverrides.setState({ bySku: {} });

    expect(useProductOverrides.getState().getOverride('VSR-UNTRACKED')).toBeNull();
  });
});
