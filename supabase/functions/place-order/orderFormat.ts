// supabase/functions/place-order/orderFormat.ts
// Pure formatting/validation primitives shared across the place-order
// handler: email/UUID matching, HTML escaping for the invoice emails, and
// line-quantity/price clamping.
//
// Deliberately free of Deno globals and remote imports (like rewardVoucher.ts)
// so vitest can drive tests/unit/orderFormat.test.ts and tsc can typecheck it.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const MAX_LINE_CENTS  = 100_000_00; // $100k per line sanity cap
function clampQty(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(9999, Math.max(1, Math.floor(n)));
}
function clampCents(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_LINE_CENTS, Math.floor(n));
}
function usd(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export { EMAIL_REGEX, UUID_REGEX, escapeHtml, clampQty, clampCents, usd };
