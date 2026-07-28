/**
 * memberPricing — the single source of truth for the DISPLAY of an
 * account-holder's automatic member price in the catalog UI.
 *
 * DISPLAY ONLY. Nothing here changes what a buyer is charged. The real
 * entitlement is resolved and applied server-side in place-order
 * (orderTotals.ts::computeOrderTotals, migration 074 effective_customer_discount);
 * this module only mirrors that math so a card can show the member price the
 * checkout will actually bill.
 *
 * PARITY IS THE POINT. `memberPriceCents` uses the exact rounding the checkout
 * uses for the account slice — discount = round(base × percent / 100), member =
 * base − discount — the same `Math.round((percentBase * accountPercent) / 100)`
 * as orderTotals.ts and src/lib/coupons.ts::couponBreakdown (pass 2a). A single
 * unit at quantity 1 is exactly what the server charges that unit; per-unit and
 * whole-cart rounding can differ by at most a cent at higher quantities, and the
 * card price is a per-unit figure, so the per-unit member price is the honest
 * number to show. tests/unit/memberPricing.test.ts pins this against the real
 * server engine.
 *
 * ELIGIBILITY mirrors the "excludes bundles & wholesale" rule the buyer already
 * sees. The only real exclusions are pricing MODES, not products: wholesale
 * volume pricing and the Retatrutide + GHK-Cu paired bundle are fenced off from
 * the account percent server-side (they apply as FLAT reductions before the
 * account slice — orderTotals.ts), and those surfaces are excluded structurally
 * by simply not rendering <MemberPrice> in WholesaleTile / BundleOfferTile.
 * Every standalone catalog line — single compounds AND multi-compound blends
 * (GLOW etc.) — genuinely receives the 15% at checkout, so `isMemberPriceEligible`
 * is true for them all. (Blends were briefly hidden as a conservative reading of
 * "bundles"; the owner confirmed the blend IS eligible and should show its
 * member price like every other product — 2026-07-23.)
 */

import type { Product } from '../types/product';

/** Tier-aware automatic discount floors (migration 074): the base 'member'
 *  tier keeps the 15% floor from 069; the paid 'pro' tier is floored at 20%.
 *  The single client source of tier floors — src/lib/accountDiscount.ts
 *  derives its cart-preview floor from this map. Kept in lockstep with the
 *  server's effective_customer_discount(). */
export const TIER_FLOOR_PERCENTS = { member: 15, pro: 20 } as const;

export type TierKey = keyof typeof TIER_FLOOR_PERCENTS;

/** The GUEST-FACING catalog "Members $X" chip rate. Deliberately stays at the
 *  base member 15% even though Pro floors at 20% (074): the chip is the join
 *  incentive shown to shoppers who don't have an account yet, so it advertises
 *  the entry offer every new account actually receives. Pro is an upgrade on
 *  top, not the advertised entry offer — a signed-in Pro's real rate is
 *  resolved server-side at checkout regardless. */
export const MEMBER_DISCOUNT_PERCENT = 15;

/**
 * The member (account-holder) price for a base price, in cents, using the SAME
 * rounding rule the checkout applies to the account slice. Returns null when the
 * base is null or non-positive so callers can skip the display entirely.
 */
export function memberPriceCents(baseCents: number | null): number | null {
  if (baseCents == null || !Number.isFinite(baseCents) || baseCents <= 0) return null;
  const discount = Math.round((baseCents * MEMBER_DISCOUNT_PERCENT) / 100);
  return Math.max(baseCents - discount, 0);
}

/**
 * Whether a product should advertise a member price. Every standalone catalog
 * line receives the automatic 15% at checkout — single compounds and blends
 * alike — so all are eligible. The only exclusions are pricing MODES (wholesale
 * packs, the Reta+GHK paired bundle), excluded at their render sites by not
 * rendering <MemberPrice> there, not per-product here. The `_product` param is
 * kept so callers stay uniform and a real per-product carve-out can land here if
 * one ever exists.
 */
export function isMemberPriceEligible(_product: Product): boolean {
  return true;
}
