/**
 * coupons — client-side promo-code helpers.
 *
 * The cart's "Apply" button calls the anon `validate_coupon` RPC (migration
 * 031) for a live check + preview. The snapshot lives in useCart as an
 * AppliedCoupon and drives the summary display in BOTH cart UIs (drawer +
 * /cart page — they must stay in sync).
 *
 * NOT authoritative for billing: place-order re-validates the code server-side
 * and computes the real discount there. The client only ever sends the code.
 */

import { supabase } from './supabase';
import type { AppliedCoupon } from '../hooks/useCart';

interface ValidateCouponRow {
  valid: boolean;
  reason?: string;
  code?: string;
  kind?: AppliedCoupon['kind'];
  percent?: number | null;
  amount_cents?: number | null;
  free_sku?: string | null;
  free_dose?: string | null;
  free_label?: string | null;
  discount_cents?: number;
  min_subtotal_cents?: number;
}

export type CouponCheckResult =
  | { ok: true; coupon: AppliedCoupon }
  | { ok: false; reason: string };

/** Validate a code against the live backend for the current cart subtotal. */
export async function checkCoupon(code: string, subtotalCents: number): Promise<CouponCheckResult> {
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length < 3) return { ok: false, reason: 'Enter a code.' };
  if (!supabase) return { ok: false, reason: 'Promo codes are unavailable right now.' };

  const { data, error } = await supabase.rpc('validate_coupon', {
    p_code: trimmed,
    p_subtotal_cents: Math.max(Math.round(subtotalCents), 0),
  });
  if (error) return { ok: false, reason: 'Could not check the code. Please try again.' };

  const row = data as ValidateCouponRow | null;
  if (!row?.valid) return { ok: false, reason: row?.reason ?? 'This code is not valid.' };
  if (!row.code || !row.kind) return { ok: false, reason: 'This code is not valid.' };

  return {
    ok: true,
    coupon: {
      code: row.code,
      kind: row.kind,
      percent: row.percent ?? null,
      amountCents: row.amount_cents ?? null,
      freeSku: row.free_sku ?? null,
      freeDose: row.free_dose ?? null,
      freeLabel: row.free_label ?? null,
      minSubtotalCents: row.min_subtotal_cents ?? 0,
    },
  };
}

/** Preview discount for the summary rows. free_item codes subtract nothing —
 *  their value is the free line the server adds to the order. */
export function couponDiscountCents(coupon: AppliedCoupon | null, subtotalCents: number): number {
  if (!coupon || subtotalCents <= 0) return 0;
  if (coupon.kind === 'percent' && coupon.percent != null) {
    return Math.min(Math.round((subtotalCents * coupon.percent) / 100), subtotalCents);
  }
  if (coupon.kind === 'fixed' && coupon.amountCents != null) {
    return Math.min(coupon.amountCents, subtotalCents);
  }
  return 0;
}

/** A coupon can stop qualifying when the cart shrinks (e.g. the buyer removes
 *  the paid item a free_item code required). */
export function couponStillQualifies(coupon: AppliedCoupon | null, subtotalCents: number): boolean {
  if (!coupon) return true;
  return subtotalCents >= coupon.minSubtotalCents;
}
