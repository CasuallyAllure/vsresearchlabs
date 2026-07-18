/**
 * Unit tests for src/lib/customerProfile.ts — loadMyProfile() / updateMyProfile().
 *
 * The supabase seam is mocked (per tests/setup.ts the real client is
 * live-capable, so hitting it from a unit test is forbidden). RLS scopes both
 * queries to the signed-in user's own row, which is why loadMyProfile carries
 * no user_id filter — these tests pin the client-side contract only: null when
 * unconfigured or missing, the row when present, and a thrown Error (never a
 * swallowed one) on backend failure.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CustomerProfile } from '../../src/lib/customerProfile';
import { loadMyProfile, updateMyProfile } from '../../src/lib/customerProfile';

// Mutable seam: tests swap `client` between a mock client and null
// ("backend not configured") without re-importing the module under test.
const seam = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.client;
  },
}));

const PROFILE: CustomerProfile = {
  user_id: 'user-1',
  full_name: 'Test Buyer',
  phone: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  tier: 'member',
  status: 'active',
  free_shipping: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Build a mock client whose from-chains resolve to the given results. */
function makeClient(selectResult: QueryResult, updateResult?: QueryResult) {
  const maybeSingle = vi.fn(async () => selectResult);
  const single = vi.fn(async () => updateResult ?? selectResult);
  const chain = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle,
    single,
  };
  return { from: vi.fn(() => chain), chain };
}

beforeEach(() => {
  seam.client = null;
});

describe('loadMyProfile', () => {
  test('returns null when the backend is not configured', async () => {
    seam.client = null;

    await expect(loadMyProfile()).resolves.toBeNull();
  });

  test('returns the profile row when one exists', async () => {
    const { from, chain } = makeClient({ data: PROFILE, error: null });
    seam.client = { from };

    const profile = await loadMyProfile();

    expect(profile).toEqual(PROFILE);
    expect(from).toHaveBeenCalledWith('customer_profiles');
    expect(chain.select).toHaveBeenCalledWith('*');
    expect(chain.maybeSingle).toHaveBeenCalledOnce();
  });

  test('returns null when no profile row exists yet (admin-only or trigger lag)', async () => {
    const { from } = makeClient({ data: null, error: null });
    seam.client = { from };

    await expect(loadMyProfile()).resolves.toBeNull();
  });

  test('throws (does not swallow) an unexpected backend error', async () => {
    const { from } = makeClient({ data: null, error: { message: 'permission denied' } });
    seam.client = { from };

    await expect(loadMyProfile()).rejects.toThrow('permission denied');
  });
});

describe('updateMyProfile', () => {
  test('throws when the backend is not configured', async () => {
    seam.client = null;

    await expect(updateMyProfile('user-1', { city: 'Reno' })).rejects.toThrow(
      'Backend not configured.',
    );
  });

  test('sends the patch scoped to the user id and returns the new row', async () => {
    const updated = { ...PROFILE, city: 'Reno' };
    const { from, chain } = makeClient({ data: null, error: null }, { data: updated, error: null });
    seam.client = { from };

    const result = await updateMyProfile('user-1', { city: 'Reno' });

    expect(result).toEqual(updated);
    expect(from).toHaveBeenCalledWith('customer_profiles');
    expect(chain.update).toHaveBeenCalledWith({ city: 'Reno' });
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.single).toHaveBeenCalledOnce();
  });

  test('throws with the backend message when the update fails', async () => {
    const { from } = makeClient(
      { data: null, error: null },
      { data: null, error: { message: 'row violates policy' } },
    );
    seam.client = { from };

    await expect(updateMyProfile('user-1', { phone: '555' })).rejects.toThrow(
      'row violates policy',
    );
  });

  test('throws a fallback message when no row comes back and no error is given', async () => {
    const { from } = makeClient({ data: null, error: null }, { data: null, error: null });
    seam.client = { from };

    await expect(updateMyProfile('user-1', {})).rejects.toThrow('Failed to update profile.');
  });
});
