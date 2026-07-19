/**
 * Orchestration tests — place-order request boundary (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/placeOrderHarness)
 * and pins the request-level decision paths: method gate, env guards, JSON
 * parsing, turnstile, payload validation hand-off, idempotency short-circuit,
 * the rate limit, and the full happy guest checkout (response shape + the
 * exact rows and emails it produces).
 */
import { describe, expect, test } from 'vitest';
import {
  BPC_PRICE_CENTS,
  basePayload,
  makeHarness,
  placeOrder,
  queryHas,
  TEST_CORS,
  withCatalog,
} from '../helpers/placeOrderHarness';
import { GUEST_SHIPPING_CENTS } from '../../supabase/functions/place-order/orderShipping';

describe('request gates', () => {
  test('OPTIONS preflight returns 204 with the CORS headers and touches nothing', async () => {
    const h = makeHarness();
    const { status, response } = await placeOrder(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('non-POST methods are refused with 405', async () => {
    const h = makeHarness();
    const { status, body } = await placeOrder(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed.');
  });

  test('missing Resend key fails closed with 500 before any work', async () => {
    const h = makeHarness({ resendApiKey: '' });
    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(500);
    expect(body.error).toBe('Email service not configured.');
    expect(h.db.queries).toHaveLength(0);
  });

  test.each([
    ['supabaseUrl', { supabaseUrl: '' }],
    ['supabaseServiceKey', { supabaseServiceKey: '' }],
  ] as const)('missing %s fails closed with 500', async (_label, overrides) => {
    const h = makeHarness(overrides);
    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(500);
    expect(body.error).toBe('Database service not configured.');
  });

  test('unparseable JSON body is a 400', async () => {
    const h = makeHarness();
    const { status, body } = await placeOrder(h, undefined, { rawBody: 'not json {' });
    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body.');
  });

  test('failed turnstile verification is a 403 carrying the reason', async () => {
    const h = makeHarness();
    h.turnstileResult = { ok: false, reason: 'Bot check failed.' };
    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(403);
    expect(body.error).toBe('Bot check failed.');
    expect(h.db.queries).toHaveLength(0);
  });

  test('failed turnstile without a reason falls back to the generic message', async () => {
    const h = makeHarness();
    h.turnstileResult = { ok: false };
    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(403);
    expect(body.error).toBe('Verification failed.');
  });

  test('payload validation rejects with the boundary message + status', async () => {
    const h = makeHarness();
    const { status, body } = await placeOrder(h, basePayload({ name: '   ' }));
    expect(status).toBe(400);
    expect(body.error).toBe('Name is required.');
    expect(h.db.queries).toHaveLength(0);
  });
});

describe('idempotency short-circuit', () => {
  const KEY = '123e4567-e89b-42d3-a456-426614174000';

  test('a seen idempotency key returns the original order, no new rows, no emails', async () => {
    const h = withCatalog(makeHarness());
    h.db.on(
      'orders',
      'select',
      {
        data: {
          order_number: 'VSR-ORD-260701-001',
          created_at: '2026-07-01T00:00:00.000Z',
          invoice_amount_cents: 5998,
          inquiry_id: 'inq-orig',
        },
      },
      (q) => queryHas(q, 'eq', 'idempotency_key', KEY),
    );
    h.db.on(
      'inquiries',
      'select',
      { data: { reference_id: 'VSR-REF-ORIG' } },
      (q) => queryHas(q, 'eq', 'id', 'inq-orig'),
    );

    const { status, body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      duplicate: true,
      orderNumber: 'VSR-ORD-260701-001',
      referenceId: 'VSR-REF-ORIG',
      amountCents: 5998,
      invoiceEmailSent: true,
      contactIsEmail: true,
    });
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
    expect(h.db.of('inquiries', 'insert')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('a duplicate whose original lost its inquiry row returns an empty referenceId', async () => {
    const h = makeHarness();
    h.db.on(
      'orders',
      'select',
      {
        data: {
          order_number: 'VSR-ORD-260701-002',
          created_at: '2026-07-01T00:00:00.000Z',
          invoice_amount_cents: null,
          inquiry_id: null,
        },
      },
      (q) => queryHas(q, 'eq', 'idempotency_key', KEY),
    );
    const { body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(body.duplicate).toBe(true);
    expect(body.referenceId).toBe('');
    expect(body.amountCents).toBe(0);
  });

  test('a duplicate whose original inquiry row carries a null reference_id returns an empty referenceId', async () => {
    const h = makeHarness();
    h.db.on(
      'orders',
      'select',
      {
        data: {
          order_number: 'VSR-ORD-260701-003',
          created_at: '2026-07-01T00:00:00.000Z',
          invoice_amount_cents: 5998,
          inquiry_id: 'inq-orig',
        },
      },
      (q) => queryHas(q, 'eq', 'idempotency_key', KEY),
    );
    h.db.on(
      'inquiries',
      'select',
      { data: { reference_id: null } },
      (q) => queryHas(q, 'eq', 'id', 'inq-orig'),
    );
    const { body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(body.duplicate).toBe(true);
    expect(body.referenceId).toBe('');
  });

  test('a malformed idempotency key is ignored — checkout proceeds and the key is not stored', async () => {
    const h = withCatalog(makeHarness());
    const { status, body } = await placeOrder(
      h,
      basePayload({ idempotency_key: 'not-a-uuid' }),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.duplicate).toBeUndefined();
    // No idempotency lookup ran, and the order row stored a null key.
    const lookups = h.db
      .of('orders', 'select')
      .filter((q) => queryHas(q, 'eq', 'idempotency_key'));
    expect(lookups).toHaveLength(0);
    const orderInsert = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(orderInsert.idempotency_key).toBeNull();
  });
});

describe('rate limit', () => {
  test('the 5th checkout in an hour from one contact is a 429', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('inquiries', 'select', { count: 5 }, (q) => q.isCount);
    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(429);
    expect(body.error).toBe(
      'Too many orders from this contact. Please wait before trying again.',
    );
    expect(h.db.of('inquiries', 'insert')).toHaveLength(0);
  });

  test('a null count from the rate-limit read is treated as zero — checkout proceeds', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('inquiries', 'select', { data: null, count: null }, (q) => q.isCount);
    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('the contact bucket is matched case-insensitively with LIKE metacharacters escaped', async () => {
    const h = withCatalog(makeHarness());
    await placeOrder(h, basePayload({ contact: 'Bu%y_er@test.example' }));
    const countQuery = h.db.of('inquiries', 'select').find((q) => q.isCount);
    expect(countQuery).toBeDefined();
    const ilike = countQuery!.calls.find((c) => c.method === 'ilike');
    expect(ilike?.args).toEqual(['contact', 'Bu\\%y\\_er@test.example']);
  });
});

describe('happy guest checkout', () => {
  test('creates inquiry + order + lines, sends both emails, returns the order summary', async () => {
    const h = withCatalog(makeHarness());
    const { status, body } = await placeOrder(h, basePayload());

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.contactIsEmail).toBe(true);
    expect(body.invoiceEmailSent).toBe(true);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(typeof body.orderNumber).toBe('string');
    expect(typeof body.referenceId).toBe('string');

    // Inquiry row carries the buyer + address and the REVIEWING status.
    const inquiry = h.db.of('inquiries', 'insert')[0].payload as Record<string, unknown>;
    expect(inquiry).toMatchObject({
      name: 'Test Buyer',
      contact: 'buyer@test.example',
      status: 'REVIEWING',
      item_count: 1,
      ship_city: 'Lab City',
    });

    // Order row: guest semantics — flat shipping, no user_id, no discounts.
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order).toMatchObject({
      status: 'invoice_sent',
      subtotal_cents: BPC_PRICE_CENTS,
      shipping_cents: GUEST_SHIPPING_CENTS,
      discount_cents: 0,
      coupon_code: null,
      invoice_amount_cents: BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS,
      payment_method: 'Zelle (zelle@test.example)',
    });
    expect(order.user_id).toBeUndefined();

    // One order line, priced from the cart, fast flag snapshotted.
    const lines = h.db.of('order_lines', 'insert')[0].payload as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      order_id: 'order-1',
      sku: 'VSR-RS-BPC',
      quantity: 1,
      unit_price_cents: BPC_PRICE_CENTS,
      fast_ship: true,
    });

    // Buyer invoice first, business notification second.
    expect(h.emails).toHaveLength(2);
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[0].reply_to).toBe('biz@test.example');
    expect(h.emails[1].to).toBe('biz@test.example');
    expect(h.emails[1].subject).toContain('New order');
    expect(h.emails[1].subject).not.toContain('⚠');
    expect(h.emails[1].reply_to).toBe('buyer@test.example');
    // The operator action block names the Zelle handle and payment code.
    expect(h.emails[1].html).toContain('zelle@test.example');

    // Clean order → no order_events warning, no alerts, success telemetry.
    expect(h.db.of('order_events', 'insert')).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
    expect(h.logs.some((l) => l.message === 'Order placed')).toBe(true);
  });

  test('a phone contact gets no buyer invoice and the business email has no reply-to', async () => {
    const h = withCatalog(makeHarness());
    const { status, body } = await placeOrder(h, basePayload({ contact: '555-0100' }));
    expect(status).toBe(200);
    expect(body.contactIsEmail).toBe(false);
    expect(body.invoiceEmailSent).toBe(false);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe('biz@test.example');
    expect(h.emails[0].reply_to).toBeUndefined();
  });
});
