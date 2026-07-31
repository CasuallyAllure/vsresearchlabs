/**
 * promoOffers — the one list of offers the storefront is allowed to advertise.
 *
 * Both the header ticker and the cart's incentive panel read from here, so a
 * promo can never be live on one surface and stale on the other. Every entry
 * is derived from the SAME constants the cart and place-order price from
 * (memberPricing, shipping, wholesale, promoSettings, sameDayDelivery) — none
 * of the copy restates a number by hand.
 *
 * Two rules this module exists to enforce:
 *
 *   1. NEVER ADVERTISE A DEAD PROMO. B2G1 is admin-toggled and dated; it only
 *      appears while `isB2G1Active()` says it is live. promoSettings defaults
 *      to disabled until loaded, so the ticker under-promises during boot
 *      rather than flashing an offer that has ended.
 *
 *   2. NEVER IMPLY A STACK. B2G1 and the member percentage are mutually
 *      exclusive on a real order (larger wins, tie → B2G1) and any wholesale
 *      line suppresses both order-wide. `detail` states the exclusivity in the
 *      buyer's own words rather than letting four offers read as additive.
 *
 * DISPLAY ONLY — place-order re-resolves every one of these server-side.
 */

import { MEMBER_DISCOUNT_PERCENT, TIER_FLOOR_PERCENTS } from './memberPricing';
import { GUEST_SHIPPING_CENTS } from './shipping';
import { WHOLESALE_PACKS } from './wholesale';
import { isB2G1Active, b2g1EndsLabel } from './promoSettings';
import { B2G1_GROUP } from './b2g1Preview';
import { SAME_DAY_MINIMUM_CENTS, SAME_DAY_ZONES } from './sameDayDelivery';

export type PromoOfferId =
  | 'member-discount'
  | 'member-shipping'
  | 'b2g1'
  | 'wholesale'
  | 'same-day';

export interface PromoOffer {
  id: PromoOfferId;
  /** Ticker text. Short — this scrolls past. */
  label: string;
  /** Popover heading. */
  title: string;
  /** Popover body. States terms and exclusivity, never just hype. */
  detail: string;
  /** True when the buyer already has this (member perks once signed in).
   *  The ticker phrases these as active rather than as an invitation. */
  held: boolean;
}

export interface PromoAudience {
  /** Signed-in account holder. Drives "you get" vs "create an account". */
  isMember: boolean;
  /** customer_profiles.tier, when known. 'pro' floors at 20% (074). */
  tier?: string | null;
}

const dollars = (cents: number): string =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

// Both packs are module constants in wholesale.ts — asserted, not guarded, the
// same way b2g1Preview.ts resolves them. A missing pack is a build-time bug,
// not a runtime state worth branching on.
const CASE_PACK = WHOLESALE_PACKS.find((p) => p.key === 'case')!;
const HALF_PACK = WHOLESALE_PACKS.find((p) => p.key === 'half')!;

/** The percentage THIS buyer actually receives. Guests are quoted the entry
 *  offer (what a new account gets), never a tier they do not hold. */
export function memberPercentFor(audience: PromoAudience): number {
  if (audience.isMember && audience.tier === 'pro') return TIER_FLOOR_PERCENTS.pro;
  if (audience.isMember) return TIER_FLOOR_PERCENTS.member;
  return MEMBER_DISCOUNT_PERCENT;
}

function memberDiscountOffer(audience: PromoAudience): PromoOffer {
  const percent = memberPercentFor(audience);
  return {
    id: 'member-discount',
    label: audience.isMember
      ? `Your member pricing — ${percent}% off`
      : `Member pricing — ${percent}% off`,
    title: `${percent}% off, applied automatically`,
    detail: audience.isMember
      ? `Every order on your account comes off at ${percent}% — no code to enter. It is applied at checkout, and it does not stack with the buy-${B2G1_GROUP - 1}-get-1 term or wholesale pack pricing: whichever is worth more to you is the one that bills.`
      : `Create an account and ${percent}% comes off every order automatically — no code, no minimum. It does not stack with the buy-${B2G1_GROUP - 1}-get-1 term or wholesale pricing; whichever is worth more is the one that bills.`,
    held: audience.isMember,
  };
}

