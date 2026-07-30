// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/accountSession.ts — the portal's shared
 * auth/profile context (WS-1). `AccountLayout` calls `useCustomerAuth()`
 * exactly once and hands the result to `AccountSessionProvider`; every
 * descendant reads it back via `useAccountSession()` — a context read, never
 * a second fetch. Pinned here: the provider passes its `value` through
 * unchanged, and `useAccountSession()` throws (rather than silently
 * returning something wrong) when rendered outside the provider.
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import { AccountSessionProvider, useAccountSession } from '../../src/lib/accountSession';
import type { CustomerAuthApi } from '../../src/lib/customerAuth';

function makeAuth(overrides: Partial<CustomerAuthApi> = {}): CustomerAuthApi {
  return {
    loading: false,
    user: null,
    profile: null,
    error: null,
    signUp: async () => ({ ok: false, needsConfirmation: false, error: null }),
    signIn: async () => false,
    verifyOtp: async () => ({ ok: false, error: null }),
    resendOtp: async () => ({ ok: false, error: null }),
    signOut: async () => {},
    reloadProfile: async () => {},
    ...overrides,
  };
}

describe('useAccountSession', () => {
  test('reads the exact value the provider was given', () => {
    const auth = makeAuth({ user: { id: 'user-1' } as CustomerAuthApi['user'] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AccountSessionProvider value={auth}>{children}</AccountSessionProvider>
    );

    const { result } = renderHook(() => useAccountSession(), { wrapper });

    expect(result.current).toBe(auth);
    expect(result.current.user?.id).toBe('user-1');
  });

  test('throws when rendered outside AccountSessionProvider', () => {
    expect(() => renderHook(() => useAccountSession())).toThrow(
      /useAccountSession\(\) must be used within AccountLayout/,
    );
  });
});
