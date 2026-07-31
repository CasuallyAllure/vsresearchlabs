/**
 * sameDayDelivery — the Bay Area same-/next-day delivery term.
 *
 * The zones and the $300 floor were previously inlined in
 * SameDayDeliveryBadge. They are shared now because the cart's incentive
 * panel counts a buyer UP to the same floor ("add $42 more"), and two copies
 * of a dollar threshold is exactly how a storefront starts quoting two
 * different offers on two surfaces.
 *
 * DISPLAY ONLY. Nothing here is billed — same-day is a fulfilment promise the
 * owner honours manually per order, not a line item place-order computes. The
 * cart panel must therefore never state it as a guarantee, only as the term
 * ("orders over $300 in these zones qualify").
 */

/** Minimum order for the same-day term, in cents. Wholesale is excluded. */
export const SAME_DAY_MINIMUM_CENTS = 30_000;

/** Bay Area zones the owner delivers to. Order is display order. */
export const SAME_DAY_ZONES: readonly string[] = [
  'Benicia, CA',
  'American Canyon, CA',
  'Vallejo, CA',
  'Fairfield, CA',
  'Napa, CA',
  'Hercules, CA',
  'Pinole, CA',
];

/** Cents still needed to reach the same-day floor; 0 once the cart is there.
 *  Never negative, so callers can render it unguarded. */
export function centsToSameDay(subtotalCents: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
    return SAME_DAY_MINIMUM_CENTS;
  }
  return Math.max(0, SAME_DAY_MINIMUM_CENTS - Math.round(subtotalCents));
}

/** How far the cart has come toward the same-day floor, clamped to 0..1.
 *  Drives the panel's progress rail. */
export function sameDayProgress(subtotalCents: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return Math.min(1, Math.round(subtotalCents) / SAME_DAY_MINIMUM_CENTS);
}
