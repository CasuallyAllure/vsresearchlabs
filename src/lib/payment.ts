/**
 * Payment config — buyer-facing handles for the manual Zelle / PayPal
 * (Friends & Family) flow.
 *
 * These are PLACEHOLDERS until you set them. Provide real values via Vite
 * env vars in `.env` (and `.env.example`):
 *   VITE_ZELLE_HANDLE   = phone or email your Zelle is registered to
 *   VITE_PAYPAL_HANDLE  = your paypal.me link or PayPal email
 *
 * The invoice EMAIL uses its own server-side env (ZELLE_HANDLE /
 * PAYPAL_HANDLE Supabase secrets) — set both so the on-screen and emailed
 * instructions match.
 */

const env = import.meta.env as Record<string, string | undefined>;

// Fallback is the REAL handle, not a placeholder: on 2026-07-17/18 an
// out-of-band build lane (push-triggered, no VITE_ZELLE_HANDLE in its env)
// shipped "[Set VITE_ZELLE_HANDLE]" to live payment surfaces overnight.
// Buyers must never see a placeholder where the payment address goes —
// env still wins when set.
export const PAYMENT_CONFIG = {
  zelle: env.VITE_ZELLE_HANDLE || 'info@velariss.co',
  paypal: env.VITE_PAYPAL_HANDLE || '[Set VITE_PAYPAL_HANDLE]',
};

/** Format integer cents as USD, e.g. 10500 → "$105.00". */
export function formatUsd(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return (
    '$' +
    (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
