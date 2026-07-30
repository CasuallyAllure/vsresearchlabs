// @vitest-environment happy-dom
/**
 * authPresence — the zero-query signed-in signal for leaf components.
 *
 * The module subscribes ONCE at import (getSession + onAuthStateChange), so
 * each test resets modules and injects a fresh mocked seam before importing.
 * Covered: guest default, session hydration flip, auth-state change in both
 * directions (including the no-op same-value path), and listener cleanup.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

type AuthChangeCb = (event: string, session: unknown) => void;

function makeSeam(initialSession: unknown) {
  let authCb: AuthChangeCb = () => {};
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: initialSession } })),
      onAuthStateChange: vi.fn((cb: AuthChangeCb) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  };
  return { client, fireAuthChange: (session: unknown) => authCb('TOKEN_REFRESHED', session) };
}

async function importWithSeam(initialSession: unknown) {
  vi.resetModules();
  const seam = makeSeam(initialSession);
  vi.doMock('../../src/lib/supabase', () => ({ supabase: seam.client }));
  const mod = await import('../../src/lib/authPresence');
  return { ...seam, useSignedIn: mod.useSignedIn };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('useSignedIn', () => {
  test('guest: stays false after the session read resolves', async () => {
    const { useSignedIn } = await importWithSeam(null);
    const { result } = renderHook(() => useSignedIn());
    expect(result.current).toBe(false);
    await act(async () => {}); // flush the getSession microtask
    expect(result.current).toBe(false);
  });

  test('existing session: flips to true once getSession resolves, then false on sign-out', async () => {
    const { useSignedIn, fireAuthChange } = await importWithSeam({ user: { id: 'u1' } });
    const { result } = renderHook(() => useSignedIn());
    await act(async () => {});
    expect(result.current).toBe(true);

    act(() => fireAuthChange(null));
    expect(result.current).toBe(false);
  });

  test('sign-in via auth-state change notifies subscribers; same-value events are no-ops', async () => {
    const { useSignedIn, fireAuthChange } = await importWithSeam(null);
    const { result } = renderHook(() => useSignedIn());
    await act(async () => {});
    expect(result.current).toBe(false);

    act(() => fireAuthChange({ user: { id: 'u2' } }));
    expect(result.current).toBe(true);
    // Same value again — covered no-op branch, state unchanged.
    act(() => fireAuthChange({ user: { id: 'u2' } }));
    expect(result.current).toBe(true);
  });

  test('unmounted hooks stop receiving updates (listener cleanup)', async () => {
    const { useSignedIn, fireAuthChange } = await importWithSeam(null);
    const { result, unmount } = renderHook(() => useSignedIn());
    await act(async () => {});
    unmount();
    // Firing after unmount must not throw (listener removed).
    expect(() => fireAuthChange({ user: { id: 'u3' } })).not.toThrow();
    expect(result.current).toBe(false);
  });
});
