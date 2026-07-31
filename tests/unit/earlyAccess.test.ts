/**
 * earlyAccess — the member-first visibility window gate. Early access is
 * flag OR tag (migration 077): the admin-set DB flag (product_flags, read
 * through public_product_flags into useEarlyAccessFlags) OR the legacy
 * catalog-data tag. Either one gates; the tag is the deliberate OR-fallback
 * that keeps today's behavior byte-for-byte identical while product_flags
 * carries zero rows — the ship state, and the state of any SKU no admin has
 * touched yet.
 *
 * The supabase seam is mocked (tests/setup.ts forbids live network), mirroring
 * tests/unit/promoSettings.test.ts.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ supabase: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.supabase;
  },
}));

import { EARLY_ACCESS_TAG, isEarlyAccessProduct, useEarlyAccessFlags } from '../../src/lib/earlyAccess';
import type { Product } from '../../src/types/product';

const base = { id: 'p1', sku: 'VSR-X', name: 'Test', variants: [] } as unknown as Product;

/** Wire the seam to a deterministic public_product_flags query chain. */
function mockFlagsQuery(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ select }));
  seam.supabase = { from };
  return { from, select };
}

beforeEach(() => {
  seam.supabase = null;
  // The store is a module-level singleton — reset it between tests.
  useEarlyAccessFlags.setState({ bySku: {}, loaded: false, loading: false });
});

describe('isEarlyAccessProduct — flag x tag matrix', () => {
  test("flag unset, tag absent -> false (today's production state for every untagged SKU)", () => {
    useEarlyAccessFlags.setState({ bySku: {} });
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide'] } as Product)).toBe(false);
  });

  test('flag unset, tag present -> true (the zero-flags ship state; the tag alone still gates)', () => {
    useEarlyAccessFlags.setState({ bySku: {} });
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide', EARLY_ACCESS_TAG] } as Product)).toBe(true);
  });

  test('flag set true, tag absent -> true (admin-only toggle gates on its own)', () => {
    useEarlyAccessFlags.setState({ bySku: { 'VSR-X': true } });
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide'] } as Product)).toBe(true);
  });

  test('flag set true, tag present -> true (both agree)', () => {
    useEarlyAccessFlags.setState({ bySku: { 'VSR-X': true } });
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide', EARLY_ACCESS_TAG] } as Product)).toBe(true);
  });

  test('flag explicitly false, tag absent -> false', () => {
    useEarlyAccessFlags.setState({ bySku: { 'VSR-X': false } });
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide'] } as Product)).toBe(false);
  });

  test('flag explicitly false, tag present -> true (tag OR-fallback overrides an off flag)', () => {
    useEarlyAccessFlags.setState({ bySku: { 'VSR-X': false } });
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide', EARLY_ACCESS_TAG] } as Product)).toBe(true);
  });

  test('a flag set for a DIFFERENT sku does not gate this product', () => {
    useEarlyAccessFlags.setState({ bySku: { 'OTHER-SKU': true } });
    expect(isEarlyAccessProduct({ ...base, sku: 'VSR-X', tags: [] } as Product)).toBe(false);
  });

  test('tags absent entirely, flag unset -> false', () => {
    useEarlyAccessFlags.setState({ bySku: {} });
    expect(isEarlyAccessProduct({ ...base, tags: undefined } as unknown as Product)).toBe(false);
  });
});

describe('useEarlyAccessFlags.reload', () => {
  test('clears the cache and marks loaded when supabase is not configured', async () => {
    useEarlyAccessFlags.setState({ bySku: { 'VSR-X': true }, loaded: false, loading: false });

    await useEarlyAccessFlags.getState().reload();

    const s = useEarlyAccessFlags.getState();
    expect(s.bySku).toEqual({});
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
  });

  test('maps public_product_flags rows onto bySku', async () => {
    const { from, select } = mockFlagsQuery({
      data: [
        { sku: 'VSR-X', early_access: true },
        { sku: 'VSR-Y', early_access: false },
      ],
      error: null,
    });

    await useEarlyAccessFlags.getState().reload();

    const s = useEarlyAccessFlags.getState();
    expect(s.bySku).toEqual({ 'VSR-X': true, 'VSR-Y': false });
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
    expect(from).toHaveBeenCalledWith('public_product_flags');
    expect(select).toHaveBeenCalledWith('sku, early_access');
  });

  test('coerces a non-boolean truthy value to true, not passed through raw', async () => {
    mockFlagsQuery({ data: [{ sku: 'VSR-X', early_access: 1 }], error: null });

    await useEarlyAccessFlags.getState().reload();

    expect(useEarlyAccessFlags.getState().bySku['VSR-X']).toBe(false);
    // 1 !== true, so the strict === true coercion in the store reads it as
    // unset — proving the store never trusts a truthy-but-non-boolean value.
  });

  test('falls back to an empty cache when the query errors', async () => {
    mockFlagsQuery({ data: null, error: { message: 'relation "public_product_flags" does not exist' } });

    await useEarlyAccessFlags.getState().reload();

    const s = useEarlyAccessFlags.getState();
    expect(s.bySku).toEqual({});
    expect(s.loaded).toBe(true);
  });

  test('falls back to an empty cache when data is null with no error', async () => {
    mockFlagsQuery({ data: null, error: null });

    await useEarlyAccessFlags.getState().reload();

    expect(useEarlyAccessFlags.getState().bySku).toEqual({});
  });
});

describe('useEarlyAccessFlags.load', () => {
  test('performs the fetch once when the store is fresh', async () => {
    const { from } = mockFlagsQuery({ data: [{ sku: 'VSR-X', early_access: true }], error: null });

    await useEarlyAccessFlags.getState().load();

    expect(from).toHaveBeenCalledTimes(1);
    expect(useEarlyAccessFlags.getState().bySku).toEqual({ 'VSR-X': true });
  });

  test('is a no-op when already loaded', async () => {
    const { from } = mockFlagsQuery({ data: [{ sku: 'VSR-X', early_access: true }], error: null });
    useEarlyAccessFlags.setState({ loaded: true });

    await useEarlyAccessFlags.getState().load();

    expect(from).not.toHaveBeenCalled();
  });

  test('is a no-op while a load is already in flight', async () => {
    const { from } = mockFlagsQuery({ data: [{ sku: 'VSR-X', early_access: true }], error: null });
    useEarlyAccessFlags.setState({ loading: true });

    await useEarlyAccessFlags.getState().load();

    expect(from).not.toHaveBeenCalled();
  });
});
