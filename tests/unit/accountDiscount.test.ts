/**
 * Unit tests for src/lib/accountDiscount.ts — fetchMyAccountDiscount().
 *
 * The client-side mirror of effective_customer_discount() (migration 069),
 * used for CART PREVIEW ONLY — place-order re-resolves the entitlement
 * server-side, so the property that matters here is fidelity to the SQL
 * function: active rows only, inside [starts_at, expires_at], 'business'
 * scope gated on the profile's account_type, sane percent, best-of by
 * (percent desc, created_at desc) — PLUS migration 069's automatic 15% floor
 * for every confirmed account holder (an assigned rule below 15% is replaced
 * by the floor, not averaged with it). Only a guest, a missing profile row,
 * missing env, or a thrown error resolve to null; a discounts-query error
 * degrades to the floor (still a confirmed account holder) rather than null.
 * The supabase seam is mocked (tests/setup.ts forbids live network).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchMyAccountDiscount } from '../../src/lib/accountDiscount';

// Mutable seam: tests swap `client` between a mock client and null
// ("backend not configured") without re-importing the module under test.
const seam = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.client;
  },
}));

interface DiscountRowInput {
  scope: string;
  percent: number | string;
  label: string;
  starts_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
}

function row(input: DiscountRowInput) {
  return {
    starts_at: null,
    expires_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...input,
  };
}

/**
 * Build a mock client: a signed-in session (unless userId is null), a
 * customer_profiles row with the given account_type (or none), and the
 * active customer_discounts rows the query would return.
 */
function makeClient({
  userId = 'user-1',
  accountType = 'personal',
  hasProfile = true,
  rows = [] as ReturnType<typeof row>[],
  rowsError = null as { message: string } | null,
}: {
  userId?: string | null;
  accountType?: string;
  hasProfile?: boolean;
  rows?: ReturnType<typeof row>[];
  rowsError?: { message: string } | null;
} = {}) {
  const profilesChain = {
    select: vi.fn(() => profilesChain),
    eq: vi.fn(() => profilesChain),
    maybeSingle: vi.fn(async () => ({
      data: hasProfile ? { account_type: accountType } : null,
      error: null,
    })),
  };
  // The discounts query is awaited directly off the second .eq(), so that
  // link in the chain resolves to the result.
  const discountsChain = {
    select: vi.fn(() => discountsChain),
    eq: vi
      .fn()
      .mockImplementationOnce(() => discountsChain)
      .mockImplementationOnce(async () => ({ data: rowsError ? null : rows, error: rowsError })),
  };
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: userId ? { user: { id: userId } } : null },
      })),
    },
    from: vi.fn((table: string) => (table === 'customer_profiles' ? profilesChain : discountsChain)),
  };
}

beforeEach(() => {
  seam.client = null;
});

