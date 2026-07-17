/**
 * Regression suite for the reward-voucher TOCTOU double-spend
 * (pro review 2026-07-17 #1, fixed by migration 064 + place-order claim-first).
 *
 * The old code read the voucher `active` early and consumed it at the end with
 * a filtered update whose result was checked for a DB error but never for zero
 * rows matched — so two concurrent checkouts could each keep the 40% reduction
 * off one voucher. The fix routes every consume through the atomic
 * consume_reward_voucher RPC and rolls the reward off the order when the claim
 * loses the race.
 *
 * These tests drive claimRewardVoucher against a fake RPC that reproduces the
 * DB's guarded-UPDATE semantics (the active→used flip is a single atomic
 * check-and-set, exactly what `UPDATE … WHERE status='active' RETURNING`
 * guarantees under row locking) and prove: of N concurrent claims exactly one
 * succeeds, the losers fail closed, and the pricing rollback removes exactly
 * the reward from the order.
 */
import { describe, expect, test } from 'vitest';
import {
  claimRewardVoucher,
  rollbackRewardPricing,
  type VoucherRpcClient,
} from '../../supabase/functions/place-order/rewardVoucher';

/**
 * In-memory reward_vouchers row + consume_reward_voucher RPC with the
 * migration-064 semantics. The status check-and-flip is synchronous inside the
 * async call — atomic, exactly like the single guarded UPDATE the DB runs —
 * while the surrounding await points let callers genuinely interleave.
 */
function makeFakeVoucherDb(initialStatus: 'active' | 'used' | 'void' = 'active') {
  const row = { status: initialStatus, orderId: null as string | null, consumeCalls: 0 };
  const client: VoucherRpcClient = {
    async rpc(fn, args) {
      if (fn !== 'consume_reward_voucher') {
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      }
      // Yield first so concurrent callers all start before any consume lands —
      // the interleaving the old read-then-update code lost the race to.
      await Promise.resolve();
      row.consumeCalls += 1;
      if (row.status !== 'active') {
        return { data: { ok: false, reason: 'not_active' }, error: null };
      }
      row.status = 'used';
      row.orderId = String(args.p_order_id);
      return { data: { ok: true, voucher_id: args.p_voucher_id }, error: null };
    },
  };
  return { row, client };
}

describe('claimRewardVoucher — atomic consume', () => {
  test('single claim on an active voucher succeeds', async () => {
    const { row, client } = makeFakeVoucherDb();
    const res = await claimRewardVoucher(client, 'v-1', 'order-1');
    expect(res).toEqual({ claimed: true, reason: null });
    expect(row.status).toBe('used');
    expect(row.orderId).toBe('order-1');
  });

  test('two concurrent checkouts: exactly one claim wins, the other provably fails', async () => {
    const { row, client } = makeFakeVoucherDb();
    // Both tabs read the voucher "active", both submit — the double-spend setup.
    const [tabA, tabB] = await Promise.all([
      claimRewardVoucher(client, 'v-1', 'order-A'),
      claimRewardVoucher(client, 'v-1', 'order-B'),
    ]);
    const winners = [tabA, tabB].filter((r) => r.claimed);
    const losers = [tabA, tabB].filter((r) => !r.claimed);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason).toBe('not_active');
    // Both attempts reached the DB — the second was refused, not skipped.
    expect(row.consumeCalls).toBe(2);
    expect(row.status).toBe('used');
  });

  test('N-way race: one voucher can never be consumed more than once', async () => {
    const { row, client } = makeFakeVoucherDb();
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => claimRewardVoucher(client, 'v-1', `order-${i}`)),
    );
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed)).toHaveLength(24);
    expect(row.status).toBe('used');
  });

  test('already-used voucher fails closed', async () => {
    const { client } = makeFakeVoucherDb('used');
    const res = await claimRewardVoucher(client, 'v-1', 'order-1');
    expect(res).toEqual({ claimed: false, reason: 'not_active' });
  });

  test('RPC error fails closed (no discount on a DB failure)', async () => {
    const client: VoucherRpcClient = {
      async rpc() {
        return { data: null, error: { message: 'connection reset' } };
      },
    };
    const res = await claimRewardVoucher(client, 'v-1', 'order-1');
    expect(res).toEqual({ claimed: false, reason: 'connection reset' });
  });

  test('RPC throw fails closed', async () => {
    const client: VoucherRpcClient = {
      rpc() {
        throw new Error('network down');
      },
    };
    const res = await claimRewardVoucher(client, 'v-1', 'order-1');
    expect(res).toEqual({ claimed: false, reason: 'network down' });
  });

  test('malformed RPC payload fails closed', async () => {
    const client: VoucherRpcClient = {
      async rpc() {
        return { data: { unexpected: true }, error: null };
      },
    };
    const res = await claimRewardVoucher(client, 'v-1', 'order-1');
    expect(res.claimed).toBe(false);
    expect(res.reason).toBe('not_claimed');
  });
});

