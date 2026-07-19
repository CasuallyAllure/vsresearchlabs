/**
 * Orchestration tests — send-shipment-notification (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/
 * notificationFnsHarness) and pins every decision path: CORS preflight, the
 * admin gate, method/env gates, JSON parsing, payload validation, the order
 * re-read + status gate, the non-email skip, order_lines failure, the email
 * send (content, escaping, carrier/tracking variants), and the exact
 * response contracts.
 */
import { describe, expect, test } from 'vitest';
import {
  callFn,
  makeShipmentHarness,
  ORDER_LINES,
  shipmentOrderRow,
  TEST_CORS,
  withOrder,
} from '../helpers/notificationFnsHarness';

const PAYLOAD = { order_id: 'order-1' };

describe('request gates', () => {
  test('OPTIONS preflight returns 204 with the CORS headers and skips the admin gate', async () => {
    const h = makeShipmentHarness();
    const { status, response } = await callFn(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.adminGateCalls).toHaveLength(0);
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('a failed admin gate returns its body + status verbatim and touches nothing', async () => {
    const h = makeShipmentHarness();
    h.adminGateResult = { ok: false, status: 401, body: { error: 'Unauthorized' } };
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('the admin gate runs BEFORE the method check — a GET with a failing gate is 401, not 405', async () => {
    const h = makeShipmentHarness();
    h.adminGateResult = { ok: false, status: 401, body: { error: 'Unauthorized' } };
    const { status } = await callFn(h, undefined, { method: 'GET' });
    expect(status).toBe(401);
    expect(h.adminGateCalls).toHaveLength(1);
  });

  test('non-POST methods are refused with 405 once the gate passes', async () => {
    const h = makeShipmentHarness();
    const { status, body } = await callFn(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed.');
  });

  test('missing Resend key fails closed with 500 before any work', async () => {
    const h = makeShipmentHarness({ resendApiKey: '' });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(500);
    expect(body.error).toBe('Email service not configured.');
    expect(h.db.queries).toHaveLength(0);
  });

  test.each([
    ['supabaseUrl', { supabaseUrl: '' }],
    ['supabaseServiceKey', { supabaseServiceKey: '' }],
  ] as const)('missing %s fails closed with 500', async (_label, overrides) => {
    const h = makeShipmentHarness(overrides);
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(500);
    expect(body.error).toBe('Database service not configured.');
  });

  test('unparseable JSON body is a 400', async () => {
    const h = makeShipmentHarness();
    const { status, body } = await callFn(h, undefined, { rawBody: 'not json {' });
    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body.');
  });

  test('missing order_id is a 400', async () => {
    const h = makeShipmentHarness();
    const { status, body } = await callFn(h, {});
    expect(status).toBe(400);
    expect(body.error).toBe('order_id is required.');
    expect(h.db.queries).toHaveLength(0);
  });
});

describe('order re-read + gates', () => {
  test('an order read error is a 404', async () => {
    const h = makeShipmentHarness();
    h.db.on('orders', 'select', { error: { message: 'boom' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(404);
    expect(body.error).toBe('Order not found.');
    expect(h.emails).toHaveLength(0);
  });

  test('a missing order row is a 404', async () => {
    const h = makeShipmentHarness();
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(404);
    expect(body.error).toBe('Order not found.');
  });

  test('a non-fulfilled order is a 409 naming the actual status', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ status: 'paid' }));
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(409);
    expect(body.error).toBe('Order status is paid; expected fulfilled.');
    expect(h.emails).toHaveLength(0);
  });

  test('a non-email buyer contact skips with ok:false before reading lines', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ buyer_contact: '555-0100' }));
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      skipped: true,
      reason: 'Buyer contact is not an email address; shipment notification skipped.',
    });
    expect(h.db.of('order_lines')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('an order_lines read failure is a 502 carrying the db message', async () => {
    const h = makeShipmentHarness();
    h.db.on('orders', 'select', { data: shipmentOrderRow() });
    h.db.on('order_lines', 'select', { error: { message: 'lines exploded' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(502);
    expect(body.error).toBe('Failed to load order lines: lines exploded');
    expect(h.emails).toHaveLength(0);
  });
});

describe('email send', () => {
  test('happy path emails the buyer and returns ok + orderNumber', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow());
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, orderNumber: 'VSR-ORD-260718-001' });

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.to).toBe('buyer@test.example');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.subject).toBe('Your order has shipped — VSR-ORD-260718-001');
    // USPS tracking: label, number, and the carrier deep link.
    expect(email.html).toContain('USPS tracking number:');
    expect(email.html).toContain('9400 1000 0000 0000 0000 00');
    expect(email.html).toContain('https://tools.usps.com/go/TrackConfirmAction?tLabels=');
    // Line items render SKU + name + qty.
    expect(email.html).toContain(ORDER_LINES[0].sku);
    expect(email.html).toContain('BPC-157 — 5mg');
  });

  test.each([
    ['ups', 'UPS', 'https://www.ups.com/track?tracknum='],
    ['fedex', 'FedEx', 'https://www.fedex.com/fedextrack/?trknbr='],
    ['dhl', 'DHL', 'https://www.dhl.com/us-en/home/tracking/tracking-express.html'],
  ])('carrier %s renders its label and tracking link', async (carrier, label, urlPrefix) => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ carrier }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain(`${label} tracking number:`);
    expect(h.emails[0].html).toContain(urlPrefix);
  });

  test('an unknown carrier passes through its name and links a Google search', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ carrier: 'ontrac', tracking_number: 'OT123' }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain('ontrac tracking number:');
    expect(h.emails[0].html).toContain('https://www.google.com/search?q=OT123+tracking');
  });

  test('a null carrier with tracking says "the carrier" and still links a search', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ carrier: null }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain('the carrier tracking number:');
    expect(h.emails[0].html).toContain('https://www.google.com/search?q=');
  });

  test('no tracking number → "will follow separately", no track button', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ tracking_number: null }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain('Tracking information will follow separately.');
    expect(h.emails[0].html).not.toContain('Track your package');
  });

  test('an empty buyer name falls back to "there"', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow({ buyer_name: '' }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain('Hi there,');
  });

  test('user-controlled fields are HTML-escaped in the email', async () => {
    const h = withOrder(
      makeShipmentHarness(),
      shipmentOrderRow({ buyer_name: '<script>alert(1)</script>', tracking_number: 'T&1<2>' }),
      [{ sku: 'SK<U>', product_name: 'Item "A" & \'B\'', quantity: 1 }],
    );
    await callFn(h, PAYLOAD);
    const html = h.emails[0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('T&amp;1&lt;2&gt;');
    expect(html).toContain('SK&lt;U&gt;');
    expect(html).toContain('Item &quot;A&quot; &amp; &#39;B&#39;');
  });

  test('null order_lines data renders an empty table (no crash)', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow(), null);
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(h.emails[0].html).toContain('<tbody></tbody>');
  });

  test('a Resend failure is a 502 with the provider body as detail', async () => {
    const h = withOrder(makeShipmentHarness(), shipmentOrderRow());
    h.emailResponder = () => ({ status: 500, body: { message: 'resend down' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(502);
    expect(body.error).toBe('Email delivery failed.');
    expect(body.detail).toEqual({ message: 'resend down' });
  });
});
