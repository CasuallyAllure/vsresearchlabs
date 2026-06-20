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
  error?: string;
}

export type PlaceOrderOutcome =
  | { ok: true; data: PlaceOrderResponse }
  | { ok: false; message: string };

/** How long to wait for the function before giving the buyer control back. */
const TIMEOUT_MS = 30_000;

class TimeoutError extends Error {}

export async function placeOrder(payload: Record<string, unknown>): Promise<PlaceOrderOutcome> {
  if (!supabase) {
    return { ok: false, message: 'Ordering service is not configured. Please try again later.' };
  }

  try {
    const invocation = supabase.functions.invoke<PlaceOrderResponse>('place-order', {
      body: payload,
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

    return { ok: true, data };
  } catch (err) {
    const message =
      err instanceof TimeoutError
        ? 'The order is taking longer than expected. Check your email for an invoice before retrying — and if nothing arrives, try again.'
        : "We couldn't reach the ordering service. Check your connection and try again.";
    return { ok: false, message };
  }
}
