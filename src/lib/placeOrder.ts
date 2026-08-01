/**
 * placeOrder — hardened client wrapper around the `place-order` Edge Function.
 *
 * The cart submit handlers previously awaited `supabase.functions.invoke`
 * with no try/catch and no timeout. If the call threw (a network/CORS error
 * on the deploy origin) or never resolved, the form was stranded in its
 * "submitting" state forever — button greyed out, no error shown, no email.
 *
 * This wrapper guarantees a settled outcome every time:
 *   • a throw (network/CORS) → { ok:false } with a friendly message
 *   • no response within the timeout → { ok:false } (so the button re-enables)
 *   • an HTTP/function error → { ok:false } with the server's message
 *   • success → { ok:true } with the server-authoritative order fields
 */

import { supabase } from './supabase';

/** Server-authoritative response shape from the place-order function. */
export interface PlaceOrderResponse {
  success?: boolean;
  orderNumber?: string;
  referenceId?: string;
  createdAt?: string;
  amountCents?: number;
  invoiceEmailSent?: boolean;
  contactIsEmail?: boolean;
  /** true when this response is a replay of an order the server already
   *  created for the same idempotency key (retry after a timeout). */
  duplicate?: boolean;
  /** Plain-language explanations for anything the server decided differently
   *  from what the cart quoted — e.g. a promo window that closed while the
   *  cart sat open. Additive: absent from older deploys, so treat as []. */
  notices?: string[];
  error?: string;
}

export type PlaceOrderOutcome =
  | { ok: true; data: PlaceOrderResponse }
  | { ok: false; message: string };

/** How long to wait for the function before giving the buyer control back. */
const TIMEOUT_MS = 30_000;

class TimeoutError extends Error {}

// ── Idempotency key ─────────────────────────────────────────────────────────
// One UUID per logical checkout: a retry after a timeout/network failure
// re-sends the SAME key, so the server returns the already-created order
// instead of creating (and re-emailing) a duplicate. The key is bound to a
// signature of the cart contents — editing the cart rotates the key, so a
// genuinely different order is never deduped away. sessionStorage scopes it
// to the tab and clears it on success.

const IDEM_STORAGE_KEY = 'checkout.idempotency.v1';

function cartSignature(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? (payload.items as unknown[]) : [];
  return JSON.stringify(
    items.map((raw) => {
      const r = (raw ?? {}) as { product?: { id?: unknown }; quantity?: unknown; note?: unknown };
      return [r.product?.id ?? null, r.quantity ?? null, r.note ?? null];
    }),
  );
}

function checkoutIdempotencyKey(payload: Record<string, unknown>): string | null {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return null;
  const sig = cartSignature(payload);
  try {
    const stored = JSON.parse(sessionStorage.getItem(IDEM_STORAGE_KEY) ?? 'null') as
      { key?: string; sig?: string } | null;
    if (stored?.key && stored.sig === sig) return stored.key;
  } catch {
    /* corrupted/unavailable storage — fall through to a fresh key */
  }
  const key = crypto.randomUUID();
  try {
    sessionStorage.setItem(IDEM_STORAGE_KEY, JSON.stringify({ key, sig }));
  } catch {
    /* storage unavailable (private mode) — key still protects this attempt */
  }
  return key;
}

function clearIdempotencyKey(): void {
  try {
    sessionStorage.removeItem(IDEM_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function placeOrder(payload: Record<string, unknown>): Promise<PlaceOrderOutcome> {
  if (!supabase) {
    return { ok: false, message: 'Ordering service is not configured. Please try again later.' };
  }

  const idempotencyKey = checkoutIdempotencyKey(payload);

  try {
    // Auth note (customer portal): no explicit Authorization header is needed
    // here. supabase.functions.invoke routes through supabase-js's
    // fetchWithAuth, which sets `Authorization: Bearer <session access_token>`
    // automatically whenever a customer session exists (and the anon key when
    // not) — verified against @supabase/supabase-js 2.110.2
    // (_getAccessToken() → session?.access_token ?? supabaseKey). place-order
    // resolves membership from that verified bearer alone (P0-5) — the typed
    // contact is a delivery address, not identity; the guest flow is unchanged.
    const invocation = supabase.functions.invoke<PlaceOrderResponse>('place-order', {
      body: idempotencyKey ? { ...payload, idempotency_key: idempotencyKey } : payload,
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError()), TIMEOUT_MS),
    );

    const { data, error } = await Promise.race([invocation, timeout]);

    if (error || !data?.success) {
      const message =
        (data && typeof data === 'object' && typeof data.error === 'string' ? data.error : null) ??
        (error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : null) ??
        'Failed to place order. Please try again.';
      return { ok: false, message };
    }

    clearIdempotencyKey();
    return { ok: true, data };
  } catch (err) {
    const message =
      err instanceof TimeoutError
        ? 'The order is taking longer than expected. Check your email for an invoice before retrying — and if nothing arrives, try again.'
        : "We couldn't reach the ordering service. Check your connection and try again.";
    return { ok: false, message };
  }
}
