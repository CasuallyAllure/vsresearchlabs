// supabase/functions/place-order/orderIdentifiers.ts
// Reference / order number generation — server-authoritative.
// VSR-REQ-YYMMDD-NNN (stamp) and VSR-XXXXXX (short unguessable order number).
//
// Deliberately free of Deno globals and remote imports (like rewardVoucher.ts)
// so vitest can drive tests/unit/orderIdentifiers.test.ts and tsc can
// typecheck it. Uses only `Date` and `crypto.getRandomValues`, both present
// in Deno AND in vitest's node environment — no polyfill needed.

function stamp(prefix: string): string {
  const now = new Date();
  const yy  = String(now.getUTCFullYear()).slice(2);
  const mm  = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd  = String(now.getUTCDate()).padStart(2, "0");
  const seq = String(Math.floor(now.getTime() / 100) % 1000).padStart(3, "0");
  return `${prefix}-${yy}${mm}${dd}-${seq}`;
}

// Order numbers are short, unguessable codes (VSR-XXXXXX). Alphabet excludes
// ambiguous characters (O/0/I/1/L) so they read cleanly aloud. Matches the
// DB-side gen_order_number() used by the admin path.
const ORDER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += ORDER_ALPHABET[bytes[i] % ORDER_ALPHABET.length];
  return s;
}
const generateReferenceId = () => stamp("VSR-REQ");
const generateOrderNumber = () => `VSR-${randomCode(6)}`;

export { stamp, ORDER_ALPHABET, randomCode, generateReferenceId, generateOrderNumber };
