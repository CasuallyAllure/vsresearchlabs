/**
 * RLS suite for the money/PII surface: orders, order_lines, order_coupons,
 * inquiries, inquiry_items, reward_vouchers, reward_ledger,
 * customer_profiles, customer_discounts, coupons, coupon_redemptions,
 * affiliates — plus the anon RPC contract of lookup_order (016→021→065/066:
 * status/tracking tier ONLY) and the service-role-only money RPCs.
 *
 * Complements tests/rls/portalIsolation.test.ts (migrations 043–045) without
 * touching it: this file owns the tables/RPCs that move or describe money and
 * the anon enumeration surface. Exercises real Postgres RLS + grants through
 * PostgREST — the only way to prove these invariants, since RLS cannot be
 * unit-tested in JS. Requires a LOCAL `supabase start` stack; see the header
 * guard below for how it's configured and how it skips.
 *
 * NEVER point this at a production project. As a safety net (in addition to
 * requiring all three env vars), the suite refuses to run unless
 * TEST_SUPABASE_URL resolves to a loopback host.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

function isLoopbackUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

const hasEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const canRun = hasEnv && isLoopbackUrl(SUPABASE_URL);

if (!hasEnv) {
  console.log(
    '[rls] Skipping money-path RLS suite: TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / ' +
      'TEST_SUPABASE_SERVICE_ROLE_KEY are not set. Run `supabase start` locally, then set ' +
      'those three env vars and re-run `npm run test`. See docs/INTEGRATION_TESTS.md.',
  );
} else if (!canRun) {
  console.log(
    `[rls] Skipping money-path RLS suite: TEST_SUPABASE_URL ("${SUPABASE_URL}") is not a ` +
      'loopback host. This suite only runs against a local Supabase stack — never point ' +
      'it at a hosted/production project.',
  );
}

/** Passes when either the query errored (permission denied) or returned zero
 *  rows — the two shapes "no access" can take depending on whether the table
 *  revokes the anon/authenticated grant outright or relies on RLS alone. */
function expectNoAccess<T>(res: { data: T[] | null; error: { message: string } | null }): void {
  if (res.error) {
    expect(res.error).toBeTruthy();
    return;
  }
  expect(res.data ?? []).toEqual([]);
}

function expectRpcDenied(res: { data: unknown; error: { message: string } | null }): void {
  expect(res.error).toBeTruthy();
}

