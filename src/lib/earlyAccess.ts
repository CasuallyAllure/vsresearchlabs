/**
 * earlyAccess — member-first visibility window for tagged catalog products.
 *
 * A product tagged 'early-access' is shown to everyone but ORDERABLE only by
 * signed-in account holders while the tag is present. Remove the tag to open
 * the product to guests — a data edit, no code change.
 *
 * Ships dark: no product carries the tag today; tagging is an owner action in
 * the product data (same mechanism as the 'blend' tag).
 *
 * Enforcement posture (documented, deliberate): this is a MERCHANDISING
 * window, not a price or security control. The client hides the order
 * controls from guests; the backstop is the existing human order flow —
 * every order is reviewed and invoiced by the admin before payment, so a
 * hand-crafted guest order for an early-access item is caught there. No
 * place-order (money-path) change is made for this.
 */

import type { Product } from '../types/product';

export const EARLY_ACCESS_TAG = 'early-access';

/** Whether this product is currently in its member-first window. */
export function isEarlyAccessProduct(product: Product): boolean {
  return (product.tags ?? []).includes(EARLY_ACCESS_TAG);
}

/** Copy shown in place of the order control for signed-out visitors. */
export const EARLY_ACCESS_GUEST_LINE =
  'Member early access — sign in to order';
