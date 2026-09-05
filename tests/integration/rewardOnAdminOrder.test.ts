/**
 * A member's 300-point reward voucher (migration 050) spent through the
 * ADMIN-created order path (migration 093), against a REAL local Postgres.
 *
 * Before 093, `admin_create_order` / `admin_convert_prepared_cart` never
 * touched reward_vouchers at all — an owner honoring a member's earned
 * reward on an admin-composed or prepared-cart order had to fake it as an
 * ad-hoc discount, which spends nothing and leaves the voucher live to be
 * redeemed again at self-checkout. `p_reward = {voucher_id, line_index}`
 * closes that: the amount is re-derived server-side from the voucher's
 * percent and the named line's unit price, never taken from the client, and
 * consume_reward_voucher (064) claims it in the same transaction as the
 * order — a later raise rolls the claim back with the order.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts.
 * NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('reward voucher on admin order suite');

interface CreatedCart { cart_id: string; token: string }
interface ConvertOk { ok: true; order_id: string; order_number: string; total_cents: number }
interface ConvertNo { ok: false; reason: string; order_id: string | null; order_number: string | null }

/** BPC-157 ×2 @ 12,000 + Retatrutide ×1 @ 24,500 → subtotal 48,500. */
const LINES = [
  { sku: 'VSR-RS-BPC', dose: '10mg', name: 'BPC-157 — 10mg', quantity: 2, unitPriceCents: 12_000 },
  { sku: 'VSR-RS-RETA', dose: '15mg', name: 'Retatrutide — 15mg', quantity: 1, unitPriceCents: 24_500 },
];

const linesPayload = LINES.map((l) => ({
  sku: l.sku, product_name: l.name, quantity: l.quantity, unit_price_cents: l.unitPriceCents, item_note: null,
}));

const MEMBER15_DISCOUNT = { kind: 'percent', percent: 15, code: 'MEMBER15' };
/** line_index 1 = Retatrutide, unit_price_cents 24,500. */
const RETA_LINE_INDEX = 1;

