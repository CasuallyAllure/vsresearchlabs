/**
 * Unit tests for src/lib/accountPreviewSource.ts — the DEV-only injection
 * seam behind the customer-portal design preview (/account/__preview).
 *
 * Two things actually matter here and both are pinned below:
 *   1. The seam works in DEV: an installed source is what `accountPreview()`
 *      and `accountPreviewSession()` return, and `null` uninstalls it.
 *   2. The seam is INERT in a production build. `import.meta.env.DEV` is
 *      statically `false` there, so installing must be a no-op and reads must
 *      return null — the guarantee that no fabricated customer record can
 *      ever reach a real visitor. `vi.stubEnv` reproduces that flag here.
 *
 * The `accountData.ts` side of the seam (each read short-circuiting to the
 * fabricated rows) is covered in tests/unit/accountData.test.ts.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  accountPreview,
  accountPreviewSession,
  installAccountPreview,
  type AccountPreviewSource,
} from '../../src/lib/accountPreviewSource';
import type { CustomerAuthApi } from '../../src/lib/customerAuth';

const SESSION = { loading: false, user: null, profile: null, error: null } as unknown as CustomerAuthApi;

function makeSource(overrides: Partial<AccountPreviewSource> = {}): AccountPreviewSource {
  return {
    session: SESSION,
    orders: [],
    orderLines: [],
    order: () => ({ found: false }),
    rewards: { balance: 0, threshold: 300, percent: 40, reward_ready: false, active_voucher: null, entries: [] },
    referral: { code: 'DEMO-0000', percent: 10, uses: 0 },
    discounts: [],
    staleError: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  installAccountPreview(null);
});

describe('in a dev/test build', () => {
  test('returns null before anything is installed', () => {
    expect(accountPreview()).toBeNull();
    expect(accountPreviewSession()).toBeNull();
  });

  test('returns the installed source', () => {
    const source = makeSource({ staleError: 'demo refresh failed' });
    installAccountPreview(source);

    expect(accountPreview()).toBe(source);
    expect(accountPreview()?.staleError).toBe('demo refresh failed');
  });

  test('exposes the installed session for AccountLayout', () => {
    installAccountPreview(makeSource());
    expect(accountPreviewSession()).toBe(SESSION);
  });

  test('installing null uninstalls the source', () => {
    installAccountPreview(makeSource());
    installAccountPreview(null);

    expect(accountPreview()).toBeNull();
    expect(accountPreviewSession()).toBeNull();
  });
});

describe('in a production build', () => {
  test('installing is a no-op — the fabricated source can never be set', () => {
    vi.stubEnv('DEV', false);
    installAccountPreview(makeSource());

    expect(accountPreview()).toBeNull();
    expect(accountPreviewSession()).toBeNull();
  });

  test('a source installed in dev is still invisible once DEV is false', () => {
    installAccountPreview(makeSource());
    vi.stubEnv('DEV', false);

    expect(accountPreview()).toBeNull();
    expect(accountPreviewSession()).toBeNull();
  });
});
