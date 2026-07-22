/**
 * memberPricing — the single source of truth for the DISPLAY of an
 * account-holder's automatic member price in the catalog UI.
 *
 * DISPLAY ONLY. Nothing here changes what a buyer is charged. The real
 * entitlement is resolved and applied server-side in place-order
 * (orderTotals.ts::computeOrderTotals, migration 069 effective_customer_discount);
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
 * sees. Wholesale volume pricing and the Retatrutide + GHK-Cu paired bundle are
 * fenced off from the account percent server-side (they apply as FLAT reductions
 * before the account slice — orderTotals.ts), and those surfaces are excluded
 * structurally by simply not rendering <MemberPrice> in WholesaleTile /
 * BundleOfferTile. `isMemberPriceEligible` additionally excludes multi-compound
 * BLEND products (the GLOW family), which are merchandised as bundles — so a
 * blend never advertises a member price. Showing NO member price is never
 * misleading; it only declines to advertise. Every product that DOES show one
 * (single compounds) genuinely receives exactly that price at checkout.
 */

import type { Product } from '../types/product';

/** Every confirmed account holder's automatic member discount (migration 069).
 *  Kept in lockstep with ACCOUNT_FLOOR_PERCENT in src/lib/accountDiscount.ts and
 *  the server entitlement — this constant only labels/derives the DISPLAY. */
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
 * Whether a product should advertise a member price. Single compounds are
 * eligible; multi-compound blends (merchandised as bundles) are not. Wholesale
 * and the paired-bundle tile are excluded at the render site, not here.
 */
export function isMemberPriceEligible(product: Product): boolean {
  return !(product.tags ?? []).includes('blend');
}
