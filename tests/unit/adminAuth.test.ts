// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/adminAuth.ts — useAdminAuth().
 *
 * The admin gate: `isAdmin` must be true ONLY when is_admin() (SECURITY
 * DEFINER, admin_users.active=true) says so. These tests pin the session
 * bootstrap, the auth-event stream, the deny-and-sign-out path for
 * authenticated non-admins, and listener cleanup on unmount. The supabase
 * seam is mocked — the real client in .env is live-capable (tests/setup.ts).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAdminAuth } from '../../src/lib/adminAuth';

// Mutable seam: tests swap `client` between a mock client and null
// ("backend not configured") without re-importing the module under test.
const seam = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.client;
  },
}));

const USER = { id: 'user-1', email: 'owner@lab.example' } as User;
const SESSION = { user: USER } as Session;

type AuthChangeCallback = (event: string, session: Session | null) => Promise<void>;

interface MockClientOptions {
  session?: Session | null;
  isAdminResult?: { data: unknown; error: { message: string } | null };
  signInResult?: { data: { user: User | null }; error: { message: string } | null };
}

/** Mock supabase client capturing the auth-change subscriber + unsubscribe. */
function makeClient(options: MockClientOptions = {}) {
  const unsubscribe = vi.fn();
  const captured: { onAuthChange: AuthChangeCallback | null } = { onAuthChange: null };
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: options.session ?? null } })),
      onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
        captured.onAuthChange = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
      signInWithPassword: vi.fn(async () =>
        options.signInResult ?? { data: { user: null }, error: { message: 'Invalid login credentials' } },
      ),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async () => options.isAdminResult ?? { data: false, error: null }),
  };
  return { client, captured, unsubscribe };
}

beforeEach(() => {
  seam.client = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAdminAuth — bootstrap', () => {
  test('resolves to signed-out when the backend is not configured', async () => {
    seam.client = null;

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('resolves to signed-out without calling is_admin when there is no session', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test('grants isAdmin when the session user passes is_admin()', async () => {
    const { client } = makeClient({ session: SESSION, isAdminResult: { data: true, error: null } });
    seam.client = client;

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(USER);
    expect(result.current.isAdmin).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('is_admin');
  });

  test('denies isAdmin when is_admin() returns false', async () => {
    const { client } = makeClient({ session: SESSION, isAdminResult: { data: false, error: null } });
    seam.client = client;

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(USER);
    expect(result.current.isAdmin).toBe(false);
  });

  test('fails CLOSED (isAdmin=false) when the is_admin rpc errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeClient({
      session: SESSION,
      isAdminResult: { data: null, error: { message: 'rpc exploded' } },
    });
    seam.client = client;

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
    expect(warn).toHaveBeenCalledWith('is_admin() rpc failed:', 'rpc exploded');
  });

  test('denies isAdmin on a truthy-but-not-true rpc payload', async () => {
    const { client } = makeClient({ session: SESSION, isAdminResult: { data: 'yes', error: null } });
    seam.client = client;

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });
});

describe('useAdminAuth — auth event stream', () => {
  test('propagates a SIGNED_IN event into user + isAdmin', async () => {
    const { client, captured } = makeClient({
      session: null,
      isAdminResult: { data: true, error: null },
    });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await captured.onAuthChange?.('SIGNED_IN', SESSION);
    });

    expect(result.current.user).toEqual(USER);
    expect(result.current.isAdmin).toBe(true);
  });

  test('clears user + isAdmin on a SIGNED_OUT event', async () => {
    const { client, captured } = makeClient({
      session: SESSION,
      isAdminResult: { data: true, error: null },
    });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.isAdmin).toBe(true));

    await act(async () => {
      await captured.onAuthChange?.('SIGNED_OUT', null);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  test('unsubscribes the auth listener on unmount (no leaked listeners)', async () => {
    const { client, unsubscribe } = makeClient({ session: null });
    seam.client = client;
    const { result, unmount } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('useAdminAuth — signIn', () => {
  test('fails with a clear error when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn('a@b.c', 'pw');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Backend not configured.');
  });

  test('surfaces the auth error message on bad credentials', async () => {
    const { client } = makeClient({
      session: null,
      signInResult: { data: { user: null }, error: { message: 'Invalid login credentials' } },
    });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn('a@b.c', 'wrong');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Invalid login credentials');
    expect(result.current.user).toBeNull();
  });

  test('falls back to a generic message when auth returns neither user nor error', async () => {
    const { client } = makeClient({
      session: null,
      signInResult: { data: { user: null }, error: null },
    });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('a@b.c', 'pw');
    });

    expect(result.current.error).toBe('Sign-in failed.');
  });

  test('grants access when the signed-in user is an admin', async () => {
    const { client } = makeClient({
      session: null,
      signInResult: { data: { user: USER }, error: null },
      isAdminResult: { data: true, error: null },
    });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.signIn('owner@lab.example', 'pw');
    });

    expect(ok).toBe(true);
    expect(result.current.user).toEqual(USER);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.error).toBeNull();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  test('DENIES and signs out an authenticated non-admin (the gate)', async () => {
    const { client } = makeClient({
      session: null,
      signInResult: { data: { user: USER }, error: null },
      isAdminResult: { data: false, error: null },
    });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn('customer@lab.example', 'pw');
    });

    expect(ok).toBe(false);
    expect(client.auth.signOut).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBe('This account is not authorized for admin access.');
  });
});

describe('useAdminAuth — signOut / refresh', () => {
  test('signOut clears user, isAdmin, and error', async () => {
    const { client } = makeClient({ session: SESSION, isAdminResult: { data: true, error: null } });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.isAdmin).toBe(true));

    await act(async () => {
      await result.current.signOut();
    });

    expect(client.auth.signOut).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  test('signOut is a quiet no-op when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
  });

  test('refresh re-resolves the session and admin role', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Session appears out-of-band; refresh should pick it up.
    client.auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    client.rpc.mockResolvedValue({ data: true, error: null });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.user).toEqual(USER);
    expect(result.current.isAdmin).toBe(true);
  });

  test('refresh is a quiet no-op when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useAdminAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });
});
