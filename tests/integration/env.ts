/**
 * Shared guard + client factories for the real-database integration tier
 * (tests/integration/**). Same guard semantics as tests/rls/portalIsolation:
 * every suite requires TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY /
 * TEST_SUPABASE_SERVICE_ROLE_KEY, refuses to run unless the URL resolves to a
 * loopback host, and self-skips (describe.skipIf) with a console.log
 * explaining enablement otherwise.
 *
 * NEVER point this at a production project. The suites create and delete
 * fixture rows (products, coupons, orders, vouchers, auth users) through the
 * service-role client — that is only acceptable against a disposable local
 * `supabase start` stack. See docs/INTEGRATION_TESTS.md for setup.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
export const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
export const SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

export function isLoopbackUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export const hasEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
export const canRun = hasEnv && isLoopbackUrl(SUPABASE_URL);

/** Call once at module top of each suite so a skipped run says why. */
export function logSkipReason(suite: string): void {
  if (canRun) return;
  if (!hasEnv) {
    console.log(
      `[integration] Skipping ${suite}: TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / ` +
        'TEST_SUPABASE_SERVICE_ROLE_KEY are not set. Run `supabase start` locally (Docker ' +
        'required), set those three env vars from `supabase status`, then re-run. See ' +
        'docs/INTEGRATION_TESTS.md.',
    );
  } else {
    console.log(
      `[integration] Skipping ${suite}: TEST_SUPABASE_URL ("${SUPABASE_URL}") is not a ` +
        'loopback host. This suite only runs against a local Supabase stack — never point ' +
        'it at a hosted/production project.',
    );
  }
}

/** Service-role client: bypasses RLS; used for fixtures + direct RPC calls. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL ?? '', SERVICE_ROLE_KEY ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anon client: what an unauthenticated browser sees through PostgREST. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL ?? '', ANON_KEY ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
