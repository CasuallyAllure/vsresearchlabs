/**
 * recompute_order_totals (migrations 036 → 037 → 042 → 045 → 049 → 052)
 * against a REAL local Postgres.
 *
 * This is THE single money source of truth for stored orders — every admin
 * line edit re-prices through it. The suite pins the final (052) semantics:
 *   • flat reductions (fixed + free_item) first, each capped at remaining base;
 *   • the 052 reward fence: percent codes never see the reward item's
 *     post-reward remainder (discount × (100−pct)/pct);
 *   • per-row discount_cents itemization (037) written back to order_coupons;
 *   • free_item materializes a $0 line when none exists;
 *   • total discount capped at subtotal; member free-shipping perk (049)
 *     zeroes shipping;
 *   • service-role only (revoked from public/anon/authenticated in 036).
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('recompute_order_totals suite');

interface TotalsResult {
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  codes: string;
}

describe.skipIf(!canRun)('recompute_order_totals (real DB, through migration 052)', () => {
  const runId = randomUUID().slice(0, 8).toUpperCase();
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let memberId = '';
  const orderIds: string[] = [];

  async function seedOrder(
    suffix: string,
    fields: Record<string, unknown> = {},
    lines: Array<{ sku: string; name: string; qty: number; unit: number }> = [],
  ): Promise<string> {
    const order = await service
      .from('orders')
      .insert({
        order_number: `ITEST-RT-${runId}-${suffix}`,
        buyer_name: 'Totals Test Buyer',
        buyer_contact: `rt-${runId}@example.test`,
        ...fields,
      })
      .select('id')
      .single();
    if (order.error || !order.data) throw new Error(`Failed to seed order ${suffix}: ${order.error?.message}`);
    const orderId = order.data.id as string;
    orderIds.push(orderId);

    if (lines.length) {
      const inserted = await service.from('order_lines').insert(
        lines.map((l) => ({
          order_id: orderId, sku: l.sku, product_name: l.name,
          quantity: l.qty, unit_price_cents: l.unit,
        })),
      );
      if (inserted.error) throw new Error(`Failed to seed lines ${suffix}: ${inserted.error.message}`);
    }
    return orderId;
  }

  async function recompute(orderId: string): Promise<TotalsResult> {
    const res = await service.rpc('recompute_order_totals', { p_order_id: orderId });
    expect(res.error).toBeNull();
    return res.data as TotalsResult;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // Member with the free-shipping perk (customer_profiles row is minted by
    // the 028 on-signup trigger; the service role may set the guarded flag).
    const user = await service.auth.admin.createUser({
      email: `rt-member-${runId}@example.test`,
      password: `Rt-Test-${runId}!`,
      email_confirm: true,
      user_metadata: { full_name: 'Totals Test Member' },
    });
    if (user.error || !user.data.user) throw new Error(`Failed to create member: ${user.error?.message}`);
    memberId = user.data.user.id;
    const perk = await service
      .from('customer_profiles')
      .update({ free_shipping: true })
      .eq('user_id', memberId);
    if (perk.error) throw new Error(`Failed to set free_shipping: ${perk.error.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!canRun) return;
    if (orderIds.length) await service.from('orders').delete().in('id', orderIds);
    if (memberId) await service.auth.admin.deleteUser(memberId);
  }, 30_000);

  test('anon cannot execute recompute_order_totals (service-role only)', async () => {
    const res = await anon.rpc('recompute_order_totals', { p_order_id: randomUUID() });
    expect(res.error).toBeTruthy();
  });

  test('052 reward fence: a percent code never sees the reward item remainder', async () => {
    // $50 + $50 cart, 40% reward on one item (−$20), 15% code — the worked
    // example from the 052 migration header. Intent: 15% sees only the other
    // $50 line → $7.50, NOT $12.
    const orderId = await seedOrder('FENCE', { shipping_cents: 999 }, [
      { sku: `RT-A-${runId}`, name: 'Item A', qty: 1, unit: 5000 },
      { sku: `RT-B-${runId}`, name: 'Item B', qty: 1, unit: 5000 },
    ]);
    const coupons = await service.from('order_coupons').insert([
      {
        order_id: orderId, code: 'REWARD', kind: 'fixed', percent: 40,
        amount_cents: 2000, source: 'reward', free_label: '40% off one item',
      },
      { order_id: orderId, code: `RT-PCT15-${runId}`, kind: 'percent', percent: 15, source: 'code' },
    ]);
    if (coupons.error) throw new Error(`Failed to seed coupons: ${coupons.error.message}`);

    const totals = await recompute(orderId);
    // flat = 2,000; fence = 2,000 × 60/40 = 3,000; percent base = 10,000 −
    // 2,000 − 3,000 = 5,000 → 15% = 750. Discount 2,750; total 10,000 + 999 −
    // 2,750 = 8,249.
    expect(totals.subtotal_cents).toBe(10_000);
    expect(totals.discount_cents).toBe(2750);
    expect(totals.shipping_cents).toBe(999);
    expect(totals.total_cents).toBe(8249);

    // 037 itemization written back per row.
    const rows = await service
      .from('order_coupons')
      .select('code, discount_cents')
      .eq('order_id', orderId);
    const byCode = Object.fromEntries((rows.data ?? []).map((r) => [r.code, r.discount_cents]));
    expect(byCode['REWARD']).toBe(2000);
    expect(byCode[`RT-PCT15-${runId}`]).toBe(750);

    // The orders header matches the returned jsonb.
    const order = await service
      .from('orders')
      .select('subtotal_cents, discount_cents, invoice_amount_cents, coupon_code')
      .eq('id', orderId)
      .single();
    expect(order.data?.subtotal_cents).toBe(10_000);
    expect(order.data?.discount_cents).toBe(2750);
    expect(order.data?.invoice_amount_cents).toBe(8249);
    expect(order.data?.coupon_code).toContain('REWARD');
  });

  test('free_item: materializes a $0 line when missing, discounts the paid unit when present', async () => {
    const freeSku = `RT-FREE-${runId}`;
    const paidSku = `RT-PAID-${runId}`;
    const orderId = await seedOrder('FREE', {}, [
      { sku: paidSku, name: 'Paid Item', qty: 1, unit: 4000 },
    ]);
    const coupon = await service.from('order_coupons').insert({
      order_id: orderId, code: `RT-FI-${runId}`, kind: 'free_item',
      free_sku: freeSku, free_label: 'Free Test Item', source: 'code',
    });
    if (coupon.error) throw new Error(`Failed to seed free_item coupon: ${coupon.error.message}`);

    const totals = await recompute(orderId);
    // The free SKU was not on the order → a $0 line is added (visible on the
    // invoice) and, having no paid unit, contributes zero discount.
    expect(totals.subtotal_cents).toBe(4000);
    expect(totals.discount_cents).toBe(0);

    const freeLine = await service
      .from('order_lines')
      .select('product_name, unit_price_cents, quantity')
      .eq('order_id', orderId)
      .eq('sku', freeSku)
      .single();
    expect(freeLine.error).toBeNull();
    expect(freeLine.data?.unit_price_cents).toBe(0);
    expect(freeLine.data?.product_name).toContain('FREE');

    // Now a PAID unit of the free SKU exists on the order → that unit is
    // offset to $0 net via an equal discount.
    const paidUnit = await service.from('order_lines').insert({
      order_id: orderId, sku: freeSku, product_name: 'Free Test Item (paid unit)',
      quantity: 1, unit_price_cents: 2500,
    });
    if (paidUnit.error) throw new Error(`Failed to add paid unit: ${paidUnit.error.message}`);

    const totals2 = await recompute(orderId);
    expect(totals2.subtotal_cents).toBe(6500);
    expect(totals2.discount_cents).toBe(2500);
    expect(totals2.total_cents).toBe(4000);
  });

  test('discount is capped at the subtotal (total never goes negative)', async () => {
    const orderId = await seedOrder('CAP', { shipping_cents: 500 }, [
      { sku: `RT-CAP-${runId}`, name: 'Cheap Item', qty: 1, unit: 3000 },
    ]);
    const coupon = await service.from('order_coupons').insert({
      order_id: orderId, code: `RT-BIG-${runId}`, kind: 'fixed', amount_cents: 99_999, source: 'code',
    });
    if (coupon.error) throw new Error(`Failed to seed coupon: ${coupon.error.message}`);

    const totals = await recompute(orderId);
    expect(totals.discount_cents).toBe(3000);
    expect(totals.total_cents).toBe(500); // shipping survives; items fully discounted
  });

  test('049 member perk: free_shipping zeroes shipping on the member order', async () => {
    const orderId = await seedOrder('SHIP', { user_id: memberId, shipping_cents: 999 }, [
      { sku: `RT-SHIP-${runId}`, name: 'Member Item', qty: 1, unit: 5000 },
    ]);

    const totals = await recompute(orderId);
    expect(totals.shipping_cents).toBe(0);
    expect(totals.total_cents).toBe(5000);

    const order = await service.from('orders').select('shipping_cents').eq('id', orderId).single();
    expect(order.data?.shipping_cents).toBe(0);
  });
});
