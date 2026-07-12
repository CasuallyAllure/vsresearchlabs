/**
 * lineDiscounts — allocates an order's coupon discounts across its line items
 * for display purposes only.
 *
 * Discounts are stored order-level / per-coupon (never per line) — the server
 * (`recompute_order_totals`, migration 037) computes each coupon's
 * `discount_cents` off the full line subtotal and sums them into
 * `orders.discount_cents`. That server total is authoritative. This helper
 * re-derives a per-line share at RENDER time only, proportional to each
 * line's retail subtotal, so invoices can show "was $X, now $Y" per line
 * while still footing exactly to the stored order discount.
 *
 * Duplicated (behaviorally identical) in
 * `supabase/functions/_shared/invoiceEmail.ts` because Deno edge functions
 * cannot import from `src/`.
 */

/** Minimal line shape needed to allocate a discount across order lines. */
export interface DiscountLine {
  quantity: number;
}

/** Minimal coupon shape needed to allocate a discount across order lines. */
export interface DiscountCoupon {
  kind: string;
  discount_cents: number;
}

/**
 * Returns cents of discount allocated to each line, in the same index order
 * as `lines`. `retailUnitCents[i]` must be the same retail unit price the
 * caller already renders for `lines[i]` (e.g. `unitOf(lines[i]) ?? 0`).
 *
 * Free-item coupons are skipped — they already show as their own $0 line.
 * Each remaining coupon's `discount_cents` is split across paid lines
 * (retail subtotal > 0) proportional to their retail subtotal; the last
 * paid line absorbs the rounding remainder so the sum of the returned
 * array always equals the sum of non-free coupons' `discount_cents`.
 */
export function allocateLineDiscounts(
  lines: readonly DiscountLine[],
  retailUnitCents: readonly number[],
  coupons: readonly DiscountCoupon[],
): number[] {
  const perLine = lines.map(() => 0);
  const base = lines.map((l, i) => (retailUnitCents[i] ?? 0) * l.quantity);

  for (const c of coupons) {
    if (c.kind === 'free_item') continue;
    const target = c.discount_cents;
    if (!target || target <= 0) continue;

    const paidIdx = base
      .map((b, i): [number, number] => [b, i])
      .filter(([b]) => b > 0)
      .map(([, i]) => i);
    const totalBase = paidIdx.reduce((s, i) => s + base[i], 0);
    if (totalBase <= 0) continue;

    let allocated = 0;
    paidIdx.forEach((i, k) => {
      if (k === paidIdx.length - 1) {
        perLine[i] += target - allocated;
      } else {
        const share = Math.round((target * base[i]) / totalBase);
        perLine[i] += share;
        allocated += share;
      }
    });
  }

  return perLine;
}
