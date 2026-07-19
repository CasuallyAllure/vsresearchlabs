/**
 * Orchestration suite for supabase/functions/send-order-invoice/handler.ts —
 * the admin invoice re-send, driven end-to-end through the REAL handler via
 * the scriptable harness (tests/helpers/invoiceFnsHarness.ts).
 *
 * Every assertion is observable behavior: the Response, the recorded
 * queries/RPCs, the captured Resend emails. Quirks are pinned, not fixed
 * (e.g. the admin gate runs BEFORE the method check, so an unauthenticated
 * GET is 401, not 405).
 */

import { describe, expect, it } from 'vitest';
import {
  GATE_DENIED,
  INVOICE_URL,
  TEST_SITE_URL,
  VALID_TOKEN,
  callJson,
  invoiceOrderRow,
  makeInvoiceHarness,
  queryHas,
  type InvoiceHarness,
} from '../helpers/invoiceFnsHarness';
import { invoiceSubject } from '../../supabase/functions/_shared/invoiceEmail';

function withOrder(h: InvoiceHarness, row: Record<string, unknown> = invoiceOrderRow()): InvoiceHarness {
  h.db.on('orders', 'select', { data: row });
  return h;
}

const call = (h: InvoiceHarness, payload: unknown, opts: Parameters<typeof callJson>[3] = {}) =>
  callJson(h.handler, INVOICE_URL, payload, opts);

