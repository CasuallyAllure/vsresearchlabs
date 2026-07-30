/**
 * customerAuth — Supabase Auth context for PUBLIC customer accounts.
 *
 * Distinct from adminAuth: an admin is a Supabase user in `admin_users`; a
 * customer is any other Supabase user, carrying a `customer_profiles` row.
 * Both ride the same auth event stream, so this hook is the customer-facing
 * mirror of useAdminAuth.
 *
 * Responsibilities:
 *   - resolve the initial session + subscribe to auth changes
 *   - load the customer's profile when signed in
 *   - claim any prior guest orders (by email) on first authenticated load
 *   - expose signUp / signIn / signOut helpers
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { loadMyProfile, type CustomerProfile } from './customerProfile';

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface SignUpResult {
  ok: boolean;
  /** True when confirmation is pending (new signup OR finishing an abandoned
   *  one) → route to the code step. */
  needsConfirmation: boolean;
  error: string | null;
}

interface CustomerAuthState {
  loading: boolean;
  user: User | null;
  profile: CustomerProfile | null;
  error: string | null;
}

export interface OtpResult {
  ok: boolean;
  error: string | null;
}

export interface CustomerAuthApi extends CustomerAuthState {
  signUp: (input: SignUpInput, captchaToken?: string | null) => Promise<SignUpResult>;
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<boolean>;
  /** Confirm a new account with the 6-digit code emailed by Supabase. */
  verifyOtp: (email: string, token: string) => Promise<OtpResult>;
  /** Re-send the 6-digit signup confirmation code. */
  resendOtp: (email: string, captchaToken?: string | null) => Promise<OtpResult>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

/** Claim guest orders that match this user's email. Best-effort, runs once. */
async function claimGuestOrders(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('link_my_orders');
  if (error) {
    // Non-fatal: the account still works, "My Orders" just won't backfill.
    // eslint-disable-next-line no-console
    console.warn('link_my_orders() rpc failed:', error.message);
  }
}

export function useCustomerAuth(): CustomerAuthApi {
  const [state, setState] = useState<CustomerAuthState>({
    loading: true,
    user: null,
    profile: null,
    error: null,
  });
  // Guard so guest-order claiming only fires once per signed-in session.
  const claimedRef = useRef(false);

  const hydrate = useCallback(async (user: User | null) => {
    if (!user) {
      claimedRef.current = false;
      setState({ loading: false, user: null, profile: null, error: null });
      return;
    }
    if (!claimedRef.current) {
      claimedRef.current = true;
      await claimGuestOrders();
    }
    let profile: CustomerProfile | null = null;
    try {
      profile = await loadMyProfile();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn('loadMyProfile failed:', err);
    }
    setState({ loading: false, user, profile, error: null });
  }, []);

  // Resolve initial session + subscribe to auth changes.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!supabase) {
        if (!cancelled) {
          setState({ loading: false, user: null, profile: null, error: null });
        }
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!cancelled) await hydrate(data.session?.user ?? null);
    }

    bootstrap();

    if (!supabase) {
      return () => {
        cancelled = true;
      };
    }

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!cancelled) await hydrate(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [hydrate]);

  const signUp = useCallback(async (input: SignUpInput, captchaToken?: string | null): Promise<SignUpResult> => {
    if (!supabase) {
      return { ok: false, needsConfirmation: false, error: 'Backend not configured.' };
    }
    setState((s) => ({ ...s, error: null }));
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        emailRedirectTo: `${window.location.origin}/account`,
        // Passed opportunistically: ignored by Supabase Auth when CAPTCHA is
        // disabled in the dashboard, required once it's enabled. Safe either way.
        ...(captchaToken ? { captchaToken } : {}),
        // Read by the handle_new_customer() trigger to materialize the profile.
        data: {
          account_type: 'customer',
          full_name: input.fullName.trim(),
          phone: input.phone.trim(),
          address_line1: input.addressLine1.trim(),
          address_line2: input.addressLine2.trim(),
          city: input.city.trim(),
          state: input.state.trim(),
          postal_code: input.postalCode.trim(),
          country: input.country.trim(),
        },
      },
    });

    if (error) {
      // Anti-enumeration OFF: a duplicate signup errors ("User already
      // registered"). That email may just be UNCONFIRMED from an abandoned
      // signup, so send them to the code step (the code card's Resend fetches a
      // fresh code) rather than dead-ending them.
      if (/already\s+(registered|been registered|exists|signed up)/i.test(error.message)) {
        return { ok: true, needsConfirmation: true, error: null };
      }
      return { ok: false, needsConfirmation: false, error: error.message };
    }
    // Anti-enumeration ON: an existing email comes back as an obfuscated user
    // with EMPTY identities and no session — indistinguishable from confirmed vs
    // unconfirmed. For an unconfirmed re-signup Supabase auto-sends a fresh code.
    // A NEW email returns populated identities + no session. Either way, no
    // session => confirmation pending => go to the code step. (A genuinely
    // already-confirmed user just taps "Back to sign in" from there.)
    const needsConfirmation = !data.session;
    if (data.session?.user) {
      await hydrate(data.session.user);
    }
    return { ok: true, needsConfirmation, error: null };
  }, [hydrate]);

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string | null) => {
    if (!supabase) {
      setState((s) => ({ ...s, error: 'Backend not configured.' }));
      return false;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      // Ignored when CAPTCHA is off; required once enabled in the dashboard.
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error || !data.user) {
      setState((s) => ({
        ...s,
        loading: false,
        error: error?.message ?? 'Sign-in failed.',
      }));
      return false;
    }
    await hydrate(data.user);
    return true;
  }, [hydrate]);

  const verifyOtp = useCallback(async (email: string, token: string): Promise<OtpResult> => {
    if (!supabase) return { ok: false, error: 'Backend not configured.' };
    setState((s) => ({ ...s, error: null }));
    // 'signup' = confirm a newly-created (password) account via the emailed code.
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'signup',
    });
    if (error) return { ok: false, error: error.message };
    if (data.user) await hydrate(data.user);
    return { ok: true, error: null };
  }, [hydrate]);

  const resendOtp = useCallback(async (email: string, captchaToken?: string | null): Promise<OtpResult> => {
    if (!supabase) return { ok: false, error: 'Backend not configured.' };
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    claimedRef.current = false;
    setState({ loading: false, user: null, profile: null, error: null });
  }, []);

  const reloadProfile = useCallback(async () => {
    if (!state.user) return;
    try {
      const profile = await loadMyProfile();
      setState((s) => ({ ...s, profile }));
    } catch {
      /* keep prior profile on transient error */
    }
  }, [state.user]);

  return { ...state, signUp, signIn, verifyOtp, resendOtp, signOut, reloadProfile };
}
