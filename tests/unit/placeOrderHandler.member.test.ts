/**
 * Orchestration tests — place-order ownership, membership pricing, and
 * member-only money paths (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/placeOrderHarness)
 * and pins: the Authorization gate (guest / anon-key / bogus / throwing
 * sessions all mean guest semantics), the P0-5 rule that a verified session
 * alone grants member pricing regardless of the typed contact, member free
 * shipping vs the flat guest fee, the account-discount RPC contract, and the
 * reward-voucher fetch → claim → win/lose/rollback ladder.
 */
import { describe, expect, test } from 'vitest';
import {
  BPC_PRICE_CENTS,
  basePayload,
  catalogRows,
  makeHarness,
  placeOrder,
  type Harness,
  type RecordedQuery,
  withCatalog,
} from '../helpers/placeOrderHarness';
import { GUEST_SHIPPING_CENTS } from '../../supabase/functions/place-order/orderShipping';

const MEMBER_JWT = 'member-session-jwt';
const MEMBER_ID = 'user-1';

/** Harness with the catalog registered and one valid member session whose
 *  account email MATCHES basePayload()'s contact. */
function memberHarness(): Harness {
  const h = withCatalog(makeHarness());
  h.sessions.set(MEMBER_JWT, { id: MEMBER_ID, email: 'buyer@test.example' });
  return h;
}

function orderInsert(h: Harness): Record<string, unknown> {
  const q = h.db.of('orders', 'insert')[0];
  expect(q).toBeDefined();
  return q.payload as Record<string, unknown>;
}

function couponInserts(h: Harness): Record<string, unknown>[] {
  // order_coupons inserts arrive as single objects (account/reward/promo) or
  // arrays (surviving code rows) — flatten to one list of rows.
  return h.db
    .of('order_coupons', 'insert')
    .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload])) as Record<
    string,
    unknown
  >[];
}

const isRewardRow = (q: RecordedQuery) =>
  (q.payload as { source?: string } | undefined)?.source === 'reward';

