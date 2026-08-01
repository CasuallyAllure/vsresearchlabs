/**
 * preparedCartDetail — the pure display logic behind an OPENED prepared cart.
 *
 * The owner's complaint this exists for: he could see that a cart existed but
 * not what was in it or when it went out, which is exactly what he needs when a
 * member rings about an order. Everything the opened row states about time,
 * expiry, opens and delivery is derived here, so it is testable without a page.
 *
 * NOTHING HERE IS ABOUT MONEY. Line prices and totals come from
 * `priceLines` in src/lib/preparedCart.ts — the SAME call the composer makes,
 * with the same member percent, which is what makes the opened cart's total and
 * the composer's quote the same number by construction rather than by
 * agreement.
 *
 * ── WHY DELIVERY IS A THREE-STATE, NOT A BOOLEAN ────────────────────────────
 * There is exactly one durable record that a prepared-cart email went out: the
 * `email_log` row the send-prepared-cart edge function claims before sending
 * (kind 'prepared_cart', period_key `pc-<cart id>` — 075 owns the table). That
 * row is DELETED again when Resend rejects the send (handler.ts releases the
 * claim so a retry is possible), and it is never written at all when the member
 * has opted out of marketing.
 *
 * So the ledger answers "did it go out?" and cannot answer "why not?":
 *
 *   emailed     — a row exists. It carries when, and to whom.
 *   not_emailed — the ledger was read and holds nothing for this cart. Opted
 *                 out, delivery failed, or never sent — INDISTINGUISHABLE, and
 *                 the UI must not guess between them.
 *   unknown     — the ledger could not be read (075 not applied, or the read
 *                 failed). Not the same as "no", and never rendered as one.
 *
 * The alternative — inventing a `delivery_status` column — would mean the panel
 * showed a state the send path does not actually record. That is worse than
 * saying "not on record", because the one thing this surface must never do is
 * claim a client was contacted when they were not.
 */

/** The `email_log` columns this module reads. Deliberately three: the table
 *  also carries a recipient-scoped `user_id` and free-form metadata, neither of
 *  which the panel has any use for. */
export interface PreparedCartEmailLogRow {
  period_key: string;
  sent_at: string;
  recipient: string | null;
}

export type PreparedCartDelivery =
  | { state: 'emailed'; at: string; to: string | null }
  | { state: 'not_emailed' }
  | { state: 'unknown' };

/** The idempotency key send-prepared-cart writes for a cart. The one place this
 *  string shape is written down on the client — it must match
 *  supabase/functions/send-prepared-cart/handler.ts's `pc-${cartId}`. */
export function preparedCartPeriodKey(cartId: string): string {
  return `pc-${cartId}`;
}

/**
 * Fold an `email_log` read into one delivery answer per cart.
 *
 * `rows === null` means the read did not happen or failed, and EVERY cart comes
 * back `unknown` — degrading to `not_emailed` would tell the owner a client was
 * never contacted on the strength of a query that never ran.
 *
 * A cart with more than one row (possible: the unique is per RECIPIENT, so a
 * member whose address changed could accumulate two) reports the EARLIEST,
 * because the question is when the cart first reached them.
 */
export function deliveryByCart(
  cartIds: string[],
  rows: PreparedCartEmailLogRow[] | null,
): Map<string, PreparedCartDelivery> {
  const out = new Map<string, PreparedCartDelivery>();
  if (rows === null) {
    for (const id of cartIds) out.set(id, { state: 'unknown' });
    return out;
  }

  const byKey = new Map<string, PreparedCartEmailLogRow>();
  for (const row of rows) {
    const seen = byKey.get(row.period_key);
    if (!seen || row.sent_at < seen.sent_at) byKey.set(row.period_key, row);
  }

  for (const id of cartIds) {
    const row = byKey.get(preparedCartPeriodKey(id));
    out.set(id, row ? { state: 'emailed', at: row.sent_at, to: row.recipient ?? null } : { state: 'not_emailed' });
  }
  return out;
}

/**
 * A stored timestamp as the owner reads it — "Aug 12, 2026, 3:04 PM", in HIS
 * timezone.
 *
 * Every date on this surface is a `timestamptz` off the RPC, not the date-only
 * string `members/format.ts::shortDate` was written for. Feeding one of those
 * to `shortDate` renders the literal text "Invalid Date", which is what the
 * built-carts list was doing to `created_at` — the single field the owner asked
 * for by name ("I can't see when I sent it").
 *
 * The time is kept, not trimmed to a day: this figure is read while a member is
 * on the phone about an order, and "which of the two you built that afternoon"
 * is a question a bare date cannot answer.
 */
export function stampLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Expiry, and whether it has already gone by.
 *
 * `passed` is computed from the timestamp rather than read off the cart's
 * status, because a cart can be `revoked` or `converted` AND expired — status
 * reports the terminal outcome and would hide the second fact. The owner
 * reopening a lapsed cart needs to know the window closed regardless of what
 * else happened to it.
 */
export function expiryNote(
  expiresAtIso: string | null | undefined,
  now: Date,
): { label: string; passed: boolean } {
  const at = expiresAtIso ? new Date(expiresAtIso).getTime() : NaN;
  const passed = Number.isFinite(at) && at <= now.getTime();
  return { label: `${passed ? 'Expired' : 'Expires'} ${stampLabel(expiresAtIso)}`, passed };
}

/**
 * "opened 3× · last Aug 12, 2026, 9:00 AM" — the owner's evidence the link
 * actually landed (claim_count / last_claimed_at, 082).
 *
 * `null` when the member has never opened it, and the caller renders NOTHING
 * rather than "0×": a cart built an hour ago and a cart ignored for a fortnight
 * both read zero, and a printed zero invites the owner to read the second into
 * the first.
 */
export function opensNote(cart: {
  claim_count?: number | null;
  last_claimed_at?: string | null;
  claimed_at?: string | null;
}): string | null {
  if (!cart.claim_count) return null;
  const last = cart.last_claimed_at ?? cart.claimed_at ?? null;
  return `opened ${cart.claim_count}×${last ? ` · last ${stampLabel(last)}` : ''}`;
}