describe('send-order-invoice handler — request gates', () => {
  it('answers OPTIONS with 204 + CORS and never consults the admin gate', async () => {
    const h = makeInvoiceHarness();
    const { status, response } = await call(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://test.example');
    expect(h.gateCalls).toHaveLength(0);
    expect(await response.text()).toBe('');
  });

  it('passes a denied gate result through verbatim (401 Unauthorized)', async () => {
    const h = makeInvoiceHarness();
    h.gateResult = GATE_DENIED;
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(h.gateCalls).toHaveLength(1);
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  it('passes any denied gate status/body through, not just 401', async () => {
    const h = makeInvoiceHarness();
    h.gateResult = { ok: false, status: 503, body: { error: 'Gate offline' } };
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(503);
    expect(body).toEqual({ error: 'Gate offline' });
  });

  it('QUIRK: gate runs before the method check — unauthenticated GET is 401, not 405', async () => {
    const h = makeInvoiceHarness();
    h.gateResult = GATE_DENIED;
    const { status } = await call(h, undefined, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('rejects non-POST methods from an admitted admin with 405', async () => {
    const h = makeInvoiceHarness();
    const { status, body } = await call(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body).toEqual({ error: 'Method not allowed.' });
  });

  it('returns 500 when the Resend key is unset', async () => {
    const h = makeInvoiceHarness({ resendApiKey: '' });
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Email service not configured.' });
  });

  it('returns 500 when the database config is missing (url or service key)', async () => {
    for (const overrides of [{ supabaseUrl: '' }, { supabaseServiceKey: '' }]) {
      const h = makeInvoiceHarness(overrides);
      const { status, body } = await call(h, { order_id: 'order-1' });
      expect(status).toBe(500);
      expect(body).toEqual({ error: 'Database service not configured.' });
    }
  });

  it('rejects a malformed JSON body with 400', async () => {
    const h = makeInvoiceHarness();
    const { status, body } = await call(h, undefined, { rawBody: 'not-json{' });
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body.' });
  });

  it('rejects a payload without order_id with 400', async () => {
    const h = makeInvoiceHarness();
    const { status, body } = await call(h, {});
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'order_id is required.' });
  });
});

describe('send-order-invoice handler — order resolution', () => {
  it('returns 404 when the order read errors', async () => {
    const h = makeInvoiceHarness();
    h.db.on('orders', 'select', { error: { message: 'boom' } });
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Order not found.' });
  });

  it('returns 404 when no order matches and queries by the payload id', async () => {
    const h = makeInvoiceHarness();
    const { status, body } = await call(h, { order_id: 'order-x' });
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Order not found.' });
    const q = h.db.of('orders', 'select')[0];
    expect(queryHas(q, 'eq', 'id', 'order-x')).toBe(true);
    expect(queryHas(q, 'single')).toBe(true);
  });

  it.each(['cancelled', 'refunded'])('refuses to invoice a %s order with 409', async (status) => {
    const h = withOrder(makeInvoiceHarness(), invoiceOrderRow({ status }));
    const res = await call(h, { order_id: 'order-1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: `Cannot send invoice for a ${status} order.` });
    expect(h.emails).toHaveLength(0);
  });

  it('skips (200, ok:false) when the buyer contact is not an email — nothing else runs', async () => {
    const h = withOrder(makeInvoiceHarness(), invoiceOrderRow({ buyer_contact: '555-0100' }));
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      skipped: true,
      reason: 'Buyer contact is not an email address; invoice email skipped.',
    });
    expect(h.db.queries).toHaveLength(1); // only the order read
    expect(h.emails).toHaveLength(0);
  });
});

describe('send-order-invoice handler — happy path + email content', () => {
  it('re-reads lines + coupons and emails the buyer the branded invoice', async () => {
    const h = withOrder(makeInvoiceHarness());
    h.db.on('order_lines', 'select', {
      data: [{ sku: 'VSR-RS-BPC', product_name: 'BPC-157 — 5mg', quantity: 1, unit_price_cents: 4999, item_note: null, fast_ship: true }],
    });
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, orderNumber: 'VSR-ORD-260718-001' });

    // Canonical reads, in order: orders → order_lines → order_coupons.
    expect(h.db.queries.map((q) => q.table)).toEqual(['orders', 'order_lines', 'order_coupons']);
    expect(queryHas(h.db.of('order_lines', 'select')[0], 'eq', 'order_id', 'order-1')).toBe(true);
    const couponQ = h.db.of('order_coupons', 'select')[0];
    expect(queryHas(couponQ, 'eq', 'order_id', 'order-1')).toBe(true);
    expect(queryHas(couponQ, 'order', 'created_at')).toBe(true);

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.to).toBe('buyer@test.example');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.subject).toBe(
      invoiceSubject({ order_number: 'VSR-ORD-260718-001', invoice_amount_cents: 5998 }),
    );
    expect(email.subject).toContain('VSR-ORD-260718-001');
    expect(email.html).toContain('BPC-157');
    expect(email.text).toBeTruthy(); // plain-text alternative always sent
  });

  it('includes the confirm-shipping CTA only while the address is unconfirmed', async () => {
    const h = withOrder(makeInvoiceHarness()); // lookup_token set, ship_confirmed_at null
    await call(h, { order_id: 'order-1' });
    expect(h.emails[0].html).toContain(`${TEST_SITE_URL}/track?t=${VALID_TOKEN}#confirm-address`);

    const confirmed = withOrder(
      makeInvoiceHarness(),
      invoiceOrderRow({ ship_confirmed_at: '2026-07-18T01:00:00.000Z' }),
    );
    await call(confirmed, { order_id: 'order-1' });
    expect(confirmed.emails[0].html).not.toContain('#confirm-address');

    const tokenless = withOrder(makeInvoiceHarness(), invoiceOrderRow({ lookup_token: null }));
    await call(tokenless, { order_id: 'order-1' });
    expect(tokenless.emails[0].html).not.toContain('#confirm-address');
  });

  it('looks up the member free-shipping perk only for owned orders', async () => {
    const guest = withOrder(makeInvoiceHarness());
    await call(guest, { order_id: 'order-1' });
    expect(guest.db.of('customer_profiles')).toHaveLength(0);

    const member = withOrder(makeInvoiceHarness(), invoiceOrderRow({ user_id: 'user-9' }));
    member.db.on('customer_profiles', 'select', { data: { free_shipping: true } });
    await call(member, { order_id: 'order-1' });
    const profQ = member.db.of('customer_profiles', 'select')[0];
    expect(queryHas(profQ, 'eq', 'user_id', 'user-9')).toBe(true);
    expect(member.emails[0].html).toContain('Free — member');
  });

  it('treats a missing profile row as no perk (no member label)', async () => {
    const h = withOrder(makeInvoiceHarness(), invoiceOrderRow({ user_id: 'user-9' }));
    await call(h, { order_id: 'order-1' });
    expect(h.emails[0].html).not.toContain('Free — member');
  });

  it('renders admin-supplied notes into the invoice email', async () => {
    const h = withOrder(makeInvoiceHarness());
    await call(h, { order_id: 'order-1', notes: 'Replacement shipment approved.' });
    expect(h.emails[0].html).toContain('Replacement shipment approved.');
  });

  it('returns 502 with the Resend body when the email send fails', async () => {
    const h = withOrder(makeInvoiceHarness());
    h.emailResponder = () => ({ status: 500, body: { message: 'resend down' } });
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(502);
    expect(body).toEqual({ error: 'Email delivery failed.', detail: { message: 'resend down' } });
  });
});