describe('ownership + membership resolution', () => {
  test('guest checkout: flat shipping, no user_id, no account/reward lookups', async () => {
    const h = withCatalog(makeHarness());
    const { status, body } = await placeOrder(h, basePayload());

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    const order = orderInsert(h);
    expect(order.shipping_cents).toBe(GUEST_SHIPPING_CENTS);
    expect(order.user_id).toBeUndefined();
    expect(order.discount_cents).toBe(0);
    // No stamped owner → the member-only lookups never run.
    expect(h.db.rpcCalls.filter((c) => c.fn === 'effective_customer_discount')).toHaveLength(0);
    expect(h.db.of('reward_vouchers', 'select')).toHaveLength(0);
  });

  test('valid bearer session: user_id stamped, member free shipping, invoice sent', async () => {
    const h = memberHarness();
    const { status, body } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    expect(status).toBe(200);
    // Member ships free — the whole price difference from the guest test.
    expect(body.amountCents).toBe(BPC_PRICE_CENTS);
    const order = orderInsert(h);
    expect(order.user_id).toBe(MEMBER_ID);
    expect(order.shipping_cents).toBe(0);
    expect(order.invoice_amount_cents).toBe(BPC_PRICE_CENTS);
    // Membership unlocked the entitlement lookups.
    expect(h.db.rpcCalls).toContainEqual({
      fn: 'effective_customer_discount',
      args: { p_user_id: MEMBER_ID },
    });
    expect(h.db.of('reward_vouchers', 'select')).toHaveLength(1);
    // Buyer invoice (memberFreeShipping render path) + business copy both sent.
    expect(body.invoiceEmailSent).toBe(true);
    expect(h.emails).toHaveLength(2);
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[1].to).toBe('biz@test.example');
  });

  test('the anon key as bearer is not a session — guest semantics, sessions never consulted', async () => {
    const h = withCatalog(makeHarness());
    // Even a session registered under the anon key must be unreachable: the
    // handler refuses to call getUser with the anon key at all.
    h.sessions.set(h.config.supabaseAnonKey, { id: 'sneaky-user', email: 'buyer@test.example' });
    const { status, body } = await placeOrder(h, basePayload(), {
      bearer: h.config.supabaseAnonKey,
    });

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    const order = orderInsert(h);
    expect(order.user_id).toBeUndefined();
    expect(order.shipping_cents).toBe(GUEST_SHIPPING_CENTS);
    expect(h.db.rpcCalls.filter((c) => c.fn === 'effective_customer_discount')).toHaveLength(0);
  });

  test('an invalid/expired bearer (getUser errors) falls back to guest semantics', async () => {
    const h = withCatalog(makeHarness());
    // No session registered for this jwt → getUser resolves { user: null, error }.
    const { status, body } = await placeOrder(h, basePayload(), { bearer: 'expired-jwt' });

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    const order = orderInsert(h);
    expect(order.user_id).toBeUndefined();
    expect(order.shipping_cents).toBe(GUEST_SHIPPING_CENTS);
  });

  test('getUser THROWING still degrades to guest — the order goes through', async () => {
    const h = withCatalog(makeHarness());
    h.authThrows = new Error('gotrue is down');
    const { status, body } = await placeOrder(h, basePayload(), { bearer: 'some-jwt' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    const order = orderInsert(h);
    expect(order.user_id).toBeUndefined();
    expect(order.shipping_cents).toBe(GUEST_SHIPPING_CENTS);
    expect(h.emails).toHaveLength(2);
  });

  test('P0-5: a member whose typed contact differs from the account email STILL gets member pricing', async () => {
    const h = withCatalog(makeHarness());
    h.sessions.set(MEMBER_JWT, { id: MEMBER_ID, email: 'owner@account.example' });
    // The buyer types a completely different notification address — the field
    // invites "Email or Phone", so this must never demote them to guest.
    const { status, body } = await placeOrder(
      h,
      basePayload({ contact: 'ship-here@other.example' }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS); // no guest shipping fee
    const order = orderInsert(h);
    expect(order.user_id).toBe(MEMBER_ID);
    expect(order.shipping_cents).toBe(0);
    expect(order.buyer_contact).toBe('ship-here@other.example');
    // The member-only entitlement lookups ran for the verified account.
    expect(h.db.rpcCalls).toContainEqual({
      fn: 'effective_customer_discount',
      args: { p_user_id: MEMBER_ID },
    });
    expect(h.db.of('reward_vouchers', 'select')).toHaveLength(1);
  });
});

describe('account discount (effective_customer_discount)', () => {
  test('lifetime 10% applies: order row money, ACCT-LIFETIME label, source=account row', async () => {
    const h = memberHarness();
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'lifetime', percent: 10, label: 'Loyal researcher' },
    });
    const { status, body } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    const expectedDiscount = Math.round((BPC_PRICE_CENTS * 10) / 100); // 500
    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - expectedDiscount);
    const order = orderInsert(h);
    expect(order.discount_cents).toBe(expectedDiscount);
    expect(order.coupon_code).toContain('ACCT-LIFETIME');
    expect(order.invoice_amount_cents).toBe(BPC_PRICE_CENTS - expectedDiscount);

    const acctRow = couponInserts(h).find((r) => r.source === 'account');
    expect(acctRow).toMatchObject({
      order_id: 'order-1',
      code: 'ACCT-LIFETIME',
      kind: 'percent',
      percent: 10,
      discount_cents: expectedDiscount,
    });
  });

  test('business scope labels as ACCT-BUSINESS', async () => {
    const h = memberHarness();
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'business', percent: 15, label: 'B2B rate' },
    });
    const { status } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    expect(status).toBe(200);
    const order = orderInsert(h);
    expect(order.coupon_code).toContain('ACCT-BUSINESS');
    expect(order.discount_cents).toBe(Math.round((BPC_PRICE_CENTS * 15) / 100));
    const acctRow = couponInserts(h).find((r) => r.source === 'account');
    expect(acctRow).toMatchObject({ code: 'ACCT-BUSINESS', percent: 15 });
  });

  test('an RPC error is non-fatal: the order proceeds at full member price, no discount', async () => {
    const h = memberHarness();
    h.db.onRpc('effective_customer_discount', { error: { message: 'rpc exploded' } });
    const { status, body } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS); // shipping still free
    const order = orderInsert(h);
    expect(order.discount_cents).toBe(0);
    expect(order.coupon_code).toBeNull();
    expect(couponInserts(h).filter((r) => r.source === 'account')).toHaveLength(0);
  });

  test.each([
    ['found:false', { found: false, scope: 'lifetime', percent: 10 }],
    ['percent 0', { found: true, scope: 'lifetime', percent: 0 }],
    ['percent > 100', { found: true, scope: 'lifetime', percent: 150 }],
    ['unknown scope', { found: true, scope: 'other', percent: 10 }],
  ])('no discount when the RPC returns %s', async (_label, rpcData) => {
    const h = memberHarness();
    h.db.onRpc('effective_customer_discount', { data: rpcData });
    const { status, body } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS);
    const order = orderInsert(h);
    expect(order.discount_cents).toBe(0);
    expect(order.coupon_code).toBeNull();
    expect(couponInserts(h)).toHaveLength(0);
  });
});

