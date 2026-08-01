/**
 * Converting a prepared cart into a real order (migration 083) against a REAL
 * local Postgres.
 *
 * THE INCIDENT. A prepared cart only becomes an order if the MEMBER checks out.
 * When they pay the owner directly (Zelle, off-site) and never do, no order
 * exists — nothing to fulfil, invoice or mark paid. That was discovered after a
 * real client had already paid. `admin_convert_prepared_cart` closes it, and
 * every property below is one this feature would be unsafe without:
 *
 *   • THE ORDER IS OWNED. `orders.user_id` must carry the member's id. `+ New
 *     order` has never set it, and two things hang off it: mark_order_paid
 *     (044) mints reward points only `if v_user_id is not null`, and the portal
 *     shows own-orders through an RLS policy of `user_id = auth.uid()`. This is
 *     asserted END TO END — the order is invoiced, marked paid, and the reward
 *     ledger checked — because the column being non-null is only interesting
 *     for what it makes happen. A mock cannot prove any of it: the points mint
 *     inside a SECURITY DEFINER body reading a column the RPC set.
 *
 *   • THE OWNER'S PRICE IS THE RECORDED PRICE. He is reconciling against money
 *     already in hand, so an admin-set unit price and an admin-set discount must
 *     survive into order_lines / order_coupons / orders.invoice_amount_cents
 *     unchanged. This is the opposite of place-order's rule, which fails closed
 *     on any client-supplied price — and precisely why this path does not go
 *     through place-order.
 *
 *   • ONE CART, ONE ORDER. A second conversion must not write a second order
 *     against one payment. The guard is a `for update` read of converted_at
 *     inside the RPC, so only a real transaction can prove it.
 *
 *   • AND THE MEMBER CANNOT ALSO BUY IT. Converting revokes the link in the
 *     SAME transaction; otherwise the member could still open the cart they
 *     already paid for and check out a second time. Proven by calling
 *     `claim_prepared_cart` as the member afterwards with the real token.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts.
 * NEVER point this at production — it creates and deletes auth users, prepared
 * carts, orders and reward ledger rows.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';
import { convertTotals, type ConvertLine, type DiscountDraft } from '../../src/lib/convertPreparedCart';

logSkipReason('prepared-cart conversion suite');

const ADMIN_ONLY = /Unauthorized: admin role required/i;

interface CreatedCart { cart_id: string; token: string }
interface ConvertOk { ok: true; order_id: string; order_number: string; total_cents: number }
interface ConvertNo { ok: false; reason: string; order_id: string | null; order_number: string | null }

/** The lines the UI would send — catalog names, admin-set unit prices. */
const LINES: ConvertLine[] = [
  { sku: 'VSR-RS-BPC', dose: '10mg', name: 'BPC-157 — 10mg', quantity: 2, unitPriceCents: 12_000 },
  { sku: 'VSR-RS-RETA', dose: '15mg', name: 'Retatrutide — 15mg', quantity: 1, unitPriceCents: 24_500 },
];

const linesPayload = LINES.map((l) => ({
  sku: l.sku, product_name: l.name, quantity: l.quantity, unit_price_cents: l.unitPriceCents, item_note: null,
}));

