/**
 * Orchestration tests — send-processing-notification (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/
 * notificationFnsHarness) and pins every decision path: CORS preflight, the
 * admin gate, method/env gates, JSON parsing, payload validation, the order
 * re-read + paid-status gate, the non-email skip, order_lines failure, the
 * email send (content + escaping), and the exact response contracts.
 */
import { describe, expect, test } from 'vitest';
import {
  callFn,
  makeProcessingHarness,
  ORDER_LINES,
  processingOrderRow,
  TEST_CORS,
  withOrder,
} from '../helpers/notificationFnsHarness';

const PAYLOAD = { order_id: 'order-1' };

describe('request gates', () => {
  test('OPTIONS preflight returns 204 with the CORS headers and skips the admin gate', async () => {
    const h = makeProcessingHarness();
    const { status, response } = await callFn(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.adminGateCalls).toHaveLength(0);
    expect(h.db.queries).toHaveLength(0);
  });

  test('a failed admin gate returns its body + status verbatim and touches nothing', async () => {
    const h = makeProcessingHarness();
    h.adminGateResult = { ok: false, status: 401, body: { error: 'Unauthorized' } };
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('non-POST methods are refused with 405 once the gate passes', async () => {
    const h = makeProcessingHarness();
    const { status, body } = await callFn(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed.');
  });

  test('missing Resend key fails closed with 500 before any work', async () => {
    const h = makeProcessingHarness({ resendApiKey: '' });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(500);
    expect(body.error).toBe('Email service not configured.');
    expect(h.db.queries).toHaveLength(0);
  });

  test.each([
    ['supabaseUrl', { supabaseUrl: '' }],
    ['supabaseServiceKey', { supabaseServiceKey: '' }],
  ] as const)('missing %s fails closed with 500', async (_label, overrides) => {
    const h = makeProcessingHarness(overrides);
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(500);
    expect(body.error).toBe('Database service not configured.');
  });

  test('unparseable JSON body is a 400', async () => {
    const h = makeProcessingHarness();
    const { status, body } = await callFn(h, undefined, { rawBody: 'not json {' });
    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body.');
  });

  test('missing order_id is a 400', async () => {
    const h = makeProcessingHarness();
    const { status, body } = await callFn(h, {});
    expect(status).toBe(400);
    expect(body.error).toBe('order_id is required.');
    expect(h.db.queries).toHaveLength(0);
  });
});

describe('order re-read + gates', () => {
  test('an order read error is a 404', async () => {
    const h = makeProcessingHarness();
    h.db.on('orders', 'select', { error: { message: 'boom' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(404);
    expect(body.error).toBe('Order not found.');
  });

  test('a non-paid order is a 409 naming the actual status', async () => {
    const h = withOrder(makeProcessingHarness(), processingOrderRow({ status: 'invoice_sent' }));
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(409);
    expect(body.error).toBe('Order status is invoice_sent; expected paid.');
    expect(h.emails).toHaveLength(0);
  });

  test('a non-email buyer contact skips with ok:false before reading lines', async () => {
    const h = withOrder(makeProcessingHarness(), processingOrderRow({ buyer_contact: '555-0100' }));
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      skipped: true,
      reason: 'Buyer contact is not an email address; processing notification skipped.',
    });
    expect(h.db.of('order_lines')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('an order_lines read failure is a 502 carrying the db message', async () => {
    const h = makeProcessingHarness();
    h.db.on('orders', 'select', { data: processingOrderRow() });
    h.db.on('order_lines', 'select', { error: { message: 'lines exploded' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(502);
    expect(body.error).toBe('Failed to load order lines: lines exploded');
    expect(h.emails).toHaveLength(0);
  });
});

describe('email send', () => {
  test('happy path emails the buyer and returns ok + orderNumber', async () => {
    const h = withOrder(makeProcessingHarness(), processingOrderRow());
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, orderNumber: 'VSR-ORD-260718-001' });

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.to).toBe('buyer@test.example');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.subject).toBe('Payment received, order processing — VSR-ORD-260718-001');
    expect(email.html).toContain('Payment received — your order is now processing.');
    expect(email.html).toContain(ORDER_LINES[0].sku);
    expect(email.html).toContain('BPC-157 — 5mg');
  });

  test('an empty buyer name falls back to "there"', async () => {
    const h = withOrder(makeProcessingHarness(), processingOrderRow({ buyer_name: '' }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain('Hi there,');
  });

  test('user-controlled fields are HTML-escaped in the email', async () => {
    const h = withOrder(
      makeProcessingHarness(),
      processingOrderRow({ buyer_name: '<b>Bold</b>' }),
      [{ sku: 'SK<U>', product_name: 'Item "A" & \'B\'', quantity: 1 }],
    );
    await callFn(h, PAYLOAD);
    const html = h.emails[0].html;
    expect(html).not.toContain('<b>Bold</b>');
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;');
    expect(html).toContain('SK&lt;U&gt;');
    expect(html).toContain('Item &quot;A&quot; &amp; &#39;B&#39;');
  });

  test('a Resend failure is a 502 with the provider body as detail', async () => {
    const h = withOrder(makeProcessingHarness(), processingOrderRow());
    h.emailResponder = () => ({ status: 500, body: { message: 'resend down' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(502);
    expect(body.error).toBe('Email delivery failed.');
    expect(body.detail).toEqual({ message: 'resend down' });
  });
});
