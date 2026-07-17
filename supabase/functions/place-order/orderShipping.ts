/**
 * Shipping authority for place-order (owner's rule) — EVERY signed-in member
 * ships free; guests pay one flat fee. The charge is derived from the VERIFIED
 * session (stampedUserId), never from anything the client sends, so a guest
 * can't waive their own shipping.
 *
 * Deliberately free of Deno globals (like priceCheck.ts) so vitest can pin it.
 * This is the server authority; src/lib/shipping.ts is the client DISPLAY
 * mirror — keep GUEST_SHIPPING_CENTS in sync between the two.
 */

/** Flat shipping charged to guests (no account). Members pay $0. */
export const GUEST_SHIPPING_CENTS = 999;

/** What this buyer pays for shipping: members free, guests the flat fee. */
export function shippingCentsFor(isMember: boolean): number {
  return isMember ? 0 : GUEST_SHIPPING_CENTS;
}