describe.skipIf(!canRun)('reward voucher spent on an admin order (real DB, migration 093)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let memberUserId = '';
  let adminUserId = '';
  const createdOrderIds: string[] = [];

  async function newCart(): Promise<CreatedCart> {
    const res = await admin.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId,
      p_lines: LINES.map((l) => ({ sku: l.sku, dose: l.dose, quantity: l.quantity })),
      p_coupon_code: null,
      p_note: null,
    });
    if (res.error) throw new Error(`cart create failed: ${res.error.message}`);
    return res.data as CreatedCart;
  }

  async function convert(cartId: string, discount: unknown = null, reward: unknown = null) {
    const res = await admin.rpc('admin_convert_prepared_cart', {
      p_cart_id: cartId,
      p_buyer_name: 'Reward Member',
      p_buyer_contact: `member-rwd-${runId}@example.test`,
      p_buyer_organization: 'Velari Lab',
      p_notes: 'Paid by Zelle before checkout',
      p_lines: linesPayload,
      p_discount: discount,
      p_reward: reward,
    });
    const body = res.data as ConvertOk | ConvertNo | null;
    if (body && 'ok' in body && body.ok) createdOrderIds.push(body.order_id);
    return { error: res.error, body };
  }

  /** One active 40%/300pt voucher for the given member (partial-unique index
   * allows one ACTIVE per user, so callers must not seed two for the same id
   * without first consuming or voiding the first). */
  async function seedVoucher(userId: string): Promise<string> {
    const res = await service
      .from('reward_vouchers')
      .insert({ user_id: userId, percent: 40, points_spent: 300, status: 'active' })
      .select('id')
      .single();
    if (res.error) throw new Error(`voucher seed failed: ${res.error.message}`);
    return (res.data as { id: string }).id;
  }

  beforeAll(async () => {
    service = serviceClient();

    const adminEmail = `admin-rwd-${runId}@example.test`;
    const adminPw = `Admin-${runId}-Aa1!`;
    const adminCreated = await service.auth.admin.createUser({ email: adminEmail, password: adminPw, email_confirm: true });
    if (adminCreated.error || !adminCreated.data.user) throw new Error(`admin createUser failed: ${adminCreated.error?.message}`);
    adminUserId = adminCreated.data.user.id;
    const adminRow = await service.from('admin_users').insert({ user_id: adminUserId, email: adminEmail, active: true });
    if (adminRow.error) throw new Error(`admin_users insert failed: ${adminRow.error.message}`);
    admin = anonClient();
    const adminSignIn = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPw });
    if (adminSignIn.error) throw new Error(`admin sign-in failed: ${adminSignIn.error.message}`);

    const memberEmail = `member-rwd-${runId}@example.test`;
    const memberPw = `Member-${runId}-Aa1!`;
    const memberCreated = await service.auth.admin.createUser({ email: memberEmail, password: memberPw, email_confirm: true });
    if (memberCreated.error || !memberCreated.data.user) throw new Error(`member createUser failed: ${memberCreated.error?.message}`);
    memberUserId = memberCreated.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: memberUserId, full_name: 'Reward Member', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);
  });

  afterAll(async () => {
    for (const id of createdOrderIds) {
      await service.from('audit_log').delete().eq('entity_id', id);
      await service.from('orders').delete().eq('id', id);
    }
    if (memberUserId) {
      await service.from('reward_vouchers').delete().eq('user_id', memberUserId);
      await service.from('reward_ledger').delete().eq('user_id', memberUserId);
      await service.from('prepared_carts').delete().eq('user_id', memberUserId);
      await service.from('audit_log').delete().eq('entity_id', memberUserId);
      await service.from('customer_profiles').delete().eq('user_id', memberUserId);
      await service.auth.admin.deleteUser(memberUserId);
    }
    if (adminUserId) {
      await service.from('reward_vouchers').delete().eq('user_id', adminUserId);
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  test('happy path: voucher + account discount both land, in the fenced order 052 expects', async () => {
    const voucherId = await seedVoucher(memberUserId);
    const cart = await newCart();

    const { error, body } = await convert(cart.cart_id, MEMBER15_DISCOUNT, {
      voucher_id: voucherId, line_index: RETA_LINE_INDEX,
    });

    expect(error).toBeNull();
    expect((body as ConvertOk).ok).toBe(true);
    const orderId = (body as ConvertOk).order_id;
    expect((body as ConvertOk).total_cents).toBe(35_100);

    const { data: order } = await service
      .from('orders')
      .select('subtotal_cents, discount_cents, invoice_amount_cents')
      .eq('id', orderId)
      .single();
    expect(order?.subtotal_cents).toBe(48_500);
    expect(order?.discount_cents).toBe(13_400);
    expect(order?.invoice_amount_cents).toBe(35_100);

    const { data: coupons } = await service
      .from('order_coupons')
      .select('code, kind, percent, amount_cents, discount_cents, free_label, source')
      .eq('order_id', orderId)
      .order('code');
    expect(coupons).toEqual([
      { code: 'MEMBER15', kind: 'percent', percent: 15, amount_cents: null, discount_cents: 3_600, free_label: null, source: 'account' },
      { code: 'REWARD', kind: 'fixed', percent: 40, amount_cents: 9_800, discount_cents: 9_800, free_label: '40% off one item', source: 'reward' },
    ]);

    const { data: voucher } = await service
      .from('reward_vouchers')
      .select('status, order_id')
      .eq('id', voucherId)
      .single();
    expect(voucher?.status).toBe('used');
    expect(voucher?.order_id).toBe(orderId);
  });

  test('a used voucher cannot be spent again on a second order', async () => {
    const voucherId = await seedVoucher(memberUserId);
    const firstCart = await newCart();
    const first = await convert(firstCart.cart_id, null, { voucher_id: voucherId, line_index: RETA_LINE_INDEX });
    expect((first.body as ConvertOk).ok).toBe(true);

    const secondCart = await newCart();
    const second = await convert(secondCart.cart_id, null, { voucher_id: voucherId, line_index: RETA_LINE_INDEX });

    expect(second.error?.message ?? '').toMatch(/Reward voucher is not active for this member/i);

    const { data } = await service
      .from('prepared_carts')
      .select('converted_at')
      .eq('id', secondCart.cart_id)
      .single();
    expect(data?.converted_at).toBeNull();
  });

  test("another member's active voucher is refused — ownership, not just status", async () => {
    // adminUserId is a real auth.users row (reward_vouchers.user_id has an FK)
    // but is not the cart's member, so this exercises the ownership predicate
    // rather than a fabricated foreign user.
    const otherVoucherId = await seedVoucher(adminUserId);
    const cart = await newCart();

    const { error } = await convert(cart.cart_id, null, { voucher_id: otherVoucherId, line_index: RETA_LINE_INDEX });

    expect(error?.message ?? '').toMatch(/Reward voucher is not active for this member/i);
  });

  test('an out-of-range line_index fails before the voucher is even looked up', async () => {
    const cart = await newCart();

    const { error } = await convert(cart.cart_id, null, { voucher_id: randomUUID(), line_index: 7 });

    expect(error?.message ?? '').toMatch(/Reward line_index out of range/i);
  });

  test("the plain `+ New order` 5-name call shape still resolves with p_reward defaulted", async () => {
    const res = await admin.rpc('admin_create_order', {
      p_buyer_name: 'Offline Buyer',
      p_buyer_contact: `offline-rwd-${runId}@example.test`,
      p_buyer_organization: null,
      p_notes: null,
      p_lines: linesPayload,
    });

    expect(res.error).toBeNull();
    const orderId = (res.data as { order_id: string }).order_id;
    createdOrderIds.push(orderId);

    const { data } = await service.from('order_coupons').select('id').eq('order_id', orderId);
    expect(data).toHaveLength(0);
  });
});
