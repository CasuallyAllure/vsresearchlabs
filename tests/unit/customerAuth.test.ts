// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/customerAuth.ts — useCustomerAuth().
 *
 * The customer mirror of useAdminAuth. Pins: session bootstrap + auth-event
 * propagation, the once-per-session guest-order claim (link_my_orders),
 * profile hydration (failures degrade, never crash), the signup
 * anti-enumeration paths (already-registered → code step; no session →
 * confirmation pending), OTP confirm/resend, sign-out clearing state, and
 * listener cleanup on unmount. Both seams are mocked: supabase (the .env
 * client is live-capable — tests/setup.ts) and customerProfile.loadMyProfile.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useCustomerAuth, type SignUpInput } from '../../src/lib/customerAuth';
import { loadMyProfile, type CustomerProfile } from '../../src/lib/customerProfile';

// Mutable seam: tests swap `client` between a mock client and null
// ("backend not configured") without re-importing the module under test.
const seam = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.client;
  },
}));

vi.mock('../../src/lib/customerProfile', () => ({
  loadMyProfile: vi.fn(async () => null),
}));

const loadMyProfileMock = vi.mocked(loadMyProfile);

const USER = { id: 'user-1', email: 'buyer@lab.example' } as User;
const SESSION = { user: USER } as Session;
const PROFILE = {
  user_id: 'user-1',
  full_name: 'Test Buyer',
  tier: 'member',
  status: 'active',
} as CustomerProfile;

const SIGNUP_INPUT: SignUpInput = {
  fullName: '  Test Buyer ',
  email: ' buyer@lab.example ',
  password: 'hunter22',
  phone: ' 555-0100 ',
  addressLine1: '1 Lab Way',
  addressLine2: '',
  city: 'Reno',
  state: 'NV',
  postalCode: '89501',
  country: 'US',
};

type AuthChangeCallback = (event: string, session: Session | null) => Promise<void>;

interface AuthResult {
  data: { user: User | null; session: Session | null };
  error: { message: string } | null;
}

/** Mock supabase client capturing the auth-change subscriber + unsubscribe. */
function makeClient(options: { session?: Session | null } = {}) {
  const unsubscribe = vi.fn();
  const captured: { onAuthChange: AuthChangeCallback | null } = { onAuthChange: null };
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: options.session ?? null } })),
      onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
        captured.onAuthChange = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
      signUp: vi.fn(async (_args?: unknown): Promise<AuthResult> => ({
        data: { user: null, session: null },
        error: null,
      })),
      signInWithPassword: vi.fn(async (): Promise<AuthResult> => ({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      })),
      verifyOtp: vi.fn(async (): Promise<AuthResult> => ({
        data: { user: null, session: null },
        error: null,
      })),
      resend: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(
      async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
        data: null,
        error: null,
      })
    ),
  };
  return { client, captured, unsubscribe };
}

