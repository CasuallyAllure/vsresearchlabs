/**
 * accountData — typed data-access wrappers for the customer portal
 * (`/account/*`).
 *
 * House style: plain supabase-js calls returning `{ data, error }`, with the
 * same null-supabase degradation as the rest of the app (`src/lib/supabase.ts`
 * exports `null` when the backend isn't configured — every wrapper here
 * mirrors that by returning an empty/`null` result with an error string
 * instead of throwing). RLS enforces ownership server-side, so none of these
 * queries need an explicit `user_id`/owner filter.
 *
 * `getMyOrder`, `getMyRewardSummary`, and `listMyDiscounts` depend on RPCs/
 * tables (`get_my_order`, `get_my_reward_summary`, `customer_discounts`)
 * shipped by a parallel backend workstream (migrations 043–045) and may not
 * exist yet in this environment. A missing function/table surfaces as a
 * normal Postgrest error here — callers render it as an error state, never a
 * crash.
 */

import { supabase } from './supabase';
import type { OrderInvoice } from './tracking';

/** One row of the owned-order history list (`/account/orders`). */
export interface MyOrderRow {
  order_number: string;
  status: string;
  created_at: string;
  invoice_amount_cents: number | null;
  carrier: string | null;
  tracking_number: string | null;
}

/** `get_my_order` RPC result — same shape as `get_order_by_token`, plus `found`. */
export type MyOrderResult = { found: false } | (OrderInvoice & { found: true });

export type RewardEntryKind = 'earn' | 'reversal' | 'adjustment' | 'redemption';

export interface RewardLedgerEntry {
  id: string;
  kind: RewardEntryKind;
  /** Signed — positive for earn, negative for reversal/redemption, either sign for a manual adjustment. */
  points: number;
  note: string | null;
  order_number: string | null;
  created_at: string;
}

/** An active or historical redeemed reward voucher (migration 050). */
export interface RewardVoucher {
  id: string;
  percent: number;
  created_at: string;
}

export interface RewardSummary {
  balance: number;
  threshold: number;
  percent: number;
  reward_ready: boolean;
  /** The customer's single active (unused) voucher, if any — at most one at a time. */
  active_voucher: RewardVoucher | null;
  entries: RewardLedgerEntry[];
}

/** `redeem_reward()` RPC result. */
export interface RedeemRewardResult {
  ok: boolean;
  reason?: string;
  voucher_id?: string;
  percent?: number;
}

export type CustomerDiscountScope = 'lifetime' | 'business';

export interface CustomerDiscountRow {
  id: string;
  scope: CustomerDiscountScope;
  percent: number;
  label: string;
  active: boolean;
  starts_at: string | null;
  expires_at: string | null;
}

const NOT_CONFIGURED = 'Backend not configured.';

/** All orders owned by the signed-in customer (RLS-scoped), newest first. */
export async function listMyOrders(): Promise<{ data: MyOrderRow[]; error: string | null }> {
  if (!supabase) return { data: [], error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('orders')
    .select('order_number, status, created_at, invoice_amount_cents, carrier, tracking_number')
    .order('created_at', { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as MyOrderRow[]) ?? [], error: null };
}

/** One order's full detail, scoped to the signed-in customer. */
export async function getMyOrder(
  orderNumber: string,
): Promise<{ data: MyOrderResult | null; error: string | null }> {
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc('get_my_order', { p_order_number: orderNumber });
  if (error) return { data: null, error: error.message };
  return { data: (data as MyOrderResult) ?? { found: false }, error: null };
}

/** Reward point balance + full ledger for the signed-in customer. */
export async function getMyRewardSummary(): Promise<{ data: RewardSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc('get_my_reward_summary');
  if (error) return { data: null, error: error.message };
  return {
    data: (data as RewardSummary) ?? {
      balance: 0,
      threshold: 300,
      percent: 40,
      reward_ready: false,
      active_voucher: null,
      entries: [],
    },
    error: null,
  };
}

/** Spend 300 points for a 40%-off-one-item voucher (`redeem_reward()`, migration 050). */
export async function redeemReward(): Promise<{ data: RedeemRewardResult | null; error: string | null }> {
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc('redeem_reward');
  if (error) return { data: null, error: error.message };
  return { data: (data as RedeemRewardResult) ?? { ok: false, reason: 'Unexpected response.' }, error: null };
}

/** `get_my_referral_code()` RPC result (migration 076). */
export interface ReferralCodeResult {
  code: string;
  percent: number;
  /** Redemptions recorded against the code, excluding the member's own contact. */
  uses: number;
}

/** Issue-or-fetch the member's referral code (`get_my_referral_code()`, migration 076). Idempotent. */
export async function getMyReferralCode(): Promise<{ data: ReferralCodeResult | null; error: string | null }> {
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc('get_my_referral_code');
  if (error) return { data: null, error: error.message };
  return { data: (data as ReferralCodeResult) ?? null, error: null };
}

/** The signed-in customer's own discount rules (active + inactive). */
export async function listMyDiscounts(): Promise<{ data: CustomerDiscountRow[]; error: string | null }> {
  if (!supabase) return { data: [], error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from('customer_discounts')
    .select('id, scope, percent, label, active, starts_at, expires_at')
    .order('starts_at', { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as CustomerDiscountRow[]) ?? [], error: null };
}
