/**
 * consume_reward_voucher (migration 064) against a REAL local Postgres.
 *
 * 064 exists because of a TOCTOU double-spend: two concurrent checkouts both
 * read one active voucher and both kept the 40% discount. The fix is a single
 * guarded UPDATE … WHERE status='active' RETURNING — and that is exactly what
 * mocks cannot prove. This suite drives the real row-lock semantics:
 *   • active → used flip stamps used_at + order_id;
 *   • a second (sequential) consume returns {ok:false, reason:'not_active'}
 *     and does NOT reassign the voucher;
 *   • two CONCURRENT consumers race for one voucher and exactly one wins;
 *   • void vouchers and missing args fail closed;
 *   • the RPC is service-role only (revoked from anon/authenticated in 064).
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('consume_reward_voucher suite');

interface ConsumeResult {
  ok: boolean;
  reason?: string;
  voucher_id?: string;
}

describe.skipIf(!canRun)('consume_reward_voucher (real DB, migration 064)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let userId = '';
  const orderIds: string[] = [];

  async function seedOrder(suffix: string): Promise<string> {
    const res = await service
      .from('orders')
      .insert({
        order_number: `ITEST-RV-${runId}-${suffix}`,
        buyer_name: 'Voucher Test Buyer',
        buyer_contact: `rv-${runId}@example.test`,
      })
      .select('id')
      .single();
    if (res.error || !res.data) throw new Error(`Failed to seed order: ${res.error?.message}`);
    orderIds.push(res.data.id as string);
    return res.data.id as string;
  }

  /** Vouchers require a real auth.users row (FK). One user, N vouchers —
   *  but only one may be 'active' at a time (050 partial unique), so tests
   *  consume each voucher before the next one is minted. */
  async function seedVoucher(status: 'active' | 'void' = 'active'): Promise<string> {
    const res = await service
      .from('reward_vouchers')
      .insert({ user_id: userId, percent: 40, points_spent: 300, status })
      .select('id')
      .single();
    if (res.error || !res.data) throw new Error(`Failed to seed voucher: ${res.error?.message}`);
    return res.data.id as string;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    const user = await service.auth.admin.createUser({
      email: `rv-user-${runId}@example.test`,
      password: `Rv-Test-${runId}!`,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(`Failed to create user: ${user.error?.message}`);
    userId = user.data.user.id;
  }, 30_000);

  afterAll(async () => {
    if (!canRun) return;
    if (orderIds.length) await service.from('orders').delete().in('id', orderIds);
    // Deleting the auth user cascades reward_vouchers (+ profile/ledger).
    if (userId) await service.auth.admin.deleteUser(userId);
  }, 30_000);

  test('anon cannot execute consume_reward_voucher (service-role only)', async () => {
    const res = await anon.rpc('consume_reward_voucher', {
      p_voucher_id: randomUUID(), p_order_id: randomUUID(),
    });
    expect(res.error).toBeTruthy();
  });

  test('missing args fail closed', async () => {
    const res = await service.rpc('consume_reward_voucher', {
      p_voucher_id: null, p_order_id: null,
    });
    expect(res.error).toBeNull();
    expect(res.data as ConsumeResult).toMatchObject({ ok: false, reason: 'missing_args' });
  });

  test('consume flips active → used, stamps used_at, and pins the order', async () => {
    const voucherId = await seedVoucher();
    const orderId = await seedOrder('FLIP');

    const res = await service.rpc('consume_reward_voucher', {
      p_voucher_id: voucherId, p_order_id: orderId,
    });
    expect(res.error).toBeNull();
    expect(res.data as ConsumeResult).toMatchObject({ ok: true, voucher_id: voucherId });

    const row = await service
      .from('reward_vouchers')
      .select('status, order_id, used_at')
      .eq('id', voucherId)
      .single();
    expect(row.data?.status).toBe('used');
    expect(row.data?.order_id).toBe(orderId);
    expect(row.data?.used_at).not.toBeNull();

    // Sequential double-spend: the second call loses and the voucher stays
    // pinned to the FIRST order.
    const otherOrder = await seedOrder('FLIP2');
    const again = await service.rpc('consume_reward_voucher', {
      p_voucher_id: voucherId, p_order_id: otherOrder,
    });
    expect(again.error).toBeNull();
    expect(again.data as ConsumeResult).toMatchObject({ ok: false, reason: 'not_active' });

    const after = await service.from('reward_vouchers').select('order_id').eq('id', voucherId).single();
    expect(after.data?.order_id).toBe(orderId);
  });

  test('two CONCURRENT consumers: exactly one wins the active→used flip', async () => {
    const voucherId = await seedVoucher();
    const orderA = await seedOrder('RACE-A');
    const orderB = await seedOrder('RACE-B');

    // Two independent clients → two PostgREST requests → two transactions
    // racing on the same row lock.
    const [resA, resB] = await Promise.all([
      serviceClient().rpc('consume_reward_voucher', { p_voucher_id: voucherId, p_order_id: orderA }),
      serviceClient().rpc('consume_reward_voucher', { p_voucher_id: voucherId, p_order_id: orderB }),
    ]);
    expect(resA.error).toBeNull();
    expect(resB.error).toBeNull();

    const outcomes = [resA.data as ConsumeResult, resB.data as ConsumeResult];
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason).toBe('not_active');

    // The voucher belongs to whichever order the winner named.
    const row = await service
      .from('reward_vouchers')
      .select('status, order_id')
      .eq('id', voucherId)
      .single();
    expect(row.data?.status).toBe('used');
    const winnerOrder = resA.data && (resA.data as ConsumeResult).ok ? orderA : orderB;
    expect(row.data?.order_id).toBe(winnerOrder);
  });

  test('a void voucher cannot be consumed', async () => {
    const voidId = await seedVoucher('void');
    const orderId = await seedOrder('VOID');

    const res = await service.rpc('consume_reward_voucher', {
      p_voucher_id: voidId, p_order_id: orderId,
    });
    expect(res.error).toBeNull();
    expect(res.data as ConsumeResult).toMatchObject({ ok: false, reason: 'not_active' });
  });
});