describe('reward voucher', () => {
  const TB_SKU = 'VSR-RS-TB4-005';
  const TB_PRICE_CENTS = 10000;

  /** Catalog with a second, more expensive verified dose so "highest unit
   *  price" is distinguishable from "first line". */
  function twoLineCatalog() {
    return [
      ...catalogRows(),
      {
        sku: TB_SKU,
        dose: '10mg',
        price_cents: TB_PRICE_CENTS,
        on_hand: 5,
        inbound_units: 0,
        lead_days: null,
        wholesale_eligible: false,
      },
    ];
  }

  function twoLinePayload() {
    const p = basePayload();
    p.items = [
      ...p.items,
      {
        product: { id: 'tb-500', name: 'TB-500 — 10mg', category: 'biopeptides', sku: TB_SKU },
        quantity: 1,
        unitPriceCents: TB_PRICE_CENTS,
        fast: true,
      },
    ];
    return p;
  }

  function memberWithVoucher(h: Harness): Harness {
    h.sessions.set(MEMBER_JWT, { id: MEMBER_ID, email: 'buyer@test.example' });
    h.db.on('reward_vouchers', 'select', { data: { id: 'v-1', percent: 40 } });
    return h;
  }

  test('claim wins: 40% of the HIGHEST unit price comes off, source=reward row persists', async () => {
    const h = memberWithVoucher(withCatalog(makeHarness(), twoLineCatalog()));
    h.db.onRpc('consume_reward_voucher', { data: { ok: true } });
    const { status, body } = await placeOrder(h, twoLinePayload(), { bearer: MEMBER_JWT });

    const subtotal = BPC_PRICE_CENTS + TB_PRICE_CENTS;
    const reward = Math.round((TB_PRICE_CENTS * 40) / 100); // 4000 — not off BPC
    expect(status).toBe(200);
    expect(body.amountCents).toBe(subtotal - reward);
    const order = orderInsert(h);
    expect(order.discount_cents).toBe(reward);
    expect(order.coupon_code).toBe('REWARD');
    expect(order.invoice_amount_cents).toBe(subtotal - reward);
    // The claim went through the atomic RPC with this voucher + this order.
    expect(h.db.rpcCalls).toContainEqual({
      fn: 'consume_reward_voucher',
      args: { p_voucher_id: 'v-1', p_order_id: 'order-1' },
    });
    const rewardRow = couponInserts(h).find((r) => r.source === 'reward');
    expect(rewardRow).toMatchObject({
      order_id: 'order-1',
      code: 'REWARD',
      kind: 'fixed',
      percent: 40,
      amount_cents: reward,
      discount_cents: reward,
      free_label: '40% off one item',
    });
    expect(h.alerts).toHaveLength(0);
  });

  test('claim lost (raced): reward rolls OFF — totals re-persisted, label dropped, no reward row', async () => {
    const h = memberWithVoucher(withCatalog(makeHarness()));
    h.db.onRpc('consume_reward_voucher', { data: { ok: false, reason: 'not_active' } });
    const { status, body } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    const reward = Math.round((BPC_PRICE_CENTS * 40) / 100); // 2000
    expect(status).toBe(200);
    // The order INSERT still carried the reward (claim comes after)…
    const order = orderInsert(h);
    expect(order.discount_cents).toBe(reward);
    expect(order.coupon_code).toBe('REWARD');
    // …but the rollback UPDATE re-persisted the order without it.
    const rollback = h.db.of('orders', 'update')[0];
    expect(rollback).toBeDefined();
    expect(rollback.payload).toEqual({
      discount_cents: 0,
      coupon_code: null,
      invoice_amount_cents: BPC_PRICE_CENTS,
    });
    // The response and the reward row both reflect the rolled-back state.
    expect(body.amountCents).toBe(BPC_PRICE_CENTS);
    expect(couponInserts(h).filter((r) => r.source === 'reward')).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  test('claim lost AND the rollback update fails: alertOperator fires with stage reward_rollback', async () => {
    const h = memberWithVoucher(withCatalog(makeHarness()));
    h.db.onRpc('consume_reward_voucher', { data: { ok: false, reason: 'not_active' } });
    h.db.on('orders', 'update', { error: { message: 'db unavailable' } });
    const { status } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    expect(status).toBe(200); // checkout still completes for the buyer
    const alert = h.alerts.find((a) => a.stage === 'reward_rollback');
    expect(alert).toBeDefined();
    expect(alert!.summary).toContain('rollback did NOT persist');
    expect(alert!.ctx).toMatchObject({ orderId: 'order-1' });
  });

  test('claim wins but the reward order_coupons insert fails: alert with stage reward_row_insert', async () => {
    const h = memberWithVoucher(withCatalog(makeHarness()));
    h.db.onRpc('consume_reward_voucher', { data: { ok: true } });
    h.db.on('order_coupons', 'insert', { error: { message: 'insert refused' } }, isRewardRow);
    const { status, body } = await placeOrder(h, basePayload(), { bearer: MEMBER_JWT });

    const reward = Math.round((BPC_PRICE_CENTS * 40) / 100);
    expect(status).toBe(200);
    // The voucher is consumed and the discount stays on the order — only the
    // materialized row is missing, which is exactly what the alert reports.
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - reward);
    const alert = h.alerts.find((a) => a.stage === 'reward_row_insert');
    expect(alert).toBeDefined();
    expect(alert!.ctx).toMatchObject({
      voucherId: 'v-1',
      rewardPercent: 40,
      rewardDiscountCents: reward,
    });
  });
});