describe.skipIf(!canRun)('Money-path RLS isolation + anon lookup contract', () => {
  const runId = randomUUID().slice(0, 8);
  // Constructed inside beforeAll (not here) — describe.skipIf still runs the
  // suite body during collection even when every test inside is skipped, so
  // eagerly calling createClient() here would throw when the env is unset.
  let service: SupabaseClient;

  const PASSWORD = `Rls-Money-${runId}!`;
  const emailA = `rlsm-a-${runId}@example.test`;
  const emailB = `rlsm-b-${runId}@example.test`;
  const trackZip = '90210';
  const trackContact = `rlsm-track-${runId}@example.test`;

  let userAId = '';
  let userBId = '';
  let orderAId = '';
  let orderBId = '';
  let trackOrderId = '';
  let trackOrderNumber = '';
  let trackInquiryId = '';
  let voucherAId = '';
  let voucherBId = '';
  let couponId = '';
  let affiliateId = '';
  const couponCode = `RLSM-${runId.toUpperCase()}`;

  let clientA: SupabaseClient;
  let clientAnon: SupabaseClient;

  function freshClient(): SupabaseClient {
    return createClient(SUPABASE_URL ?? '', ANON_KEY ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  beforeAll(async () => {
    service = createClient(SUPABASE_URL ?? '', SERVICE_ROLE_KEY ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Users (customer_profiles minted by the 028 signup trigger) ─────────
    const [a, b] = await Promise.all([
      service.auth.admin.createUser({
        email: emailA, password: PASSWORD, email_confirm: true,
        user_metadata: { full_name: 'RLS Money Customer A' },
      }),
      service.auth.admin.createUser({
        email: emailB, password: PASSWORD, email_confirm: true,
        user_metadata: { full_name: 'RLS Money Customer B' },
      }),
    ]);
    if (a.error || !a.data.user) throw new Error(`Failed to create customer A: ${a.error?.message}`);
    if (b.error || !b.data.user) throw new Error(`Failed to create customer B: ${b.error?.message}`);
    userAId = a.data.user.id;
    userBId = b.data.user.id;

    clientA = freshClient();
    clientAnon = freshClient();
    const signA = await clientA.auth.signInWithPassword({ email: emailA, password: PASSWORD });
    if (signA.error) throw new Error(`Customer A sign-in failed: ${signA.error.message}`);

    // ── Owned orders (A + B), each with a line and a coupon row ────────────
    // discount == Σ order_coupons.discount_cents so the 067 reconciliation
    // sweep (exercised by the integration tier against the same DB) never
    // classifies these fixtures as a mismatch.
    const [orderA, orderB] = await Promise.all([
      service.from('orders').insert({
        order_number: `RLSM-A-${runId}`, buyer_name: 'RLS Money Customer A',
        buyer_contact: emailA, user_id: userAId,
        subtotal_cents: 10_000, shipping_cents: 0, discount_cents: 500,
        invoice_amount_cents: 9_500,
      }).select('id').single(),
      service.from('orders').insert({
        order_number: `RLSM-B-${runId}`, buyer_name: 'RLS Money Customer B',
        buyer_contact: emailB, user_id: userBId,
        subtotal_cents: 20_000, shipping_cents: 0, discount_cents: 600,
        invoice_amount_cents: 19_400,
      }).select('id').single(),
    ]);
    if (orderA.error || !orderA.data) throw new Error(`Failed to seed order A: ${orderA.error?.message}`);
    if (orderB.error || !orderB.data) throw new Error(`Failed to seed order B: ${orderB.error?.message}`);
    orderAId = orderA.data.id as string;
    orderBId = orderB.data.id as string;

    const seeded = await Promise.all([
      service.from('order_lines').insert({
        order_id: orderAId, sku: 'RLSM-SKU', product_name: 'RLS Money Item', quantity: 1,
        unit_price_cents: 10_000,
      }),
      service.from('order_lines').insert({
        order_id: orderBId, sku: 'RLSM-SKU', product_name: 'RLS Money Item', quantity: 1,
        unit_price_cents: 20_000,
      }),
      service.from('order_coupons').insert({
        order_id: orderAId, code: couponCode, kind: 'percent', percent: 5, discount_cents: 500,
      }),
      service.from('order_coupons').insert({
        order_id: orderBId, code: couponCode, kind: 'percent', percent: 3, discount_cents: 600,
      }),
      service.from('reward_ledger').insert([
        { user_id: userAId, order_id: orderAId, kind: 'earn', points: 95, note: 'RLS money seed' },
        { user_id: userBId, order_id: orderBId, kind: 'earn', points: 194, note: 'RLS money seed' },
      ]),
      service.from('reward_vouchers').insert([
        { user_id: userAId, percent: 40, points_spent: 300, status: 'active' },
        { user_id: userBId, percent: 40, points_spent: 300, status: 'active' },
      ]).select('id, user_id'),
      service.from('customer_discounts').insert([
        { user_id: userAId, scope: 'lifetime', percent: 10, label: 'RLS Money 10%', active: true },
        { user_id: userBId, scope: 'lifetime', percent: 15, label: 'RLS Money 15%', active: true },
      ]),
    ]);
    for (const res of seeded) {
      if (res.error) throw new Error(`Failed to seed money fixtures: ${res.error.message}`);
    }
    const vouchers = seeded[5].data as Array<{ id: string; user_id: string }> | null;
    voucherAId = vouchers?.find((v) => v.user_id === userAId)?.id ?? '';
    voucherBId = vouchers?.find((v) => v.user_id === userBId)?.id ?? '';

    // ── Anon-track fixture: inquiry + joined order (lookup_order requires
    //    the inquiry join and a ship_zip) ────────────────────────────────────
    const inquiry = await service.from('inquiries').insert({
      reference_id: `VSR-REQ-RLSM-${runId}`, name: 'RLS Track Buyer',
      contact: trackContact, item_count: 1,
      ship_street: '1 Track Way', ship_city: 'Trackville', ship_state: 'CA',
      ship_zip: trackZip, ship_country: 'US',
    }).select('id').single();
    if (inquiry.error || !inquiry.data) throw new Error(`Failed to seed inquiry: ${inquiry.error?.message}`);
    trackInquiryId = inquiry.data.id as string;
    const items = await service.from('inquiry_items').insert({
      inquiry_id: trackInquiryId, sku: 'RLSM-SKU', product_name: 'RLS Money Item', quantity: 1,
    });
    if (items.error) throw new Error(`Failed to seed inquiry_items: ${items.error.message}`);

    trackOrderNumber = `RLSM-T-${runId}`;
    const trackOrder = await service.from('orders').insert({
      order_number: trackOrderNumber, inquiry_id: trackInquiryId, status: 'invoice_sent',
      buyer_name: 'RLS Track Buyer', buyer_contact: trackContact,
      ship_street: '1 Track Way', ship_city: 'Trackville', ship_state: 'CA',
      ship_zip: trackZip, ship_country: 'US',
      subtotal_cents: 5_000, shipping_cents: 999, invoice_amount_cents: 5_999,
    }).select('id').single();
    if (trackOrder.error || !trackOrder.data) throw new Error(`Failed to seed track order: ${trackOrder.error?.message}`);
    trackOrderId = trackOrder.data.id as string;

    // ── Coupon program rows (admin-only tables) ────────────────────────────
    const affiliate = await service.from('affiliates')
      .insert({ name: `RLS Money Affiliate ${runId}` }).select('id').single();
    if (affiliate.error || !affiliate.data) throw new Error(`Failed to seed affiliate: ${affiliate.error?.message}`);
    affiliateId = affiliate.data.id as string;
    const coupon = await service.from('coupons')
      .insert({ code: couponCode, kind: 'percent', percent: 5, affiliate_id: affiliateId })
      .select('id').single();
    if (coupon.error || !coupon.data) throw new Error(`Failed to seed coupon: ${coupon.error?.message}`);
    couponId = coupon.data.id as string;
    const redemption = await service.from('coupon_redemptions').insert({
      coupon_id: couponId, order_id: orderAId, code: couponCode,
      buyer_contact: emailA, discount_cents: 500, order_net_cents: 9_500,
    });
    if (redemption.error) throw new Error(`Failed to seed redemption: ${redemption.error.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!hasEnv) return;
    await service.from('coupon_redemptions').delete().eq('code', couponCode);
    if (couponId) await service.from('coupons').delete().eq('id', couponId);
    if (affiliateId) await service.from('affiliates').delete().eq('id', affiliateId);
    // orders cascade order_lines + order_coupons; inquiries cascade items.
    await service.from('orders').delete().in(
      'id',
      [orderAId, orderBId, trackOrderId].filter(Boolean),
    );
    if (trackInquiryId) await service.from('inquiries').delete().eq('id', trackInquiryId);
    // Best-effort: drop this run's lookup_order throttle buckets.
    await service.from('lookup_order_attempts').delete().like('bucket', `id:%${runId}%`);
    // Deleting the auth users cascades profiles, ledger, vouchers, discounts.
    await Promise.all(
      [userAId, userBId].filter(Boolean).map((id) => service.auth.admin.deleteUser(id)),
    );
  }, 30_000);

  // ── anon: every money/PII table reads as empty ────────────────────────────
  describe('anon gets nothing from any money/PII table', () => {
    test('orders — including lookup by order number without a token', async () => {
      expectNoAccess(await clientAnon.from('orders').select('*').eq('id', orderAId));
      expectNoAccess(
        await clientAnon.from('orders').select('*').eq('order_number', trackOrderNumber),
      );
    });

    test('order_lines / order_coupons', async () => {
      expectNoAccess(await clientAnon.from('order_lines').select('*').eq('order_id', orderAId));
      expectNoAccess(await clientAnon.from('order_coupons').select('*').eq('order_id', orderAId));
    });

    test('inquiries / inquiry_items (buyer PII + addresses)', async () => {
      expectNoAccess(await clientAnon.from('inquiries').select('*'));
      expectNoAccess(await clientAnon.from('inquiry_items').select('*'));
    });

    test('reward_vouchers / reward_ledger / customer_discounts', async () => {
      expectNoAccess(await clientAnon.from('reward_vouchers').select('*'));
      expectNoAccess(await clientAnon.from('reward_ledger').select('*'));
      expectNoAccess(await clientAnon.from('customer_discounts').select('*'));
    });

    test('customer_profiles (PII)', async () => {
      expectNoAccess(await clientAnon.from('customer_profiles').select('*'));
    });

    test('coupons / coupon_redemptions / affiliates (program + commission data)', async () => {
      expectNoAccess(await clientAnon.from('coupons').select('*'));
      expectNoAccess(await clientAnon.from('coupon_redemptions').select('*'));
      expectNoAccess(await clientAnon.from('affiliates').select('*'));
    });
  });

  // ── authed customer A: own rows only, and no back-office tables ──────────
  describe('customer A cannot cross the tenant boundary', () => {
    test('orders: own row visible, customer B row invisible', async () => {
      const own = await clientA.from('orders').select('id').eq('id', orderAId);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);
      expectNoAccess(await clientA.from('orders').select('*').eq('id', orderBId));
    });

    test('order_lines / order_coupons: customer B rows invisible', async () => {
      expectNoAccess(await clientA.from('order_lines').select('*').eq('order_id', orderBId));
      expectNoAccess(await clientA.from('order_coupons').select('*').eq('order_id', orderBId));
    });

    test('reward_vouchers: unfiltered select returns only own voucher', async () => {
      const res = await clientA.from('reward_vouchers').select('*');
      expect(res.error).toBeNull();
      expect(res.data?.length).toBeGreaterThan(0);
      expect(res.data?.every((row) => row.user_id === userAId)).toBe(true);
      expectNoAccess(await clientA.from('reward_vouchers').select('*').eq('id', voucherBId));
    });

    test('customer_profiles: only own profile; B profile invisible', async () => {
      const res = await clientA.from('customer_profiles').select('user_id');
      expect(res.error).toBeNull();
      expect(res.data?.every((row) => row.user_id === userAId)).toBe(true);
      expectNoAccess(await clientA.from('customer_profiles').select('*').eq('user_id', userBId));
    });

    test('reward_ledger / customer_discounts: only own rows', async () => {
      const ledger = await clientA.from('reward_ledger').select('user_id');
      expect(ledger.error).toBeNull();
      expect(ledger.data?.every((row) => row.user_id === userAId)).toBe(true);
      const discounts = await clientA.from('customer_discounts').select('user_id');
      expect(discounts.error).toBeNull();
      expect(discounts.data?.every((row) => row.user_id === userAId)).toBe(true);
    });

    test('back-office tables read as empty: inquiries, inquiry_items, coupons, coupon_redemptions, affiliates', async () => {
      expectNoAccess(await clientA.from('inquiries').select('*'));
      expectNoAccess(await clientA.from('inquiry_items').select('*'));
      expectNoAccess(await clientA.from('coupons').select('*'));
      expectNoAccess(await clientA.from('coupon_redemptions').select('*'));
      expectNoAccess(await clientA.from('affiliates').select('*'));
    });
  });

  // ── writes: customers cannot mutate money rows ────────────────────────────
  describe('customer A cannot write money rows', () => {
    test('cannot insert an order or an order_coupons row', async () => {
      const order = await clientA.from('orders').insert({
        order_number: `RLSM-EVIL-${runId}`, buyer_name: 'x', buyer_contact: 'x@example.test',
      });
      expect(order.error).toBeTruthy();
      const coupon = await clientA.from('order_coupons').insert({
        order_id: orderAId, code: 'EVIL', kind: 'fixed', amount_cents: 99_999,
      });
      expect(coupon.error).toBeTruthy();
    });

    test('cannot update own order money fields (no update policy)', async () => {
      const res = await clientA
        .from('orders')
        .update({ invoice_amount_cents: 1 })
        .eq('id', orderAId)
        .select('id');
      // RLS filters the update to zero rows (or errors outright).
      expectNoAccess(res);
      const check = await service.from('orders').select('invoice_amount_cents').eq('id', orderAId).single();
      expect(check.data?.invoice_amount_cents).toBe(9_500);
    });

    test('cannot mutate reward_vouchers (self-service voucher forgery)', async () => {
      const insert = await clientA.from('reward_vouchers').insert({
        user_id: userAId, percent: 90, points_spent: 1, status: 'active',
      });
      expect(insert.error).toBeTruthy();
      const update = await clientA
        .from('reward_vouchers')
        .update({ percent: 90 })
        .eq('id', voucherAId)
        .select('id');
      expectNoAccess(update);
      const check = await service.from('reward_vouchers').select('percent').eq('id', voucherAId).single();
      expect(check.data?.percent).toBe(40);
    });
  });

  // ── service-role-only money RPCs reject anon AND plain customers ─────────
  describe('service-role-only money RPCs are unreachable from clients', () => {
    test('redeem_coupon', async () => {
      const args = {
        p_code: couponCode, p_order_id: orderAId, p_contact: emailA,
        p_discount_cents: 1, p_order_net_cents: 1,
      };
      expectRpcDenied(await clientAnon.rpc('redeem_coupon', args));
      expectRpcDenied(await clientA.rpc('redeem_coupon', args));
    });

    test('consume_reward_voucher', async () => {
      const args = { p_voucher_id: voucherAId, p_order_id: orderAId };
      expectRpcDenied(await clientAnon.rpc('consume_reward_voucher', args));
      expectRpcDenied(await clientA.rpc('consume_reward_voucher', args));
    });

    test('reconcile_reward_vouchers', async () => {
      expectRpcDenied(await clientAnon.rpc('reconcile_reward_vouchers', { p_repair: true }));
      expectRpcDenied(await clientA.rpc('reconcile_reward_vouchers', { p_repair: true }));
    });

    test('recompute_order_totals', async () => {
      expectRpcDenied(await clientAnon.rpc('recompute_order_totals', { p_order_id: orderAId }));
      expectRpcDenied(await clientA.rpc('recompute_order_totals', { p_order_id: orderAId }));
    });

    test('create_order_from_inquiry rejects anon and non-admin customers', async () => {
      expectRpcDenied(
        await clientAnon.rpc('create_order_from_inquiry', { p_inquiry_id: trackInquiryId }),
      );
      expectRpcDenied(
        await clientA.rpc('create_order_from_inquiry', { p_inquiry_id: trackInquiryId }),
      );
    });
  });

  // ── anon lookup_order: status/tracking tier ONLY (016→018 lesson) ─────────
  describe('anon lookup_order exposes only the status/tracking tier', () => {
    test('a correct identifier+ZIP returns exactly the 7 declared columns', async () => {
      const res = await clientAnon.rpc('lookup_order', {
        p_identifier: trackOrderNumber, p_zip: trackZip,
      });
      expect(res.error).toBeNull();
      const rows = res.data as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      const row = rows[0];
      // The whole 016→018 exposure incident, pinned: no amounts, no buyer
      // fields, no address, no lookup_token — ever.
      expect(Object.keys(row).sort()).toEqual([
        'carrier', 'delivered_at', 'order_number', 'placed_at',
        'shipped_at', 'status', 'tracking_number',
      ]);
      expect(row.order_number).toBe(trackOrderNumber);
      expect(row.status).toBe('awaiting_payment'); // mapped, not the raw enum
      // Tracking fields stay null before shipment.
      expect(row.carrier).toBeNull();
      expect(row.tracking_number).toBeNull();
    });

    test('the buyer contact works as identifier — same limited shape', async () => {
      const res = await clientAnon.rpc('lookup_order', {
        p_identifier: trackContact, p_zip: trackZip,
      });
      expect(res.error).toBeNull();
      const rows = res.data as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].order_number).toBe(trackOrderNumber);
    });

    test('a wrong ZIP or unknown identifier yields zero rows (no oracle)', async () => {
      const wrongZip = await clientAnon.rpc('lookup_order', {
        p_identifier: trackOrderNumber, p_zip: '00000',
      });
      expect(wrongZip.error).toBeNull();
      expect(wrongZip.data).toEqual([]);

      const unknown = await clientAnon.rpc('lookup_order', {
        p_identifier: `RLSM-NOPE-${runId}`, p_zip: trackZip,
      });
      expect(unknown.error).toBeNull();
      expect(unknown.data).toEqual([]);
    });

    test('get_order_by_token yields nothing for a wrong token', async () => {
      const res = await clientAnon.rpc('get_order_by_token', { p_token: 'not-a-real-token' });
      expect(res.error).toBeNull();
      expect(res.data).toBeNull();
    });
  });
});
