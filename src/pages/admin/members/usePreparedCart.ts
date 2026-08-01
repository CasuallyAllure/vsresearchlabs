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
 * ── DELIVERY ─────────────────────────────────────────────────────────────────
 * `send` posts to the `send-prepared-cart` edge function (requireAdmin +
 * Resend + an email_log row, kind 'prepared_cart', period_key 'pc-<cart id>').
 * It is called from `create`'s RESULT and nowhere else, because that result is
 * the only place the plaintext token ever exists — it is stored as a SHA-256
 * digest and cannot be read back, so a cart whose token was lost can only be
 * rebuilt.
 *
 * `send` reports the outcome instead of throwing, and the panel renders it:
 * a failed send is SAID SO, and the copyable link stays on screen as the
 * fallback. Reporting a send that did not happen would be the worst possible
 * failure here — the owner would believe a client had been contacted.
 *
 * `preparedCartClaimUrl` below is the contract between the two halves: the
 * token rides in the URL HASH, never a query param, so it is never sent to a
 * server and never appears in a Referer header. The claim route
 * (src/pages/account/AccountPreparedCart.tsx) captures it on first mount and
 * scrubs it with history.replaceState before anything navigates.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { RPC_TIMEOUT_SECONDS, rpcWithTimeout, withTimeout } from '../../../lib/rpcTimeout';
import productsData from '../../../data/products.json';
import generatedCompounds from '../../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../../types';
import { buildVariantIndex, type PreparedCartLine, type VariantIndex } from '../../../lib/preparedCart';
import { useProductOverrides } from '../../../lib/productOverrides';
import { getErrorMessage, isMissingBackend } from './backend';

/** The full catalog, exactly as the admin order composer enumerates it. */
const CATALOG = [...productsData, ...generatedCompounds] as unknown as Product[];

/**
 * OPENABILITY, not history. 081 derived a fourth state, 'claimed', the moment
 * the member first opened the link — correct when a claim was single-use, and
 * misleading once 082 made the link re-openable (the cart it fills is
 * device-local, so phone-then-laptop has to work). An owner reading "claimed"
 * would reasonably conclude the link was spent and rebuild one the member could
 * already open. How often it has been opened is `claimCount`, below.
 *
 * 083 adds one genuinely terminal state: 'converted'. It is not a failure and
 * not merely "revoked" — the cart became a real order, and the panel owes the
 * owner that order's number rather than a dead link. The server checks it
 * BEFORE 'revoked' because converting also revokes.
 */
export type PreparedCartStatus = 'live' | 'expired' | 'revoked' | 'converted';

export interface PreparedCartSummary {
  id: string;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  /** Most recent open. null until the member has opened it at least once. */
  last_claimed_at: string | null;
  /** How many times the member has opened the link. Display only. */
  claim_count: number;
  revoked_at: string | null;
  /** Set once the cart was pushed through into a real order (083). */
  converted_at: string | null;
  converted_order_id: string | null;
  /** Human-readable order number, for the "converted → ORDER-…" link. */
  converted_order_number: string | null;
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
 * The bounded-RPC helper moved to src/lib/rpcTimeout.ts when the member-facing
 * claim page needed exactly the same guarantee (and, being a page, could not
 * import it from the admin tree). Behaviour is unchanged — the race, the
 * `finally` clear, and this panel's own wording, which stays here because the
 * member page owes its reader a different sentence.
 */
const timeoutMessage = (verb: string) =>
  `${verb} did not respond within ${RPC_TIMEOUT_SECONDS}s. Reload this panel before trying again — ` +
  'the request may still have gone through.';

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
  send: (cart: CreatedPreparedCart) => Promise<SendResult>;
}

/**
 * What actually happened to the email. Never a bare boolean: "we did not send
 * it because the member opted out of marketing" and "Resend rejected it" call
 * for different words and different next steps from the owner.
 */
export type SendResult =
  | { status: 'sent'; recipient: string }
  | { status: 'already_sent'; recipient: string | null }
  | { status: 'opted_out'; recipient: string | null }
  | { status: 'failed'; detail: string };

interface SendResponseBody {
  ok?: boolean;
  status?: string;
  recipient?: string | null;
  error?: string;
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
          supabase, 'admin_prepared_carts', { p_user_id: userId, p_limit: 20 }, timeoutMessage('Loading built carts'),
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
        timeoutMessage('Building the cart'),
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
        supabase, 'admin_revoke_prepared_cart', { p_id: cartId }, timeoutMessage('Revoking the cart'),
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

  /**
   * Mail the claim link. Takes the WHOLE create result because the plaintext
   * token lives only there — it is never persisted and cannot be read back.
   *
   * Every path returns a SendResult rather than throwing: the cart already
   * exists at this point, and losing the panel to an exception would take the
   * copyable link — the fallback the owner needs precisely when the mail did
   * not go — down with it.
   */
  const send = useCallback<UsePreparedCartResult['send']>(async (cart) => {
    if (!supabase) return { status: 'failed', detail: 'Backend not configured.' };
    try {
      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke<SendResponseBody>('send-prepared-cart', {
          body: { cart_id: cart.cart_id, token: cart.token },
        }),
        `Sending the email did not finish within ${RPC_TIMEOUT_SECONDS}s — it may or may not have gone out. ` +
          'Check the member before rebuilding.',
      );

      if (fnError) {
        console.error('[preparedCart] send-prepared-cart failed', fnError);
        // A non-2xx from the function arrives here with the body attached; the
        // suppression cases are 2xx and land below.
        return { status: 'failed', detail: getErrorMessage(fnError) };
      }

      if (data?.status === 'already_sent') return { status: 'already_sent', recipient: data.recipient ?? null };
      if (data?.status === 'opted_out')    return { status: 'opted_out', recipient: data.recipient ?? null };
      if (data?.ok === true && data.recipient) return { status: 'sent', recipient: data.recipient };

      console.error('[preparedCart] send-prepared-cart returned an unrecognised body', data);
      return { status: 'failed', detail: data?.error ?? 'The email service gave an unexpected answer.' };
    } catch (err) {
      console.error('[preparedCart] send-prepared-cart threw', err);
      return { status: 'failed', detail: getErrorMessage(err) };
    }
  }, []);

  return { carts, loading, busy, error, unmigrated, reload, create, revoke, send };
}
