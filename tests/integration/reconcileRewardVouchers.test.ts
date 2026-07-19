/**
 * reconcile_reward_vouchers (migration 067) against a REAL local Postgres.
 *
 * The reconcile edge function's plan logic is unit-tested; the SQL that
 * classifies crash-window states is not reachable from mocks. This suite
 * builds one order per state and proves the classifier + the single repair
 * path:
 *   • State B (voucher consumed, reward row missing, gap == voucher math):
 *     detect-only without p_repair; with p_repair the exact place-order
 *     reward row is re-inserted and orders.discount_cents is untouched;
 *   • uncorroborated gap (≠ voucher math ±1¢): never auto-labeled REWARD;
 *   • State C (voucher burned, no gap), State D (reward row without a
 *     consume), State A (gap with no voucher): detect only;
 *   • service-role only (revoked from anon/authenticated in 067).
 *
 * Assertions use toContain, never exact counts: the scan is global over the
 * last 60 days, so sibling suites' fixtures may appear alongside ours.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('reconcile_reward_vouchers suite');

interface ReconcileResult {
  ok: boolean;
  repaired: number;
  state_a: { order_ids: string[] };
  state_b: {
    repaired_order_ids: string[];
    repairable_order_ids: string[];
    uncorroborated_order_ids: string[];
  };
  state_c: { voucher_ids: string[] };
  state_d: { order_ids: string[] };
}

describe.skipIf(!canRun)('reconcile_reward_vouchers (real DB, migration 067)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let userId = '';

  let orderB = ''; // State B: repairable
  let orderUncorrob = ''; // voucher-linked gap that fails corroboration
  let orderC = ''; // State C carrier (voucher burned, no gap)
  let orderD = ''; // State D: reward row, no voucher
  let orderA = ''; // State A: gap, no voucher
  let voucherC = '';
  const orderIds: string[] = [];

  async function seedOrder(suffix: string, discountCents: number, unitPriceCents: number): Promise<string> {
    const order = await service
      .from('orders')
      .insert({
        order_number: `ITEST-RC-${runId}-${suffix}`,
        buyer_name: 'Reconcile Test Buyer',
        buyer_contact: `rc-${runId}@example.test`,
        subtotal_cents: unitPriceCents,
        shipping_cents: 0,
        discount_cents: discountCents,
        invoice_amount_cents: Math.max(unitPriceCents - discountCents, 0),
      })
      .select('id')
      .single();
    if (order.error || !order.data) throw new Error(`Failed to seed order ${suffix}: ${order.error?.message}`);
    const orderId = order.data.id as string;
    orderIds.push(orderId);

    const line = await service.from('order_lines').insert({
      order_id: orderId, sku: `RC-SKU-${runId}`, product_name: 'Reconcile Test Item',
      quantity: 1, unit_price_cents: unitPriceCents,
    });
    if (line.error) throw new Error(`Failed to seed line ${suffix}: ${line.error.message}`);
    return orderId;
  }

  async function seedUsedVoucher(orderId: string): Promise<string> {
    const res = await service
      .from('reward_vouchers')
      .insert({
        user_id: userId, percent: 40, points_spent: 300,
        status: 'used', order_id: orderId, used_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (res.error || !res.data) throw new Error(`Failed to seed voucher: ${res.error?.message}`);
    return res.data.id as string;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    const user = await service.auth.admin.createUser({
      email: `rc-user-${runId}@example.test`,
      password: `Rc-Test-${runId}!`,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(`Failed to create user: ${user.error?.message}`);
    userId = user.data.user.id;

    // State B: $100 item, voucher math = round(40% × 10,000) = 4,000 == gap.
    orderB = await seedOrder('B', 4000, 10_000);
    await seedUsedVoucher(orderB);

    // Uncorroborated: gap 999 ≠ 4,000 (±1¢) — must NOT be repaired.
    orderUncorrob = await seedOrder('UNC', 999, 10_000);
    await seedUsedVoucher(orderUncorrob);

    // State C: voucher burned against an order with no discount at all.
    orderC = await seedOrder('C', 0, 10_000);
    voucherC = await seedUsedVoucher(orderC);

    // State D: a source='reward' row with no used voucher behind it.
    orderD = await seedOrder('D', 1000, 10_000);
    const rewardRow = await service.from('order_coupons').insert({
      order_id: orderD, code: 'REWARD', kind: 'fixed', percent: 40,
      amount_cents: 1000, discount_cents: 1000, source: 'reward',
      free_label: '40% off one item',
    });
    if (rewardRow.error) throw new Error(`Failed to seed reward row: ${rewardRow.error.message}`);

    // State A: unattributable gap — discount with no coupon rows, no voucher.
    orderA = await seedOrder('A', 500, 10_000);
  }, 30_000);

  afterAll(async () => {
    if (!canRun) return;
    // orders cascade order_lines + order_coupons; the user cascades vouchers.
    if (orderIds.length) await service.from('orders').delete().in('id', orderIds);
    if (userId) await service.auth.admin.deleteUser(userId);
  }, 30_000);

  test('anon cannot execute reconcile_reward_vouchers (service-role only)', async () => {
    const res = await anon.rpc('reconcile_reward_vouchers', { p_repair: false });
    expect(res.error).toBeTruthy();
  });

  test('detect pass (p_repair=false) classifies every state and repairs nothing', async () => {
    const res = await service.rpc('reconcile_reward_vouchers', { p_repair: false });
    expect(res.error).toBeNull();
    const r = res.data as ReconcileResult;
    expect(r.ok).toBe(true);

    expect(r.state_b.repairable_order_ids).toContain(orderB);
    expect(r.state_b.repaired_order_ids).not.toContain(orderB);
    expect(r.state_b.uncorroborated_order_ids).toContain(orderUncorrob);
    expect(r.state_c.voucher_ids).toContain(voucherC);
    expect(r.state_d.order_ids).toContain(orderD);
    expect(r.state_a.order_ids).toContain(orderA);

    // Detect-only: no reward row materialized for the repairable order.
    const rows = await service.from('order_coupons').select('id').eq('order_id', orderB);
    expect(rows.data).toEqual([]);
  });

  test('repair pass (p_repair=true) re-inserts the exact reward row, money untouched', async () => {
    const res = await service.rpc('reconcile_reward_vouchers', { p_repair: true });
    expect(res.error).toBeNull();
    const r = res.data as ReconcileResult;

    expect(r.state_b.repaired_order_ids).toContain(orderB);
    // The uncorroborated gap is still NOT auto-labeled REWARD.
    expect(r.state_b.uncorroborated_order_ids).toContain(orderUncorrob);
    expect(r.state_b.repaired_order_ids).not.toContain(orderUncorrob);

    // The row place-order would have written, amount = the order's own gap.
    const row = await service
      .from('order_coupons')
      .select('code, kind, percent, amount_cents, discount_cents, source, free_label')
      .eq('order_id', orderB)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      code: 'REWARD', kind: 'fixed', percent: 40,
      amount_cents: 4000, discount_cents: 4000, source: 'reward',
      free_label: '40% off one item',
    });

    // orders.discount_cents is byte-identical — the repair relabels, never re-prices.
    const order = await service.from('orders').select('discount_cents, invoice_amount_cents').eq('id', orderB).single();
    expect(order.data?.discount_cents).toBe(4000);
    expect(order.data?.invoice_amount_cents).toBe(6000);
  });

  test('after repair, the order leaves every mismatch bucket', async () => {
    const res = await service.rpc('reconcile_reward_vouchers', { p_repair: false });
    expect(res.error).toBeNull();
    const r = res.data as ReconcileResult;
    expect(r.state_b.repairable_order_ids).not.toContain(orderB);
    expect(r.state_b.repaired_order_ids).not.toContain(orderB);
    expect(r.state_a.order_ids).not.toContain(orderB);
    expect(r.state_d.order_ids).not.toContain(orderB);
  });
});
