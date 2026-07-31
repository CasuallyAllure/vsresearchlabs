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
      const { data, error: rpcError } = await supabase.rpc('admin_prepared_carts', {
        p_user_id: userId, p_limit: 20,
      });
      if (cancelled) return;
      if (rpcError) {
        if (isMissingBackend(rpcError)) setUnmigrated(true);
        else setError(getErrorMessage(rpcError));
        setLoading(false);
        return;
      }
      setCarts((data as { rows?: PreparedCartSummary[] } | null)?.rows ?? []);
      setLoading(false);
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
    const { data, error: rpcError } = await supabase.rpc('admin_create_prepared_cart', {
      p_user_id: userId,
      p_lines: payload,
      p_coupon_code: couponCode,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) { setError(getErrorMessage(rpcError)); return null; }
    reload();
    return data as CreatedPreparedCart;
  }, [userId, reload]);

  const revoke = useCallback(async (cartId: string) => {
    if (!supabase) { setError('Backend not configured.'); return false; }
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_revoke_prepared_cart', { p_id: cartId });
    setBusy(false);
    if (rpcError) { setError(getErrorMessage(rpcError)); return false; }
    reload();
    return (data as { ok?: boolean } | null)?.ok === true;
  }, [reload]);

  return { carts, loading, busy, error, unmigrated, reload, create, revoke };
}
