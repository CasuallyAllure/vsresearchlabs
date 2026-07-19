/**
 * redeem_coupon (migration 031) against a REAL local Postgres.
 *
 * Proves the semantics the mock-based checkout suites can only assume:
 *   • service-role-only surface (revoked from anon in 031) — the anon client
 *     cannot execute it at all;
 *   • the atomic take-the-last-use path: with max_uses=1, the first redeem
 *     bumps used_count and writes the ledger row, the second returns
 *     {ok:false, reason:'exhausted'} and writes NOTHING (used_count and the
 *     redemption ledger are unchanged — the failure path mutates zero rows);
 *   • once_per_contact re-checked at redeem time, case/trim-insensitively;
 *   • affiliate commission math: round(order_net × percent / 100), status
 *     'pending', with coupon.commission_percent overriding the affiliate
 *     default.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('redeem_coupon suite');

interface RedeemResult {
  ok: boolean;
  reason?: string;
  commission_cents?: number;
}

describe.skipIf(!canRun)('redeem_coupon (real DB, migration 031)', () => {
  const runId = randomUUID().slice(0, 8).toUpperCase();
  const LAST = `RD-LAST-${runId}`; // max_uses = 1 → second redeem loses
  const ONCE = `RD-ONCE-${runId}`; // once_per_contact
  const AFF = `RD-AFF-${runId}`; // affiliate-linked, commission_percent = 15
  const onceContact = `rd-once-${runId}@example.test`;

  let service: SupabaseClient;
  let anon: SupabaseClient;
  let affiliateId = '';
  const orderIds: string[] = [];

  async function seedOrder(suffix: string): Promise<string> {
    const res = await service
      .from('orders')
      .insert({
        order_number: `ITEST-RD-${runId}-${suffix}`,
        buyer_name: 'Redeem Test Buyer',
        buyer_contact: `rd-buyer-${runId}@example.test`,
        subtotal_cents: 10_000,
        shipping_cents: 0,
        invoice_amount_cents: 10_000,
      })
      .select('id')
      .single();
    if (res.error || !res.data) throw new Error(`Failed to seed order: ${res.error?.message}`);
    orderIds.push(res.data.id as string);
    return res.data.id as string;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    const aff = await service
      .from('affiliates')
      .insert({ name: `RD Test Affiliate ${runId}`, default_commission_percent: 10 })
      .select('id')
      .single();
    if (aff.error || !aff.data) throw new Error(`Failed to seed affiliate: ${aff.error?.message}`);
    affiliateId = aff.data.id as string;

    const coupons = await service.from('coupons').insert([
      { code: LAST, kind: 'percent', percent: 10, max_uses: 1 },
      { code: ONCE, kind: 'percent', percent: 10, once_per_contact: true },
      {
        code: AFF, kind: 'percent', percent: 10,
        affiliate_id: affiliateId, commission_percent: 15,
      },
    ]);
    if (coupons.error) throw new Error(`Failed to seed coupons: ${coupons.error.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!canRun) return;
    await service.from('coupon_redemptions').delete().like('code', `RD-%-${runId}`);
    await service.from('coupons').delete().like('code', `RD-%-${runId}`);
    if (affiliateId) await service.from('affiliates').delete().eq('id', affiliateId);
    if (orderIds.length) await service.from('orders').delete().in('id', orderIds);
  }, 30_000);

  test('anon cannot execute redeem_coupon (service-role only)', async () => {
    const res = await anon.rpc('redeem_coupon', {
      p_code: LAST, p_order_id: randomUUID(), p_contact: null,
      p_discount_cents: 0, p_order_net_cents: 0,
    });
    expect(res.error).toBeTruthy();
  });

  test('unknown code returns {ok:false, reason:not_valid}', async () => {
    const res = await service.rpc('redeem_coupon', {
      p_code: `RD-NOPE-${runId}`, p_order_id: null, p_contact: null,
      p_discount_cents: 0, p_order_net_cents: 0,
    });
    expect(res.error).toBeNull();
    expect(res.data as RedeemResult).toMatchObject({ ok: false, reason: 'not_valid' });
  });

  test('max_uses=1: first redeem wins, second loses, and the loser writes NOTHING', async () => {
    const orderA = await seedOrder('LAST-A');
    const orderB = await seedOrder('LAST-B');

    const first = await service.rpc('redeem_coupon', {
      p_code: LAST, p_order_id: orderA, p_contact: 'a@example.test',
      p_discount_cents: 1000, p_order_net_cents: 9000,
    });
    expect(first.error).toBeNull();
    expect((first.data as RedeemResult).ok).toBe(true);

    const second = await service.rpc('redeem_coupon', {
      p_code: LAST, p_order_id: orderB, p_contact: 'b@example.test',
      p_discount_cents: 1000, p_order_net_cents: 9000,
    });
    expect(second.error).toBeNull();
    expect(second.data as RedeemResult).toMatchObject({ ok: false, reason: 'exhausted' });

    // The failure path mutated zero rows: counter still 1, one ledger row.
    const coupon = await service.from('coupons').select('used_count').eq('code', LAST).single();
    expect(coupon.data?.used_count).toBe(1);
    const ledger = await service.from('coupon_redemptions').select('id, order_id').eq('code', LAST);
    expect(ledger.data).toHaveLength(1);
    expect(ledger.data?.[0].order_id).toBe(orderA);
  });

  test('once_per_contact: second redeem for the same contact loses (case/trim-insensitive)', async () => {
    const orderA = await seedOrder('ONCE-A');
    const orderB = await seedOrder('ONCE-B');

    const first = await service.rpc('redeem_coupon', {
      p_code: ONCE, p_order_id: orderA, p_contact: onceContact,
      p_discount_cents: 500, p_order_net_cents: 4500,
    });
    expect(first.error).toBeNull();
    expect((first.data as RedeemResult).ok).toBe(true);

    const second = await service.rpc('redeem_coupon', {
      p_code: ONCE, p_order_id: orderB, p_contact: `  ${onceContact.toUpperCase()} `,
      p_discount_cents: 500, p_order_net_cents: 4500,
    });
    expect(second.error).toBeNull();
    expect(second.data as RedeemResult).toMatchObject({ ok: false, reason: 'already_used' });

    const ledger = await service.from('coupon_redemptions').select('id').eq('code', ONCE);
    expect(ledger.data).toHaveLength(1);
  });

  test('affiliate commission: coupon.commission_percent overrides the affiliate default', async () => {
    const orderA = await seedOrder('AFF-A');

    // net 9,333 × 15% = 1,399.95 → round → 1,400 (NOT 10% = 933).
    const res = await service.rpc('redeem_coupon', {
      p_code: AFF, p_order_id: orderA, p_contact: 'aff-buyer@example.test',
      p_discount_cents: 667, p_order_net_cents: 9333,
    });
    expect(res.error).toBeNull();
    const payload = res.data as RedeemResult;
    expect(payload.ok).toBe(true);
    expect(payload.commission_cents).toBe(1400);

    const row = await service
      .from('coupon_redemptions')
      .select('affiliate_id, discount_cents, order_net_cents, commission_cents, commission_status')
      .eq('code', AFF)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      affiliate_id: affiliateId,
      discount_cents: 667,
      order_net_cents: 9333,
      commission_cents: 1400,
      commission_status: 'pending',
    });
  });
});