function memberShippingOffer(audience: PromoAudience): PromoOffer {
  return {
    id: 'member-shipping',
    label: audience.isMember ? 'Your orders ship free' : 'Free shipping for members',
    title: 'Free shipping on every member order',
    detail: audience.isMember
      ? 'Shipping is waived on your orders — no minimums, no codes.'
      : `Guests pay a flat ${dollars(GUEST_SHIPPING_CENTS)}. Account holders ship free on every order — no minimums, no codes.`,
    held: audience.isMember,
  };
}

function b2g1Offer(): PromoOffer {
  const ends = b2g1EndsLabel().trim();
  return {
    id: 'b2g1',
    label: `Buy ${B2G1_GROUP - 1}, get 1 free`,
    title: `Order ${B2G1_GROUP}, pay for ${B2G1_GROUP - 1}`,
    detail:
      `Order ${B2G1_GROUP} units of an item and the third is supplied at no charge, applied at checkout. ` +
      `Standard 7–10 business day items only — items shipping in 24 hours are not part of the term. ` +
      `It does not combine with the member percentage; the larger of the two bills.` +
      (ends ? ` ${ends}` : ''),
    held: false,
  };
}

function wholesaleOffer(audience: PromoAudience): PromoOffer {
  const { percent: casePct, size: caseSize } = CASE_PACK;
  const { percent: halfPct, size: halfSize } = HALF_PACK;
  return {
    id: 'wholesale',
    label: `Wholesale — full case ${casePct}% off`,
    title: 'Case pricing, open to every industry',
    detail:
      `A full case (${caseSize} vials) comes off at ${casePct}%, a half kit (${halfSize} vials) at ${halfPct}% — ` +
      `applied automatically at checkout for account holders. Wholesale is a final price: it outranks ` +
      `the member percentage and the buy-${B2G1_GROUP - 1}-get-1 term. Pack orders ship in 7–10 business days.` +
      (audience.isMember ? '' : ' Requires an account.'),
    held: false,
  };
}

function sameDayOffer(): PromoOffer {
  return {
    id: 'same-day',
    label: `Same-day delivery over ${dollars(SAME_DAY_MINIMUM_CENTS)} in the Bay Area`,
    title: 'Same- to next-day delivery, Bay Area',
    detail:
      `Orders over ${dollars(SAME_DAY_MINIMUM_CENTS)} delivering to ${SAME_DAY_ZONES.join(', ')} ` +
      `qualify for same- to next-day delivery. Wholesale case orders are excluded. Everywhere else, ` +
      `in-stock 24 Hour items still ship within 24 hours and standard items in 7–10 business days.`,
    held: false,
  };
}

/**
 * The offers that are genuinely live for this buyer, in the order they should
 * be shown. B2G1 is included only while the admin promo is actually running,
 * so an ended term drops out of the ticker on its own.
 */
export function activeOffers(
  audience: PromoAudience,
  /** Whether the B2G1 term is live. Defaults to reading the promo store, but a
   *  subscribed component should pass what it subscribed to so the list
   *  recomputes when the promo loads in. */
  b2g1Live: boolean = isB2G1Active(),
): PromoOffer[] {
  const offers: PromoOffer[] = [memberDiscountOffer(audience), memberShippingOffer(audience)];
  if (b2g1Live) offers.push(b2g1Offer());
  offers.push(wholesaleOffer(audience), sameDayOffer());
  return offers;
}

/** Route prefixes the ticker is allowed on: the surfaces where a buyer is
 *  actually shopping. Deliberately excludes the landing page (its entrance
 *  sequence and intro modal own that first screen), the research library
 *  (education, not commerce), share links, admin and account. */
const PROMO_SURFACES = [
  '/research-supplies',
  '/laboratory-equipment',
  '/catalog',
  '/product',
  '/cart',
];

/** Should the ticker render on this path? */
export function isPromoSurface(pathname: string): boolean {
  if (typeof pathname !== 'string' || pathname === '') return false;
  return PROMO_SURFACES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Stable key for the CURRENT set of live offers. The ticker remembers a
 * dismissal against this key, so hiding the bar sticks — but a genuinely new
 * promo (B2G1 switching on, a tier change) produces a new key and the bar
 * returns once. Dismissing is not a permanent opt-out of all future offers.
 */
export function offersSignature(offers: ReadonlyArray<PromoOffer>): string {
  return offers.map((o) => `${o.id}:${o.held ? 1 : 0}`).join('|');
}
