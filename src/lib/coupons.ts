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
import type { CartItem } from '../types';
import { lineUnitCents } from './cartActions';

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
  requires_account?: boolean;
}

export type CouponCheckResult =
  | { ok: true; coupon: AppliedCoupon }
  | { ok: false; reason: string };

/** Combinability context for the add-time stacking check. Mirrors what
 *  place-order passes server-side; the server re-checks authoritatively. */
export interface CouponContext {
  /** Codes already applied to the cart (so a new code is gated against them). */
  appliedCodes?: string[];
  /** Signed-in member account discount is active. */
  hasAccount?: boolean;
  /** The 40% reward voucher is active for the signed-in user. */
  hasReward?: boolean;
  /** An automatic promo (B2G1) is active. Hard to know client-side — default
   *  false and let the server safety-net catch a promo-incompatible code. */
  hasPromo?: boolean;
}

/** Validate a code against the live backend for the current cart subtotal. */
export async function checkCoupon(
  code: string,
  subtotalCents: number,
  ctx: CouponContext = {},
): Promise<CouponCheckResult> {
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length < 3) return { ok: false, reason: 'Enter a code.' };
  if (!supabase) return { ok: false, reason: 'Promo codes are unavailable right now.' };

  const { data, error } = await supabase.rpc('validate_coupon', {
    p_code: trimmed,
    p_subtotal_cents: Math.max(Math.round(subtotalCents), 0),
    p_applied_codes: (ctx.appliedCodes ?? []).filter((c) => c.toUpperCase() !== trimmed),
    p_has_reward: ctx.hasReward ?? false,
    p_has_promo: ctx.hasPromo ?? false,
    p_has_account: ctx.hasAccount ?? false,
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
      requiresAccount: row.requires_account ?? false,
    },
  };
}

/** For a free_item coupon: the value of ONE matching line already in the cart,
 *  so applying the code makes that item free. Returns 0 when the item isn't in
 *  the cart — the server then adds it as a $0 line instead. Matches on SKU and,
 *  when the coupon names a dose, the line whose name carries that dose. */
export function freeItemLineValue(coupon: AppliedCoupon, items: CartItem[]): number {
  if (coupon.kind !== 'free_item' || !coupon.freeSku) return 0;
  const match = items.find(
    (i) =>
      i.product.sku === coupon.freeSku &&
      (!coupon.freeDose || (i.product.name ?? '').includes(coupon.freeDose)),
  );
  return match ? Math.max(lineUnitCents(match), 0) : 0;
}

/** A coupon can stop qualifying when the cart shrinks (e.g. the buyer removes
 *  the paid item a free_item code required). */
export function couponStillQualifies(coupon: AppliedCoupon | null, subtotalCents: number): boolean {
  if (!coupon) return true;
  return subtotalCents >= coupon.minSubtotalCents;
}

/** The signed-in customer's account entitlement (lifetime/business), resolved
 *  by src/lib/accountDiscount.ts. PREVIEW ONLY — place-order re-resolves it
 *  server-side via effective_customer_discount(); no percent from the client
 *  is ever billed. */
export interface AccountDiscountPreview {
  scope: 'lifetime' | 'business';
  percent: number;
  label: string;
}

export interface CouponBreakdown {
  /** code → discount cents attributed to that coupon (drives the cart line + invoice). */
  perCode: Record<string, number>;
  /** cents the account discount (pass 2a) takes off — 0 when none applies. */
  accountCents: number;
  /** sum of all discounts, capped at the subtotal so an order never goes < $0. */
  total: number;
}

/**
 * Compute the stacked discount with a COMPOUNDING order (this mirrors the
 * place-order server math exactly, so the cart preview equals what's billed):
 *   1. free_item + fixed codes reduce the base first. A free_item whose item is
 *      already in the cart contributes that item's price (it becomes free);
 *      otherwise the server adds it as a $0 line and it contributes nothing here.
 *   2a. the ACCOUNT discount (signed-in lifetime/business entitlement) applies
 *      first on the reduced base — same rule as recompute_order_totals (045).
 *   2b. percent codes then apply to the same reduced base; their running cap
 *      starts after the account slice.
 *   3. the grand total is capped at the subtotal.
 */
export function couponBreakdown(
  coupons: AppliedCoupon[],
  subtotalCents: number,
  items: CartItem[] = [],
  accountDiscount: AccountDiscountPreview | null = null,
): CouponBreakdown {
  const sub = Math.max(subtotalCents, 0);
  const perCode: Record<string, number> = {};
  const percentCoupons: AppliedCoupon[] = [];
  let flat = 0; // free_item line values + fixed amounts

  // Pass 1 — flat reductions (free_item, fixed).
  for (const c of coupons) {
    if (!couponStillQualifies(c, sub)) { perCode[c.code] = 0; continue; }
    if (c.kind === 'percent') { percentCoupons.push(c); continue; }
    let v = 0;
    if (c.kind === 'fixed' && c.amountCents != null) v = c.amountCents;
    else if (c.kind === 'free_item') v = freeItemLineValue(c, items);
    v = Math.max(Math.min(v, sub - flat), 0);
    perCode[c.code] = v;
    flat += v;
  }

  const baseAfterFlat = Math.max(sub - flat, 0);
  let percentUsed = 0;

  // Pass 2a — account discount first on the post-flat base.
  let accountCents = 0;
  if (accountDiscount && accountDiscount.percent > 0) {
    accountCents = Math.max(
      Math.min(Math.round((baseAfterFlat * accountDiscount.percent) / 100), baseAfterFlat),
      0,
    );
    percentUsed += accountCents;
  }

  // Pass 2b — percent codes on the same reduced base, capped after 2a.
  for (const c of percentCoupons) {
    const raw = c.percent != null ? Math.round((baseAfterFlat * c.percent) / 100) : 0;
    const v = Math.max(Math.min(raw, baseAfterFlat - percentUsed), 0);
    perCode[c.code] = v;
    percentUsed += v;
  }

  return { perCode, accountCents, total: Math.min(flat + percentUsed, sub) };
}

/** Codes to submit at checkout — only those still qualifying for the current
 *  subtotal, deduped, order preserved. */
export function submittableCouponCodes(coupons: AppliedCoupon[], subtotalCents: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of coupons) {
    if (!couponStillQualifies(c, subtotalCents)) continue;
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    out.push(c.code);
  }
  return out;
}
