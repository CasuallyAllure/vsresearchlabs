/**
 * shipping — the flat guest shipping fee and the member waiver.
 *
 * The owner's rule: EVERY signed-in member ships free (the perk the member
 * gate advertises — "no minimums, no codes"); guests pay one flat fee.
 *
 * Client-side this module only powers DISPLAY (the cart's shipping row and the
 * "create a profile and we'll waive this" nudge). place-order independently
 * recomputes the charge from the VERIFIED session — a client can't waive its
 * own shipping by lying. Keep GUEST_SHIPPING_CENTS in sync with the constant
 * of the same name in supabase/functions/place-order/index.ts.
 *
 * Note: customer_profiles.free_shipping (migration 049) still exists as an
 * admin-granted override enforced in recompute_order_totals. Membership alone
 * is now sufficient, so that column is a belt-and-braces extra, not the gate.
 */

/** Flat shipping charged to guests (no account). Members pay $0. */
export const GUEST_SHIPPING_CENTS = 999;

/** What this buyer pays for shipping: members free, guests the flat fee. */
export function shippingCentsFor(isMember: boolean): number {
  return isMember ? 0 : GUEST_SHIPPING_CENTS;
}
