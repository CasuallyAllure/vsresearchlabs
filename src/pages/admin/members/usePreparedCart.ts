/**
 * usePreparedCart — the data source behind the "Build cart" composer.
 *
 * Three RPCs from migration 081, all is_admin()-gated SECURITY DEFINER:
 *   admin_create_prepared_cart(...)  → persists the list, returns the link
 *                                      token ONCE (it is stored only as a
 *                                      SHA-256 digest and can never be read
 *                                      back — losing it means building again).
 *   admin_revoke_prepared_cart(id)   → the kill switch.
 *   admin_prepared_carts(user, n)    → the ONLY read path; it structurally
 *                                      omits token_hash.
 *
 * Missing 081 degrades to `unmigrated` — the same calm posture the rest of the
 * Members surface takes (see backend.ts / useMembersData).
 *
 * All pricing and line-shape logic is pure and lives in src/lib/preparedCart.ts
 * so it is unit-testable; this hook does I/O only.
 *
 * ── SEAM FOR THE EMAIL WORKSTREAM ────────────────────────────────────────────
 * This hook stops at "the cart exists and here is its link". It deliberately
 * sends nothing. The next workstream adds a `send-prepared-cart` edge function
 * (structural copy of send-invite: requireAdmin + Resend + an email_log row
 * with kind 'prepared_cart' and period_key 'pc-<cart id>') and calls it from
 * `create`'s result — the plaintext token is available there and nowhere else,
 * so that is the only place the mail can be composed.
 *
 * `preparedCartClaimUrl` below is the contract between the two halves: the
 * token rides in the URL HASH, never a query param, so it is never sent to a
 * server and never appears in a Referer header. The claim route
 * (/account/prepared) must capture it to a ref on first mount and scrub it with
 * history.replaceState before navigating.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import productsData from '../../../data/products.json';
import generatedCompounds from '../../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../../types';
import { buildVariantIndex, type PreparedCartLine, type VariantIndex } from '../../../lib/preparedCart';
import { useProductOverrides } from '../../../lib/productOverrides';
import { getErrorMessage, isMissingBackend } from './backend';

/** The full catalog, exactly as the admin order composer enumerates it. */
const CATALOG = [...productsData, ...generatedCompounds] as unknown as Product[];

export type PreparedCartStatus = 'live' | 'claimed' | 'expired' | 'revoked';

export interface PreparedCartSummary {
  id: string;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  revoked_at: string | null;
  coupon_code: string | null;
  note: string | null;
  status: PreparedCartStatus;
  lines: PreparedCartLine[];
}

/** What admin_create_prepared_cart returns. `token` is the plaintext, visible
 *  here and nowhere else, ever. */
export interface CreatedPreparedCart {
  cart_id: string;
  token: string;
  expires_at: string;
}

/**
 * The member-facing claim link. Hash fragment by design — see the seam note
 * above. The claim route itself is the next workstream; this function is the
 * one place the URL shape is written down.
 */
export function preparedCartClaimUrl(token: string, origin: string): string {
  return `${origin}/account/prepared#t=${token}`;
}

/**
 * The compound → dose index the two dropdowns render. Kicks the per-variant
 * override load so the picker shows real admin prices rather than the
 * placeholder formula even if the admin lands here cold, and rebuilds whenever
 * those overrides arrive.
 */
export function useVariantIndex(): VariantIndex {
  useEffect(() => { void useProductOverrides.getState().load(); }, []);
  const variantBySku = useProductOverrides((s) => s.variantBySku);
  return useMemo(() => buildVariantIndex(CATALOG), [variantBySku]);
}

/**
 * Upper bound on any one prepared-cart RPC. Generous — building a cart writes a
 * row per line plus an audit entry — but finite, which is the whole point.
 */
const RPC_TIMEOUT_MS = 15_000;

const timeoutMessage = (verb: string) =>
  `${verb} did not respond within ${RPC_TIMEOUT_MS / 1000}s. Reload this panel before trying again — ` +
  'the request may still have gone through.';

