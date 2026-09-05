/**
 * preparedCartReview — what the member will actually pay for a cart the owner
 * has built but not yet sent.
 *
 * THE HOLE THIS FILLS. The composer quoted the standing account rate and
 * nothing else, so the owner priced real client carts blind to the other two
 * discounts that reach them: the one-off coupon he typed into the form, and the
 * member's reward voucher, whose only controls lived a screen later in
 * ConvertToOrderForm. His words: "Once I press build a cart, it should show the
 * summary first instead of build-and-send. So I could see the summary. That
 * should activate and trigger all discounts to actually be put on."
 *
 * NOTHING NEW IS DECIDED HERE. Every rule is borrowed from the code that
 * already owns it:
 *   • the lines and the account rate  → `priceLines` (preparedCart.ts), the
 *     same call the composer, the list row and the opened detail all make.
 *   • which line the voucher lands on → `rewardCreditPreview` (cartActions.ts),
 *     itself the mirror of place-order's rule in orderTotals.ts: the single
 *     highest UNIT price in the cart, ties to the first line seen.
 *   • the items that rule reads      → `planPreparedCart` + `variantProduct`,
 *     i.e. the very cart the member's claim builds (AccountPreparedCart.tsx:
 *     164-183). Reading anything else here would let the voucher pick one line
 *     on this screen and a different one at their checkout.
 *
 * THE ONE PIECE OF ARITHMETIC, and why it is not subtraction. Migration 052
 * FENCES the reward item: its remaining (100−r)% is off-limits to every percent
 * discount, so the same money is never discounted twice (orderTotals.ts's
 * `rewardRemainder`, `convertTotals`'s `fenceCents`, and recompute_order_totals
 * all say it). `priceLines` has already taken the account rate off that unit, so
 * it is added back before the credit is subtracted. Quoting
 * `memberTotal − credit` instead would price the cart LOW by about
 * (unit × accountRate) — $22.50 on a $250 unit at 15% — which is exactly the
 * kind of figure the owner would only discover on the invoice.
 *
 * A PREVIEW, AND THE SCREEN SAYS SO. This is display-only; place-order remains
 * the only figure that bills, and it can still differ in ways no client can
 * know:
 *   • a coupon's value — only the CODE travels (081), validate_coupon resolves
 *     it server-side, so nothing here can price it;
 *   • B2G1, wholesale packs and the paired bundle REPLACE the account rate
 *     rather than stacking with it;
 *   • a per-product member rate (087) that `priceLines` does not model;
 *   • a voucher the member spends elsewhere before they claim this cart.
 */

import type { Product } from '../types';
import { rewardCreditPreview, variantProduct } from './cartActions';
import {
  planPreparedCart, priceLines,
  type PreparedCartLine, type PreparedCartPricing, type VariantIndex,
} from './preparedCart';

export interface PreparedCartReviewTotals {
  /** The lines at this member's own rate — `priceLines`' answer, unchanged. */
  pricing: PreparedCartPricing;
  /** The line the voucher lands on and the credit it is worth, or null when the
   *  member holds no voucher (or the cart has nothing for it to sit on). */
  reward: { name: string; cents: number } | null;
  /** The account discount that survives 052's fence. Equal to
   *  `pricing.savingsCents` whenever there is no reward. */
  accountCents: number;
  /** What the member pays at checkout. Shipping is free for account holders. */
  totalCents: number;
}

/** The cart the member's claim will actually build, so the voucher's choice of
 *  line here is the choice it will make there. */
function claimItems(lines: PreparedCartLine[], products: Product[]): Array<{ product: Product }> {
  return planPreparedCart(lines, products).addable.map((item) => ({
    product: variantProduct(item.product, item.dose),
  }));
}

export function reviewPreparedCart(input: {
  lines: PreparedCartLine[];
  index: VariantIndex;
  products: Product[];
  /** The member's own effective rate, from `MemberRow.effectivePercent`. */
  accountPercent: number;
  /** The percent of the member's ACTIVE reward voucher; null when they hold
   *  none, or when the voucher read has not come back yet. */
  voucherPercent: number | null;
}): PreparedCartReviewTotals {
  const { lines, index, products, accountPercent, voucherPercent } = input;
  const pricing = priceLines(lines, index, accountPercent);

  const percent = voucherPercent != null && voucherPercent > 0 ? voucherPercent : null;
  const reward = percent ? rewardCreditPreview(claimItems(lines, products), percent) : null;
  if (!percent || !reward) {
    return { pricing, reward: null, accountCents: pricing.savingsCents, totalCents: pricing.memberTotalCents };
  }

  // The fenced unit, reconstructed from the credit the way `convertTotals`
  // does it: credit = round(unit × percent / 100), so the unit is the credit
  // plus its own untouchable remainder.
  const unitCents = reward.cents + Math.round((reward.cents * (100 - percent)) / percent);
  const accountCents = Math.max(pricing.savingsCents - Math.round((unitCents * accountPercent) / 100), 0);

  return {
    pricing,
    reward,
    accountCents,
    totalCents: Math.max(pricing.listTotalCents - accountCents - reward.cents, 0),
  };
}
