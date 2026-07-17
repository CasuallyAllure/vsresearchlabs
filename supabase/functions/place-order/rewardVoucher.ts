/**
 * Reward-voucher consume + rollback helpers for place-order.
 *
 * Deliberately free of Deno globals and remote imports (like priceCheck.ts)
 * so vitest can drive the double-spend regression suite
 * (tests/unit/rewardVoucher.test.ts) and tsc can typecheck it.
 *
 * The atomicity itself lives in the DB — consume_reward_voucher (migration
 * 064) is one guarded `UPDATE … WHERE status='active' RETURNING`, so of N
 * concurrent claims exactly one wins. This module's job is the fail-closed
 * interpretation of that RPC's result (any error, throw, or non-ok payload
 * means NOT claimed) and the pure pricing rollback applied when the claim
 * loses the race.
 */

type RpcError = { message?: string } | null;

export interface VoucherRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError }>;
}

export interface VoucherClaimResult {
  claimed: boolean;
  reason: string | null;
}

/**
 * Atomically claim (consume) the voucher for this order. Fail-closed: the
 * caller may apply the reward reduction ONLY when `claimed` is true.
 */
export async function claimRewardVoucher(
  client: VoucherRpcClient,
  voucherId: string,
  orderId: string,
): Promise<VoucherClaimResult> {
  try {
    const { data, error } = await client.rpc("consume_reward_voucher", {
      p_voucher_id: voucherId,
      p_order_id: orderId,
    });
    if (error) return { claimed: false, reason: error.message ?? "rpc_error" };
    const res = data as { ok?: boolean; reason?: string } | null;
    if (res?.ok === true) return { claimed: true, reason: null };
    return { claimed: false, reason: res?.reason ?? "not_claimed" };
  } catch (e) {
    return { claimed: false, reason: e instanceof Error ? e.message : "rpc_threw" };
  }
}

export interface RewardRollbackInput {
  grossSubtotalCents: number;
  shippingCents: number;
  discountCents: number;
  rewardReduction: number;
  appliedCoupon: string | null;
  rewardCode: string;
}

export interface RewardRollbackResult {
  discountCents: number;
  totalCents: number;
  appliedCoupon: string | null;
}

/**
 * Remove exactly the reward reduction from the order's pricing after a lost
 * claim race, keeping every other discount intact. Pure — the caller persists
 * the result onto the orders row (mirroring the coupon-redemption rollback).
 */
export function rollbackRewardPricing(input: RewardRollbackInput): RewardRollbackResult {
  const discountCents = Math.max(input.discountCents - input.rewardReduction, 0);
  const totalCents = input.grossSubtotalCents - discountCents + input.shippingCents;
  const appliedCoupon = input.appliedCoupon
    ? (input.appliedCoupon
        .split(", ")
        .filter((code) => code !== input.rewardCode)
        .join(", ") || null)
    : null;
  return { discountCents, totalCents, appliedCoupon };
}