describe.skipIf(!canRun)('convert prepared cart to order (real DB, migration 083)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let member: SupabaseClient;
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

  async function convert(cartId: string, discount: unknown = null) {
    const res = await admin.rpc('admin_convert_prepared_cart', {
      p_cart_id: cartId,
      p_buyer_name: 'Prepared Cart Member',
      p_buyer_contact: `member-cv-${runId}@example.test`,
      p_buyer_organization: 'Velari Lab',
      p_notes: 'Paid by Zelle before checkout',
      p_lines: linesPayload,
      p_discount: discount,
    });
    const body = res.data as ConvertOk | ConvertNo | null;
    if (body && 'ok' in body && body.ok) createdOrderIds.push(body.order_id);
    return { error: res.error, body };
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // The RPCs authorize by an active admin_users row for the CALLING auth
    // user; the service-role key bypasses RLS but is not an admin user. Same
    // arrangement as preparedCarts.test.ts.
    const adminEmail = `admin-cv-${runId}@example.test`;
    const adminPw = `Admin-${runId}-Aa1!`;
    const adminCreated = await service.auth.admin.createUser({ email: adminEmail, password: adminPw, email_confirm: true });
    if (adminCreated.error || !adminCreated.data.user) throw new Error(`admin createUser failed: ${adminCreated.error?.message}`);
    adminUserId = adminCreated.data.user.id;
    const adminRow = await service.from('admin_users').insert({ user_id: adminUserId, email: adminEmail, active: true });
    if (adminRow.error) throw new Error(`admin_users insert failed: ${adminRow.error.message}`);
    admin = anonClient();
    const adminSignIn = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPw });
    if (adminSignIn.error) throw new Error(`admin sign-in failed: ${adminSignIn.error.message}`);

    const memberEmail = `member-cv-${runId}@example.test`;
    const memberPw = `Member-${runId}-Aa1!`;
    const memberCreated = await service.auth.admin.createUser({ email: memberEmail, password: memberPw, email_confirm: true });
    if (memberCreated.error || !memberCreated.data.user) throw new Error(`member createUser failed: ${memberCreated.error?.message}`);
    memberUserId = memberCreated.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: memberUserId, full_name: 'Prepared Cart Member', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);

    member = anonClient();
    const memberSignIn = await member.auth.signInWithPassword({ email: memberEmail, password: memberPw });
    if (memberSignIn.error) throw new Error(`member sign-in failed: ${memberSignIn.error.message}`);
  });

  afterAll(async () => {
    for (const id of createdOrderIds) {
      await service.from('audit_log').delete().eq('entity_id', id);
      await service.from('orders').delete().eq('id', id);
    }
    if (memberUserId) {
      await service.from('reward_ledger').delete().eq('user_id', memberUserId);
      await service.from('prepared_carts').delete().eq('user_id', memberUserId);
      await service.from('audit_log').delete().eq('entity_id', memberUserId);
      await service.from('customer_profiles').delete().eq('user_id', memberUserId);
      await service.auth.admin.deleteUser(memberUserId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  /* ── The gate ───────────────────────────────────────────────────────────── */

  test('a signed-in non-admin holds the grant but is refused by the body guard', async () => {
    const cart = await newCart();
    const res = await member.rpc('admin_convert_prepared_cart', {
      p_cart_id: cart.cart_id,
      p_buyer_name: 'Me', p_buyer_contact: 'me@example.test',
      p_lines: linesPayload, p_discount: null,
    });

    expect(res.error?.message ?? '').toMatch(ADMIN_ONLY);
  });

  test('anon cannot call it at all — the ACL, not the guard', async () => {
    const res = await anon.rpc('admin_convert_prepared_cart', {
      p_cart_id: randomUUID(),
      p_buyer_name: 'Me', p_buyer_contact: 'me@example.test',
      p_lines: linesPayload, p_discount: null,
    });

    expect(res.error).not.toBeNull();
    expect(res.error?.message ?? '').not.toMatch(ADMIN_ONLY);
  });

  /* ── The regression: the order is OWNED ─────────────────────────────────── */

  test('the created order carries the member as user_id', async () => {
    const cart = await newCart();
    const { error, body } = await convert(cart.cart_id);

    expect(error).toBeNull();
    expect((body as ConvertOk).ok).toBe(true);

    const { data } = await service
      .from('orders')
      .select('user_id, status, order_number')
      .eq('id', (body as ConvertOk).order_id)
      .single();

    expect(data?.user_id).toBe(memberUserId);
    expect(data?.status).toBe('pending_invoice');
    expect(data?.order_number).toBe((body as ConvertOk).order_number);
  });

  test('because user_id is stamped, marking the order paid mints reward points', async () => {
    // The reason the column matters. mark_order_paid (044) is gated on
    // `v_user_id is not null`; with the old admin path the member earned
    // nothing on an order they had actually paid for.
    const cart = await newCart();
    const { body } = await convert(cart.cart_id);
    const orderId = (body as ConvertOk).order_id;
    const total = (body as ConvertOk).total_cents;

    // The 6-argument form on purpose: 003 and 010 both define
    // mark_order_invoiced and PostgREST cannot choose between them from a
    // 3-name call (PGRST203). Pre-existing overload ambiguity, unrelated to 083
    // — named here so the next reader does not mistake it for a bug in this
    // suite. (083 drops the old admin_create_order signature rather than
    // leaving the same trap behind.)
    const invoiced = await admin.rpc('mark_order_invoiced', {
      p_order_id: orderId,
      p_invoice_url: 'https://example.test/invoice',
      p_invoice_amount_cents: total,
      p_payment_method: 'Zelle',
      p_subtotal_cents: null,
      p_shipping_cents: null,
    });
    expect(invoiced.error).toBeNull();
    const paid = await admin.rpc('mark_order_paid', { p_order_id: orderId });
    expect(paid.error).toBeNull();

    const { data } = await service
      .from('reward_ledger')
      .select('points, kind')
      .eq('order_id', orderId)
      .eq('kind', 'earn');

    expect(data).toHaveLength(1);
    expect(data?.[0].points).toBe(Math.floor(total / 100));
  });

  test("the plain `+ New order` call shape still resolves after 083 widened admin_create_order", async () => {
    // AdminNewOrder.tsx sends exactly these five names. 083 appended p_user_id
    // and p_discount with defaults and DROPPED the old 5-argument signature —
    // had it left both in place, PostgREST would refuse a 5-name call as
    // ambiguous (PGRST203, the state mark_order_invoiced is in) and the whole
    // `+ New order` screen would be dead. This is that regression guard.
    const res = await admin.rpc('admin_create_order', {
      p_buyer_name: 'Offline Buyer',
      p_buyer_contact: `offline-${runId}@example.test`,
      p_buyer_organization: null,
      p_notes: null,
      p_lines: linesPayload,
    });

    expect(res.error).toBeNull();
    const orderId = (res.data as { order_id: string }).order_id;
    createdOrderIds.push(orderId);

    // And it still means what it meant: no account behind it, so no owner.
    const { data } = await service.from('orders').select('user_id').eq('id', orderId).single();
    expect(data?.user_id).toBeNull();
  });

  /* ── The owner's numbers are the record ─────────────────────────────────── */

  test('an admin-set unit price is recorded as given, not re-priced to the catalog', async () => {
    const cart = await newCart();
    const { body } = await convert(cart.cart_id);

    const { data } = await service
      .from('order_lines')
      .select('sku, product_name, quantity, unit_price_cents')
      .eq('order_id', (body as ConvertOk).order_id)
      .order('sku');

    expect(data).toEqual([
      { sku: 'VSR-RS-BPC', product_name: 'BPC-157 — 10mg', quantity: 2, unit_price_cents: 12_000 },
      { sku: 'VSR-RS-RETA', product_name: 'Retatrutide — 15mg', quantity: 1, unit_price_cents: 24_500 },
    ]);
  });

  test('the confirmation total equals the total the order records (percent discount)', async () => {
    // 48,500 subtotal × 15% = 7,275.00 exactly. The figure the owner confirms
    // and the figure the order carries must be the same integer.
    const discount: DiscountDraft = { kind: 'percent', percent: 15, amountCents: 0, code: 'MEMBER15' };
    const expected = convertTotals(LINES, discount);

    const cart = await newCart();
    const { body } = await convert(cart.cart_id, { kind: 'percent', percent: 15, code: 'MEMBER15' });

    expect((body as ConvertOk).total_cents).toBe(expected.totalCents);

    const { data } = await service
      .from('orders')
      .select('subtotal_cents, discount_cents, invoice_amount_cents')
      .eq('id', (body as ConvertOk).order_id)
      .single();

    expect(data?.subtotal_cents).toBe(expected.subtotalCents);
    expect(data?.discount_cents).toBe(expected.discountCents);
    expect(data?.invoice_amount_cents).toBe(expected.totalCents);
  });

  test('an admin-set fixed discount lands as one account-sourced coupon row', async () => {
    const discount: DiscountDraft = { kind: 'fixed', percent: 0, amountCents: 6_000, code: 'ZELLE AGREED' };
    const expected = convertTotals(LINES, discount);

    const cart = await newCart();
    const { body } = await convert(cart.cart_id, { kind: 'fixed', amount_cents: 6_000, code: 'ZELLE AGREED' });

    const { data } = await service
      .from('order_coupons')
      .select('code, kind, amount_cents, discount_cents, source')
      .eq('order_id', (body as ConvertOk).order_id);

    expect(data).toEqual([
      { code: 'ZELLE AGREED', kind: 'fixed', amount_cents: 6_000, discount_cents: 6_000, source: 'account' },
    ]);
    expect((body as ConvertOk).total_cents).toBe(expected.totalCents);
  });

  test('a malformed discount fails loudly instead of rounding to something plausible', async () => {
    const cart = await newCart();
    const res = await admin.rpc('admin_convert_prepared_cart', {
      p_cart_id: cart.cart_id,
      p_buyer_name: 'Prepared Cart Member', p_buyer_contact: 'x@example.test',
      p_lines: linesPayload,
      p_discount: { kind: 'percent', percent: 140, code: 'TOO MUCH' },
    });

    expect(res.error?.message ?? '').toMatch(/percent must be above 0 and at most 100/i);

    // And nothing was written — the cart is still convertible.
    const { data } = await service.from('prepared_carts').select('converted_at').eq('id', cart.cart_id).single();
    expect(data?.converted_at).toBeNull();
  });

  /* ── One cart, one order ────────────────────────────────────────────────── */

  test('a converted cart cannot be converted twice', async () => {
    const cart = await newCart();
    const first = await convert(cart.cart_id);
    expect((first.body as ConvertOk).ok).toBe(true);

    const second = await convert(cart.cart_id);

    expect(second.error).toBeNull();
    const body = second.body as ConvertNo;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('already_converted');
    // It hands back the order it already became, so the owner is told what
    // happened rather than that nothing did.
    expect(body.order_id).toBe((first.body as ConvertOk).order_id);
    expect(body.order_number).toBe((first.body as ConvertOk).order_number);

    // Exactly ONE order exists for this cart — not two against one payment.
    const { data } = await service.from('orders').select('id').eq('user_id', memberUserId).eq('order_number', body.order_number ?? '');
    expect(data).toHaveLength(1);
  });

  test('a cart that does not exist is a calm no-op, not an exception', async () => {
    const res = await admin.rpc('admin_convert_prepared_cart', {
      p_cart_id: randomUUID(),
      p_buyer_name: 'Prepared Cart Member', p_buyer_contact: 'x@example.test',
      p_lines: linesPayload, p_discount: null,
    });

    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ ok: false, reason: 'not_found' });
  });

  /* ── The member cannot also claim it ────────────────────────────────────── */

  test('converting revokes the link, so the member cannot claim and buy the cart again', async () => {
    const cart = await newCart();

    // It opens before conversion — otherwise the assertion after it proves
    // nothing about conversion.
    const before = await member.rpc('claim_prepared_cart', { p_token: cart.token });
    expect(before.error).toBeNull();
    expect(before.data).toMatchObject({ ok: true });

    await convert(cart.cart_id);

    const after = await member.rpc('claim_prepared_cart', { p_token: cart.token });
    expect(after.error).toBeNull();
    expect((after.data as { ok: boolean }).ok).toBe(false);

    const { data } = await service
      .from('prepared_carts')
      .select('converted_at, converted_order_id, revoked_at')
      .eq('id', cart.cart_id)
      .single();

    expect(data?.converted_at).not.toBeNull();
    expect(data?.converted_order_id).not.toBeNull();
    expect(data?.revoked_at).not.toBeNull();
  });

  /* ── What the panel reads back ──────────────────────────────────────────── */

  test("admin_prepared_carts reports 'converted' with the order number, not merely 'revoked'", async () => {
    const cart = await newCart();
    const { body } = await convert(cart.cart_id);

    const res = await admin.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 100 });
    expect(res.error).toBeNull();

    const rows = (res.data as { rows: Array<{ id: string; status: string; converted_order_number: string | null }> }).rows;
    const row = rows.find((r) => r.id === cart.cart_id);

    // Converting also revokes, so 'converted' only wins if it is checked first.
    expect(row?.status).toBe('converted');
    expect(row?.converted_order_number).toBe((body as ConvertOk).order_number);
  });

  test('the conversion is written to the audit log', async () => {
    const cart = await newCart();
    const { body } = await convert(cart.cart_id);

    const { data } = await service
      .from('audit_log')
      .select('action, entity_type, entity_id, summary')
      .eq('entity_id', memberUserId)
      .eq('action', 'member.prepared_cart.converted');

    expect(data?.length ?? 0).toBeGreaterThan(0);
    expect(data?.some((r) => (r.summary as string).includes((body as ConvertOk).order_number))).toBe(true);
  });
});
