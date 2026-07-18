/**
 * Payment config — the buyer-facing handle for the manual Zelle flow.
 *
 * Provide the real value via the Vite env var in `.env` (and
 * `.env.example`): VITE_ZELLE_HANDLE = phone or email your Zelle is
 * registered to. The invoice EMAIL uses its own server-side env
 * (ZELLE_HANDLE Supabase secret) — set both so the on-screen and emailed
 * instructions match. PayPal is removed from the payment flow;
 * re-enabling it needs code, not just env.
 */

const env = import.meta.env as Record<string, string | undefined>;

// Fallback is the REAL handle, not a placeholder: on 2026-07-17/18 an
// out-of-band build lane (push-triggered, no VITE_ZELLE_HANDLE in its env)
// shipped "[Set VITE_ZELLE_HANDLE]" to live payment surfaces overnight.
// Buyers must never see a placeholder where the payment address goes —
// env still wins when set. scripts/viteEnvGuard.ts additionally fails any
// build whose output contains a "[Set …]" placeholder.
export const PAYMENT_CONFIG = {
  zelle: env.VITE_ZELLE_HANDLE || 'info@velariss.co',
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
