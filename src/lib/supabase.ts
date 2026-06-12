/**
 * Supabase client + auth seam.
 *
 * Exports the singleton `supabase` client (anon key, browser-side) and a
 * small `auth` helper namespace for sign-in / sign-out / session readout.
 * The `requireSupabase()` helper throws a typed error if env vars are
 * absent — used by admin code paths that genuinely cannot proceed without
 * a configured backend.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let supabase: SupabaseClient | null = null;

const hasValidUrl =
  typeof supabaseUrl === 'string' &&
  (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://'));
const hasKey = typeof supabaseAnonKey === 'string' && supabaseAnonKey.length > 0;

if (hasValidUrl && hasKey) {
  try {
    supabase = createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Supabase client init failed — running without backend:', err);
    supabase = null;
  }
} else {
  // eslint-disable-next-line no-console
  console.warn('Supabase env missing or placeholder — client not initialized');
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase backend is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    this.name = 'SupabaseNotConfiguredError';
  }
}

/** Asserts and returns the supabase client, or throws a typed error. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export { supabase };