describe('fetchMyAccountDiscount', () => {
  test('resolves null when the backend is not configured', async () => {
    seam.client = null;

    await expect(fetchMyAccountDiscount()).resolves.toBeNull();
  });

  test('resolves null for a guest (no session)', async () => {
    seam.client = makeClient({ userId: null });

    await expect(fetchMyAccountDiscount()).resolves.toBeNull();
  });

  test('falls back to the automatic 15% floor when the discounts query errors', async () => {
    // A confirmed account holder (profile lookup succeeded) whose rows we
    // couldn't read still gets the guaranteed floor — never null.
    seam.client = makeClient({ rowsError: { message: 'permission denied' } });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('falls back to the automatic 15% floor when the customer has no active rows', async () => {
    seam.client = makeClient({ rows: [] });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('an assigned rate below the 15% floor is replaced by the floor, not averaged with it', async () => {
    seam.client = makeClient({
      accountType: 'personal',
      rows: [row({ scope: 'lifetime', percent: 10, label: 'Founding member' })],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('an assigned rate at exactly the floor is honored verbatim (own label)', async () => {
    seam.client = makeClient({
      accountType: 'business',
      rows: [row({ scope: 'business', percent: 15, label: 'B2B partner' })],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'business',
      percent: 15,
      label: 'B2B partner',
    });
  });

  test('an assigned rate above the floor is honored verbatim', async () => {
    seam.client = makeClient({
      accountType: 'business',
      rows: [row({ scope: 'business', percent: 25, label: 'B2B partner' })],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'business',
      percent: 25,
      label: 'B2B partner',
    });
  });

  test('a business discount ineligible for a personal profile still floors to the automatic 15%', async () => {
    // The explicit business-scoped rule doesn't apply, but the buyer is still
    // a confirmed account holder — never null, per migration 069.
    seam.client = makeClient({
      accountType: 'personal',
      rows: [row({ scope: 'business', percent: 15, label: 'B2B partner' })],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('treats a missing profile row as non-business', async () => {
    seam.client = makeClient({
      hasProfile: false,
      rows: [row({ scope: 'business', percent: 15, label: 'B2B partner' })],
    });

    await expect(fetchMyAccountDiscount()).resolves.toBeNull();
  });

  test('out-of-range or non-numeric percents are ignored, floor still applies', async () => {
    seam.client = makeClient({
      rows: [
        row({ scope: 'lifetime', percent: 0, label: 'zero' }),
        row({ scope: 'lifetime', percent: 101, label: 'too big' }),
        row({ scope: 'lifetime', percent: 'not-a-number', label: 'garbage' }),
      ],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('a rule whose window has not started is ignored, floor still applies', async () => {
    seam.client = makeClient({
      rows: [
        row({
          scope: 'lifetime',
          percent: 20,
          label: 'future',
          starts_at: '2099-01-01T00:00:00Z',
        }),
      ],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('an expired rule is ignored, floor still applies', async () => {
    seam.client = makeClient({
      rows: [
        row({
          scope: 'lifetime',
          percent: 20,
          label: 'expired',
          expires_at: '2020-01-01T00:00:00Z',
        }),
      ],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
    });
  });

  test('accepts a rule inside its [starts_at, expires_at] window', async () => {
    seam.client = makeClient({
      rows: [
        row({
          scope: 'lifetime',
          percent: 20,
          label: 'windowed',
          starts_at: '2020-01-01T00:00:00Z',
          expires_at: '2099-01-01T00:00:00Z',
        }),
      ],
    });

    await expect(fetchMyAccountDiscount()).resolves.toMatchObject({ label: 'windowed' });
  });

  test('picks the highest percent when several rules qualify (no stacking)', async () => {
    seam.client = makeClient({
      accountType: 'business',
      rows: [
        row({ scope: 'lifetime', percent: 10, label: 'lifetime 10' }),
        row({ scope: 'business', percent: 25, label: 'business 25' }),
      ],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'business',
      percent: 25,
      label: 'business 25',
    });
  });

  test('breaks a percent tie to the newest rule', async () => {
    seam.client = makeClient({
      rows: [
        row({
          scope: 'lifetime',
          percent: 20,
          label: 'older',
          created_at: '2025-01-01T00:00:00Z',
        }),
        row({
          scope: 'lifetime',
          percent: 20,
          label: 'newer',
          created_at: '2026-06-01T00:00:00Z',
        }),
      ],
    });

    await expect(fetchMyAccountDiscount()).resolves.toMatchObject({ label: 'newer' });
  });

  test('coerces a string percent from the API into a number', async () => {
    seam.client = makeClient({
      rows: [row({ scope: 'lifetime', percent: '20.5', label: 'string pct' })],
    });

    await expect(fetchMyAccountDiscount()).resolves.toEqual({
      scope: 'lifetime',
      percent: 20.5,
      label: 'string pct',
    });
  });

  test('downgrades an unexpected throw to null — never blocks the cart', async () => {
    seam.client = {
      auth: {
        getSession: vi.fn(async () => {
          throw new Error('auth exploded');
        }),
      },
    };

    await expect(fetchMyAccountDiscount()).resolves.toBeNull();
  });
});