beforeEach(() => {
  seam.client = null;
  loadMyProfileMock.mockReset();
  loadMyProfileMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCustomerAuth — bootstrap', () => {
  test('resolves to signed-out when the backend is not configured', async () => {
    seam.client = null;

    const { result, unmount } = renderHook(() => useCustomerAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();

    // With no backend, the effect returns the bare cancel-only cleanup (no auth
    // listener to unsubscribe). Unmount explicitly so that teardown path runs
    // deterministically instead of relying on afterEach's timing.
    unmount();
  });

  test('resolves to signed-out when there is no session — and claims nothing', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;

    const { result } = renderHook(() => useCustomerAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(loadMyProfileMock).not.toHaveBeenCalled();
  });

  test('hydrates user + profile and claims guest orders once on a live session', async () => {
    const { client } = makeClient({ session: SESSION });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);

    const { result } = renderHook(() => useCustomerAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(USER);
    expect(result.current.profile).toEqual(PROFILE);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('link_my_orders');
  });

  test('a failed link_my_orders claim is non-fatal — the account still hydrates', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeClient({ session: SESSION });
    client.rpc.mockResolvedValue({ data: null, error: { message: 'rpc exploded' } });
    seam.client = client;

    const { result } = renderHook(() => useCustomerAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(USER);
    expect(warn).toHaveBeenCalledWith('link_my_orders() rpc failed:', 'rpc exploded');
  });

  test('a failing profile load degrades to profile=null, never a crash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeClient({ session: SESSION });
    seam.client = client;
    loadMyProfileMock.mockRejectedValue(new Error('profile backend down'));

    const { result } = renderHook(() => useCustomerAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(USER);
    expect(result.current.profile).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('useCustomerAuth — auth event stream', () => {
  test('propagates a SIGNED_IN event into user + profile', async () => {
    const { client, captured } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    loadMyProfileMock.mockResolvedValue(PROFILE);

    await act(async () => {
      await captured.onAuthChange?.('SIGNED_IN', SESSION);
    });

    expect(result.current.user).toEqual(USER);
    expect(result.current.profile).toEqual(PROFILE);
  });

  test('a SIGNED_OUT event clears state and re-arms the guest-order claim', async () => {
    const { client, captured } = makeClient({ session: SESSION });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.user).toEqual(USER));
    expect(client.rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await captured.onAuthChange?.('SIGNED_OUT', null);
    });
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();

    // Next sign-in claims again — the once-per-session guard was reset.
    await act(async () => {
      await captured.onAuthChange?.('SIGNED_IN', SESSION);
    });
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  test('repeated auth events in one session claim guest orders only once', async () => {
    const { client, captured } = makeClient({ session: SESSION });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.user).toEqual(USER));

    await act(async () => {
      await captured.onAuthChange?.('TOKEN_REFRESHED', SESSION);
    });

    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('link_my_orders');
  });

  test('unsubscribes the auth listener on unmount (no leaked listeners)', async () => {
    const { client, unsubscribe } = makeClient({ session: null });
    seam.client = client;
    const { result, unmount } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('useCustomerAuth — signUp', () => {
  test('fails with a clear error when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signUpResult;
    await act(async () => {
      signUpResult = await result.current.signUp(SIGNUP_INPUT);
    });

    expect(signUpResult).toEqual({
      ok: false,
      needsConfirmation: false,
      error: 'Backend not configured.',
    });
  });

  test('sends trimmed fields + customer metadata to Supabase', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signUp(SIGNUP_INPUT);
    });

    expect(client.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@lab.example',
        password: 'hunter22',
        options: expect.objectContaining({
          data: expect.objectContaining({
            account_type: 'customer',
            full_name: 'Test Buyer',
            phone: '555-0100',
          }),
        }),
      }),
    );
    // No captcha token given → none forwarded.
    const callArg = client.auth.signUp.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(callArg.options).not.toHaveProperty('captchaToken');
  });

  test('forwards the captcha token opportunistically when provided', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signUp(SIGNUP_INPUT, 'captcha-123');
    });

    expect(client.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ captchaToken: 'captcha-123' }),
      }),
    );
  });

  test('"already registered" errors route to the code step, not a dead end', async () => {
    const { client } = makeClient({ session: null });
    client.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signUpResult;
    await act(async () => {
      signUpResult = await result.current.signUp(SIGNUP_INPUT);
    });

    expect(signUpResult).toEqual({ ok: true, needsConfirmation: true, error: null });
  });

  test('other signup errors surface verbatim', async () => {
    const { client } = makeClient({ session: null });
    client.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Password should be at least 6 characters' },
    });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signUpResult;
    await act(async () => {
      signUpResult = await result.current.signUp(SIGNUP_INPUT);
    });

    expect(signUpResult).toEqual({
      ok: false,
      needsConfirmation: false,
      error: 'Password should be at least 6 characters',
    });
  });

  test('no session on success ⇒ confirmation pending (anti-enumeration path)', async () => {
    const { client } = makeClient({ session: null });
    client.auth.signUp.mockResolvedValue({
      data: { user: USER, session: null },
      error: null,
    });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signUpResult;
    await act(async () => {
      signUpResult = await result.current.signUp(SIGNUP_INPUT);
    });

    expect(signUpResult).toEqual({ ok: true, needsConfirmation: true, error: null });
    expect(result.current.user).toBeNull();
  });

  test('a session on success hydrates immediately, no confirmation needed', async () => {
    const { client } = makeClient({ session: null });
    client.auth.signUp.mockResolvedValue({
      data: { user: USER, session: SESSION },
      error: null,
    });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signUpResult;
    await act(async () => {
      signUpResult = await result.current.signUp(SIGNUP_INPUT);
    });

    expect(signUpResult).toEqual({ ok: true, needsConfirmation: false, error: null });
    expect(result.current.user).toEqual(USER);
    expect(result.current.profile).toEqual(PROFILE);
  });
});