/**
 * Runs one prepared-cart RPC with a hard upper bound.
 *
 * supabase-js folds network failures into `{ error }` rather than rejecting, so
 * the resolved-error path is well covered — but NOTHING in the stack bounds how
 * long the call may take. `fetch` has no default timeout, and supabase-js awaits
 * `auth.getSession()` BEFORE it ever reaches `fetch`, so a stalled session read
 * hangs the promise before a request is even made. Either one used to leave
 * `busy` pinned true and the button reading "Working…" with no error and no
 * result — the bug this guards.
 *
 * A plain race rather than `.abortSignal()`: the signal is only handed to
 * `fetch`, so it cannot reach the half of the hang that happens before `fetch`
 * is called. The message says the write may still have landed because aborting
 * the client would not have rolled the server back either.
 */
async function rpcWithTimeout(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  verb: string,
): Promise<{ data: unknown; error: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.rpc(fn, args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage(verb))), RPC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One place to fail loudly: friendly message into `error`, raw object into the
 *  console so the next person debugging in production has something to read. */
function reportRpcFailure(fn: string, raw: unknown, setError: (m: string) => void): void {
  console.error(`[preparedCart] ${fn} failed`, raw);
  setError(getErrorMessage(raw));
}

interface UsePreparedCartResult {
  carts: PreparedCartSummary[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  unmigrated: boolean;
  reload: () => void;
  create: (input: {
    lines: PreparedCartLine[];
    couponCode: string | null;
    note: string | null;
  }) => Promise<CreatedPreparedCart | null>;
  revoke: (cartId: string) => Promise<boolean>;
}

export function usePreparedCart(userId: string): UsePreparedCartResult {
  const [carts, setCarts] = useState<PreparedCartSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); setLoading(false); return; }
      setLoading(true);
      try {
        const { data, error: rpcError } = await rpcWithTimeout(
          supabase, 'admin_prepared_carts', { p_user_id: userId, p_limit: 20 }, 'Loading built carts',
        );
        if (cancelled) return;
        if (rpcError) {
          // The message is recorded EVEN when we degrade to `unmigrated`.
          // PGRST202 is ambiguous: it is equally "081 was never applied" and
          // "081 was applied a minute ago and PostgREST's schema cache is still
          // stale". Latching the calm placeholder without saying why turned the
          // second case into a dead end — no error, no result, nothing to act
          // on. The placeholder now renders this alongside it.
          reportRpcFailure('admin_prepared_carts', rpcError, setError);
          if (isMissingBackend(rpcError)) setUnmigrated(true);
          return;
        }
        setCarts((data as { rows?: PreparedCartSummary[] } | null)?.rows ?? []);
      } catch (err) {
        if (cancelled) return;
        reportRpcFailure('admin_prepared_carts', err, setError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const create = useCallback<UsePreparedCartResult['create']>(async ({ lines, couponCode, note }) => {
    if (!supabase) { setError('Backend not configured.'); return null; }
    setBusy(true);
    setError(null);
    // Only (sku, dose, quantity) travels. The RPC rejects any line carrying a
    // price key — a prepared cart is a shopping list, not a quote.
    const payload = lines.map((l) => ({ sku: l.sku, dose: l.dose, quantity: l.quantity }));
    try {
      const { data, error: rpcError } = await rpcWithTimeout(
        supabase,
        'admin_create_prepared_cart',
        { p_user_id: userId, p_lines: payload, p_coupon_code: couponCode, p_note: note },
        'Building the cart',
      );
      if (rpcError) { reportRpcFailure('admin_create_prepared_cart', rpcError, setError); return null; }
      reload();
      return data as CreatedPreparedCart;
    } catch (err) {
      reportRpcFailure('admin_create_prepared_cart', err, setError);
      return null;
    } finally {
      // In `finally`, so no path — rejection, timeout, early return — can leave
      // the button stuck reading "Working…".
      setBusy(false);
    }
  }, [userId, reload]);

  const revoke = useCallback(async (cartId: string) => {
    if (!supabase) { setError('Backend not configured.'); return false; }
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await rpcWithTimeout(
        supabase, 'admin_revoke_prepared_cart', { p_id: cartId }, 'Revoking the cart',
      );
      if (rpcError) { reportRpcFailure('admin_revoke_prepared_cart', rpcError, setError); return false; }
      reload();
      return (data as { ok?: boolean } | null)?.ok === true;
    } catch (err) {
      reportRpcFailure('admin_revoke_prepared_cart', err, setError);
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return { carts, loading, busy, error, unmigrated, reload, create, revoke };
}
