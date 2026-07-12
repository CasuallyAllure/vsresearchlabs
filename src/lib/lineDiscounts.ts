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
  /** SKU — used to point a free_item coupon at its own line. */
  sku?: string;
}

/** Minimal coupon shape needed to allocate a discount across order lines. */
export interface DiscountCoupon {
  kind: string;
  discount_cents: number;
  /** free_item target SKU (optional — falls back to price match). */
  free_sku?: string | null;
}

/**
 * Returns cents of discount allocated to each line, in the same index order
 * as `lines`. `retailUnitCents[i]` must be the same retail unit price the
 * caller already renders for `lines[i]` (e.g. `unitOf(lines[i]) ?? 0`).
 *
 * Two passes, matching the compounding server math (recompute_order_totals /
 * place-order):
 *   1. A free_item coupon zeroes its OWN line — the whole discount lands on the
 *      matching line (by SKU, else a paid line whose price equals the coupon's
 *      discount) so it reads "$20 −$20 = $0 FREE", not smeared across the order.
 *   2. percent / fixed coupons then split across the REMAINING paid lines
 *      (those a free_item didn't already zero), proportional to retail subtotal;
 *      the last such line absorbs the rounding remainder so the array always
 *      foots to the sum of the coupons' `discount_cents`.
 */
export function allocateLineDiscounts(
  lines: readonly DiscountLine[],
  retailUnitCents: readonly number[],
  coupons: readonly DiscountCoupon[],
): number[] {
  const perLine = lines.map(() => 0);
  const base = lines.map((l, i) => (retailUnitCents[i] ?? 0) * l.quantity);
  const zeroed = lines.map(() => false);

  // Pass 1 — free_item coupons land entirely on their own line.
  for (const c of coupons) {
    if (c.kind !== 'free_item') continue;
    const target = c.discount_cents;
    if (!target || target <= 0) continue;
    let idx = -1;
    if (c.free_sku) {
      idx = base.findIndex((b, i) => b > 0 && !zeroed[i] && lines[i].sku === c.free_sku);
    }
    if (idx < 0) idx = base.findIndex((b, i) => b > 0 && !zeroed[i] && b === target);
    if (idx < 0) idx = base.findIndex((b, i) => b > 0 && !zeroed[i]);
    if (idx >= 0) {
      perLine[idx] += Math.min(target, base[idx] - perLine[idx]);
      zeroed[idx] = true;
    }
  }

  // Pass 2 — percent / fixed split across the lines a free_item didn't zero.
  for (const c of coupons) {
    if (c.kind === 'free_item') continue;
    const target = c.discount_cents;
    if (!target || target <= 0) continue;

    const paidIdx = base
      .map((b, i): [number, number] => [b, i])
      .filter(([b, i]) => b > 0 && !zeroed[i])
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
