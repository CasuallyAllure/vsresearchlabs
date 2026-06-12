/**
 * adminAuth — Supabase Auth context for /admin/* routes.
 *
 * Tracks three pieces of derived state per render:
 *   - `loading`      : true while we resolve the initial session or
 *                      verify admin role
 *   - `user`         : the Supabase auth user, if signed in
 *   - `isAdmin`      : true only if user_id is in admin_users.active=true
 *
 * Sign-in / sign-out helpers are colocated so consumers don't need to
 * import the supabase client directly.
 */

import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AdminAuthState {
  loading: boolean;
  user: User | null;
  isAdmin: boolean;
  /** Last error from a sign-in attempt. Cleared on the next attempt. */
  error: string | null;
}

interface AdminAuthApi extends AdminAuthState {
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

async function checkAdminRole(): Promise<boolean> {
  if (!supabase) return false;
  // is_admin() is a SECURITY DEFINER fn that returns boolean.
  const { data, error } = await supabase.rpc('is_admin');
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('is_admin() rpc failed:', error.message);
    return false;
  }
  return data === true;
}

export function useAdminAuth(): AdminAuthApi {
  const [state, setState] = useState<AdminAuthState>({
    loading: true,
    user: null,
    isAdmin: false,
    error: null,
  });

  // Resolve initial session + subscribe to auth changes.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!supabase) {
        if (!cancelled) {
          setState({ loading: false, user: null, isAdmin: false, error: null });
        }
        return;
      }
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      const isAdmin = user ? await checkAdminRole() : false;
      if (!cancelled) {
        setState({ loading: false, user, isAdmin, error: null });
      }
    }

    bootstrap();

    if (!supabase) {
      return () => {
        cancelled = true;
      };
    }

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user ?? null;
      const isAdmin = user ? await checkAdminRole() : false;
      if (!cancelled) {
        setState((prev) => ({ ...prev, loading: false, user, isAdmin }));
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      setState((s) => ({ ...s, error: 'Backend not configured.' }));
      return false;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setState((s) => ({
        ...s,
        loading: false,
        error: error?.message ?? 'Sign-in failed.',
      }));
      return false;
    }
    const isAdmin = await checkAdminRole();
    setState({ loading: false, user: data.user, isAdmin, error: null });
    if (!isAdmin) {
      // Signed in but not in admin_users — refuse access and sign out.
      await supabase.auth.signOut();
      setState({
        loading: false,
        user: null,
        isAdmin: false,
        error: 'This account is not authorized for admin access.',
      });
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setState({ loading: false, user: null, isAdmin: false, error: null });
  }, []);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    const isAdmin = user ? await checkAdminRole() : false;
    setState((s) => ({ ...s, loading: false, user, isAdmin }));
  }, []);

  return { ...state, signIn, signOut, refresh };
}