describe('rollbackRewardPricing — losing checkout gives the discount back', () => {
  test('removes exactly the reward reduction, keeps other discounts', () => {
    const rolled = rollbackRewardPricing({
      grossSubtotalCents: 20_000,
      shippingCents: 999,
      discountCents: 5_000, // 3_000 reward + 2_000 from a code
      rewardReduction: 3_000,
      appliedCoupon: 'ACCT-LIFETIME, REWARD, SAVE10',
      rewardCode: 'REWARD',
    });
    expect(rolled.discountCents).toBe(2_000);
    expect(rolled.totalCents).toBe(20_000 - 2_000 + 999);
    expect(rolled.appliedCoupon).toBe('ACCT-LIFETIME, SAVE10');
  });

  test('reward-only order returns to full price with no coupon label', () => {
    const rolled = rollbackRewardPricing({
      grossSubtotalCents: 12_000,
      shippingCents: 0,
      discountCents: 4_800,
      rewardReduction: 4_800,
      appliedCoupon: 'REWARD',
      rewardCode: 'REWARD',
    });
    expect(rolled.discountCents).toBe(0);
    expect(rolled.totalCents).toBe(12_000);
    expect(rolled.appliedCoupon).toBeNull();
  });

  test('never produces a negative discount', () => {
    const rolled = rollbackRewardPricing({
      grossSubtotalCents: 10_000,
      shippingCents: 999,
      discountCents: 1_000,
      rewardReduction: 2_000, // inconsistent input — clamp, don't go negative
      appliedCoupon: 'REWARD',
      rewardCode: 'REWARD',
    });
    expect(rolled.discountCents).toBe(0);
    expect(rolled.totalCents).toBe(10_999);
  });

  test('null coupon label stays null', () => {
    const rolled = rollbackRewardPricing({
      grossSubtotalCents: 10_000,
      shippingCents: 999,
      discountCents: 4_000,
      rewardReduction: 4_000,
      appliedCoupon: null,
      rewardCode: 'REWARD',
    });
    expect(rolled.appliedCoupon).toBeNull();
    expect(rolled.totalCents).toBe(10_999);
  });

  test('end-to-end race shape: winner keeps the discount, loser is re-billed at full price', async () => {
    const { client } = makeFakeVoucherDb();
    const pricing = {
      grossSubtotalCents: 15_000,
      shippingCents: 0,
      discountCents: 6_000,
      rewardReduction: 6_000,
      appliedCoupon: 'REWARD',
      rewardCode: 'REWARD',
    };
    const [a, b] = await Promise.all([
      claimRewardVoucher(client, 'v-1', 'order-A'),
      claimRewardVoucher(client, 'v-1', 'order-B'),
    ]);
    const totals = [a, b].map((r) =>
      r.claimed
        ? pricing.grossSubtotalCents - pricing.discountCents
        : rollbackRewardPricing(pricing).totalCents,
    );
    // One order at 40%-off, one at full price — never two discounted orders.
    expect(totals.sort((x, y) => x - y)).toEqual([9_000, 15_000]);
  });
});