describe('useCustomerAuth — signIn', () => {
  test('fails with a clear error when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn('buyer@lab.example', 'pw');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Backend not configured.');
  });

  test('surfaces the auth error message on bad credentials', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.signIn(' buyer@lab.example ', 'wrong');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Invalid login credentials');
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'buyer@lab.example', password: 'wrong' }),
    );
  });

  test('falls back to a generic message when auth returns neither user nor error', async () => {
    const { client } = makeClient({ session: null });
    client.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('buyer@lab.example', 'pw');
    });

    expect(result.current.error).toBe('Sign-in failed.');
  });

  test('hydrates user + profile and claims guest orders on success', async () => {
    const { client } = makeClient({ session: null });
    client.auth.signInWithPassword.mockResolvedValue({
      data: { user: USER, session: SESSION },
      error: null,
    });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.signIn('buyer@lab.example', 'pw');
    });

    expect(ok).toBe(true);
    expect(result.current.user).toEqual(USER);
    expect(result.current.profile).toEqual(PROFILE);
    expect(result.current.error).toBeNull();
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('link_my_orders');
  });
});

describe('useCustomerAuth — verifyOtp / resendOtp', () => {
  test('verifyOtp fails cleanly when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.verifyOtp('buyer@lab.example', '123456');
    });

    expect(otpResult).toEqual({ ok: false, error: 'Backend not configured.' });
  });

  test('verifyOtp surfaces a bad-code error without hydrating', async () => {
    const { client } = makeClient({ session: null });
    client.auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Token has expired or is invalid' },
    });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.verifyOtp('buyer@lab.example', '000000');
    });

    expect(otpResult).toEqual({ ok: false, error: 'Token has expired or is invalid' });
    expect(result.current.user).toBeNull();
  });

  test('verifyOtp trims inputs, uses the signup type, and hydrates on success', async () => {
    const { client } = makeClient({ session: null });
    client.auth.verifyOtp.mockResolvedValue({
      data: { user: USER, session: SESSION },
      error: null,
    });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.verifyOtp(' buyer@lab.example ', ' 123456 ');
    });

    expect(otpResult).toEqual({ ok: true, error: null });
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'buyer@lab.example',
      token: '123456',
      type: 'signup',
    });
    expect(result.current.user).toEqual(USER);
  });

  test('verifyOtp succeeds without hydrating when no user comes back', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.verifyOtp('buyer@lab.example', '123456');
    });

    expect(otpResult).toEqual({ ok: true, error: null });
    expect(result.current.user).toBeNull();
  });

  test('resendOtp fails cleanly when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.resendOtp('buyer@lab.example');
    });

    expect(otpResult).toEqual({ ok: false, error: 'Backend not configured.' });
  });

  test('resendOtp requests a fresh signup code (with optional captcha)', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.resendOtp(' buyer@lab.example ', 'captcha-123');
    });

    expect(otpResult).toEqual({ ok: true, error: null });
    expect(client.auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'buyer@lab.example',
      options: { captchaToken: 'captcha-123' },
    });
  });

  test('resendOtp surfaces a resend failure', async () => {
    const { client } = makeClient({ session: null });
    client.auth.resend.mockResolvedValue({ error: { message: 'over_email_send_rate_limit' } });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let otpResult;
    await act(async () => {
      otpResult = await result.current.resendOtp('buyer@lab.example');
    });

    expect(otpResult).toEqual({ ok: false, error: 'over_email_send_rate_limit' });
  });
});

describe('useCustomerAuth — signOut / reloadProfile', () => {
  test('signOut clears user + profile and re-arms the guest-order claim', async () => {
    const { client, captured } = makeClient({ session: SESSION });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.user).toEqual(USER));

    await act(async () => {
      await result.current.signOut();
    });
    expect(client.auth.signOut).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();

    // Signing back in claims guest orders again.
    await act(async () => {
      await captured.onAuthChange?.('SIGNED_IN', SESSION);
    });
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  test('signOut is a quiet no-op when the backend is not configured', async () => {
    seam.client = null;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
  });

  test('reloadProfile is a no-op while signed out', async () => {
    const { client } = makeClient({ session: null });
    seam.client = client;
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reloadProfile();
    });

    expect(loadMyProfileMock).not.toHaveBeenCalled();
  });

  test('reloadProfile refreshes the profile for a signed-in user', async () => {
    const { client } = makeClient({ session: SESSION });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.user).toEqual(USER));
    const updated = { ...PROFILE, full_name: 'Renamed Buyer' } as CustomerProfile;
    loadMyProfileMock.mockResolvedValue(updated);

    await act(async () => {
      await result.current.reloadProfile();
    });

    expect(result.current.profile).toEqual(updated);
  });

  test('reloadProfile keeps the prior profile on a transient error', async () => {
    const { client } = makeClient({ session: SESSION });
    seam.client = client;
    loadMyProfileMock.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useCustomerAuth());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    loadMyProfileMock.mockRejectedValue(new Error('transient'));

    await act(async () => {
      await result.current.reloadProfile();
    });

    expect(result.current.profile).toEqual(PROFILE);
  });
});
