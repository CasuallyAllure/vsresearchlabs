/**
 * Orchestration tests — send-delivered-notification (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/
 * notificationFnsHarness) and pins every decision path: CORS preflight, the
 * admin gate, method gate, JSON parsing, payload validation, the order
 * re-read + delivered_at gate, the non-email skip, the email send, and the
 * exact response contracts. Also pins two quirks vs its siblings: there are
 * NO env guards (missing Resend key / db config do not 500), and the success
 * body is a bare { ok: true } with no orderNumber.
 */
import { describe, expect, test } from 'vitest';
import {
  callFn,
  deliveredOrderRow,
  makeDeliveredHarness,
  TEST_CORS,
  withOrder,
} from '../helpers/notificationFnsHarness';

const PAYLOAD = { order_id: 'order-1' };

describe('request gates', () => {
  test('OPTIONS preflight returns 204 with the CORS headers and skips the admin gate', async () => {
    const h = makeDeliveredHarness();
    const { status, response } = await callFn(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.adminGateCalls).toHaveLength(0);
    expect(h.db.queries).toHaveLength(0);
  });

  test('a failed admin gate returns its body + status verbatim and touches nothing', async () => {
    const h = makeDeliveredHarness();
    h.adminGateResult = { ok: false, status: 401, body: { error: 'Unauthorized' } };
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('non-POST methods are refused with 405 once the gate passes', async () => {
    const h = makeDeliveredHarness();
    const { status, body } = await callFn(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed.');
  });

  // QUIRK (pinned, not fixed): unlike its shipment/processing siblings this
  // handler has NO env guards — an unset RESEND_API_KEY or Supabase config
  // does not 500; the request proceeds and the send is attempted anyway.
  test('QUIRK: an empty Resend key does not 500 — the send still goes out', async () => {
    const h = withOrder(makeDeliveredHarness({ resendApiKey: '' }), deliveredOrderRow());
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(h.emails).toHaveLength(1);
  });

  test('QUIRK: empty Supabase config does not 500 — the order read just runs', async () => {
    const h = withOrder(makeDeliveredHarness({ supabaseUrl: '', supabaseServiceKey: '' }), deliveredOrderRow());
    const { status } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
  });

  test('unparseable JSON body is a 400', async () => {
    const h = makeDeliveredHarness();
    const { status, body } = await callFn(h, undefined, { rawBody: 'not json {' });
    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body.');
  });

  test('missing order_id is a 400', async () => {
    const h = makeDeliveredHarness();
    const { status, body } = await callFn(h, {});
    expect(status).toBe(400);
    expect(body.error).toBe('order_id is required.');
    expect(h.db.queries).toHaveLength(0);
  });

  test('a null payload body is a 400 (the ?. guard, not a crash)', async () => {
    const h = makeDeliveredHarness();
    const { status, body } = await callFn(h, undefined, { rawBody: 'null' });
    expect(status).toBe(400);
    expect(body.error).toBe('order_id is required.');
  });
});

describe('order re-read + gates', () => {
  test('an order read error is a 404', async () => {
    const h = makeDeliveredHarness();
    h.db.on('orders', 'select', { error: { message: 'boom' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(404);
    expect(body.error).toBe('Order not found.');
  });

  test('an order without delivered_at is a 409', async () => {
    const h = withOrder(makeDeliveredHarness(), deliveredOrderRow({ delivered_at: null }));
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(409);
    expect(body.error).toBe('Order is not marked delivered.');
    expect(h.emails).toHaveLength(0);
  });

  test('a non-email buyer contact skips with ok:false', async () => {
    const h = withOrder(makeDeliveredHarness(), deliveredOrderRow({ buyer_contact: '555-0100' }));
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      skipped: true,
      reason: 'Buyer contact is not an email address; delivered notification skipped.',
    });
    expect(h.emails).toHaveLength(0);
  });
});

describe('email send', () => {
  test('happy path emails the buyer and returns a bare { ok: true }', async () => {
    const h = withOrder(makeDeliveredHarness(), deliveredOrderRow());
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(200);
    // QUIRK: no orderNumber in the success body (siblings return it).
    expect(body).toEqual({ ok: true });

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.to).toBe('buyer@test.example');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.subject).toBe('Order completed — thank you (VSR-ORD-260718-001)');
    expect(email.html).toContain('Your order is complete.');
    expect(email.html).toContain('VSR-ORD-260718-001');
  });

  test('the delivered handler never reads order_lines', async () => {
    const h = withOrder(makeDeliveredHarness(), deliveredOrderRow());
    await callFn(h, PAYLOAD);
    expect(h.db.of('order_lines')).toHaveLength(0);
  });

  test('an empty buyer name falls back to "there"', async () => {
    const h = withOrder(makeDeliveredHarness(), deliveredOrderRow({ buyer_name: '' }));
    await callFn(h, PAYLOAD);
    expect(h.emails[0].html).toContain('Hi there,');
  });

  test('user-controlled fields are HTML-escaped in the email', async () => {
    const h = withOrder(
      makeDeliveredHarness(),
      deliveredOrderRow({ buyer_name: '<script>x</script>', order_number: 'VSR-"1"&<2>' }),
    );
    await callFn(h, PAYLOAD);
    const html = h.emails[0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('VSR-&quot;1&quot;&amp;&lt;2&gt;');
  });

  test('a Resend failure is a 502 with the provider body as detail', async () => {
    const h = withOrder(makeDeliveredHarness(), deliveredOrderRow());
    h.emailResponder = () => ({ status: 500, body: { message: 'resend down' } });
    const { status, body } = await callFn(h, PAYLOAD);
    expect(status).toBe(502);
    expect(body.error).toBe('Email delivery failed.');
    expect(body.detail).toEqual({ message: 'resend down' });
  });
});
