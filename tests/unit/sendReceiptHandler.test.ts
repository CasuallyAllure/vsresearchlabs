/**
 * Orchestration suite for supabase/functions/send-receipt/handler.ts — the
 * branded PAID receipt (email or preview), driven end-to-end through the REAL
 * handler via the scriptable harness (tests/helpers/invoiceFnsHarness.ts).
 *
 * Every assertion is observable behavior. Quirks are pinned, not fixed:
 *   • the admin gate runs BEFORE the method check (unauthenticated GET = 401);
 *   • preview mode renders for ANY order state and with no Resend key;
 *   • a cancelled order WITH paid_at still sends (the payment gate only
 *     checks paid_at / paid / fulfilled);
 *   • a failed mark_receipt_sent stamp is non-fatal (email already went out).
 */

import { describe, expect, it } from 'vitest';
import {
  GATE_DENIED,
  RECEIPT_URL,
  TEST_SITE_URL,
  VALID_TOKEN,
  callJson,
  makeReceiptHarness,
  queryHas,
  receiptOrderRow,
  type ReceiptHarness,
} from '../helpers/invoiceFnsHarness';

function withOrder(h: ReceiptHarness, row: Record<string, unknown> = receiptOrderRow()): ReceiptHarness {
  h.db.on('orders', 'select', { data: row });
  return h;
}

const call = (h: ReceiptHarness, payload: unknown, opts: Parameters<typeof callJson>[3] = {}) =>
  callJson(h.handler, RECEIPT_URL, payload, opts);

describe('send-receipt handler — request gates', () => {
  it('answers OPTIONS with 204 + CORS and never consults the admin gate', async () => {
    const h = makeReceiptHarness();
    const { status, response } = await call(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://test.example');
    expect(h.gateCalls).toHaveLength(0);
  });

  it('passes a denied gate result through verbatim', async () => {
    const h = makeReceiptHarness();
    h.gateResult = GATE_DENIED;
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(h.db.queries).toHaveLength(0);
  });

  it('QUIRK: gate runs before the method check — unauthenticated GET is 401, not 405', async () => {
    const h = makeReceiptHarness();
    h.gateResult = GATE_DENIED;
    const { status } = await call(h, undefined, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('rejects non-POST methods from an admitted admin with 405', async () => {
    const h = makeReceiptHarness();
    const { status, body } = await call(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body).toEqual({ error: 'Method not allowed.' });
  });

  it('returns 500 when the database config is missing (url or service key)', async () => {
    for (const overrides of [{ supabaseUrl: '' }, { supabaseServiceKey: '' }]) {
      const h = makeReceiptHarness(overrides);
      const { status, body } = await call(h, { order_id: 'order-1' });
      expect(status).toBe(500);
      expect(body).toEqual({ error: 'Database service not configured.' });
    }
  });

  it('rejects a malformed JSON body with 400', async () => {
    const h = makeReceiptHarness();
    const { status, body } = await call(h, undefined, { rawBody: '{{' });
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body.' });
  });

  it('rejects a payload without order_id with 400', async () => {
    const h = makeReceiptHarness();
    const { status, body } = await call(h, {});
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'order_id is required.' });
  });

  it('returns 404 when the order read errors or matches nothing', async () => {
    const errored = makeReceiptHarness();
    errored.db.on('orders', 'select', { error: { message: 'boom' } });
    expect((await call(errored, { order_id: 'order-1' })).status).toBe(404);

    const empty = makeReceiptHarness();
    const res = await call(empty, { order_id: 'order-x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Order not found.' });
    expect(queryHas(empty.db.of('orders', 'select')[0], 'eq', 'id', 'order-x')).toBe(true);
  });
});

describe('send-receipt handler — preview mode', () => {
  it('renders the receipt HTML with no email and no stamp', async () => {
    const h = withOrder(makeReceiptHarness());
    h.db.on('order_lines', 'select', {
      data: [{ sku: 'VSR-RS-BPC', product_name: 'BPC-157 — 5mg', quantity: 2, unit_price_cents: 4999, item_note: 'Keep cold' }],
    });
    const { status, body } = await call(h, { order_id: 'order-1', preview: true });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.preview).toBe(true);
    expect(body.orderNumber).toBe('VSR-ORD-260718-001');
    const html = body.html as string;
    expect(html).toContain('VSR-ORD-260718-001');
    expect(html).toContain('Receipt · Paid');
    expect(html).toContain('BPC-157');
    expect(html).toContain('Note: Keep cold');
    expect(h.emails).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
  });

  it('QUIRK: preview renders even with no Resend key and for an unpaid order', async () => {
    const h = withOrder(
      makeReceiptHarness({ resendApiKey: '' }),
      receiptOrderRow({ status: 'invoice_sent', paid_at: null }),
    );
    const { status, body } = await call(h, { order_id: 'order-1', preview: true });
    expect(status).toBe(200);
    expect(body.preview).toBe(true);
    expect(h.emails).toHaveLength(0);
  });
});

describe('send-receipt handler — send mode', () => {
  it('returns 500 in send mode when the Resend key is unset', async () => {
    const h = withOrder(makeReceiptHarness({ resendApiKey: '' }));
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Email service not configured.' });
  });

  it('refuses a receipt for an order with no payment on record (409, status in message)', async () => {
    const h = withOrder(makeReceiptHarness(), receiptOrderRow({ status: 'invoice_sent', paid_at: null }));
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(409);
    expect(body).toEqual({
      error: 'Order is invoice_sent; a receipt is only valid once payment is recorded.',
    });
    expect(h.emails).toHaveLength(0);
  });

  it.each(['paid', 'fulfilled'])('sends on status %s even without paid_at', async (status) => {
    const h = withOrder(makeReceiptHarness(), receiptOrderRow({ status, paid_at: null }));
    const res = await call(h, { order_id: 'order-1' });
    expect(res.status).toBe(200);
    expect(h.emails).toHaveLength(1);
  });

  it('QUIRK: a cancelled order WITH paid_at still sends — the gate only checks payment', async () => {
    const h = withOrder(makeReceiptHarness(), receiptOrderRow({ status: 'cancelled' }));
    const { status } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(200);
    expect(h.emails).toHaveLength(1);
  });

  it('skips (200, ok:false) when the buyer contact is not an email', async () => {
    const h = withOrder(makeReceiptHarness(), receiptOrderRow({ buyer_contact: '555-0100' }));
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      skipped: true,
      reason: 'Buyer contact is not an email address; receipt skipped.',
    });
    expect(h.emails).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
  });

  it('emails the buyer, stamps receipt_sent via RPC, and returns the HTML', async () => {
    const h = withOrder(makeReceiptHarness());
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.orderNumber).toBe('VSR-ORD-260718-001');
    expect(typeof body.html).toBe('string');

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.to).toBe('buyer@test.example');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.subject).toBe('Receipt VSR-ORD-260718-001 · $59.98 · VS Research Labs');

    expect(h.db.rpcCalls).toEqual([{ fn: 'mark_receipt_sent', args: { p_order_id: 'order-1' } }]);
    expect(queryHas(h.db.of('order_lines', 'select')[0], 'eq', 'order_id', 'order-1')).toBe(true);
  });

  it('returns 502 with the Resend body when the send fails — and never stamps', async () => {
    const h = withOrder(makeReceiptHarness());
    h.emailResponder = () => ({ status: 500, body: { message: 'resend down' } });
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(502);
    expect(body).toEqual({ error: 'Email delivery failed.', detail: { message: 'resend down' } });
    expect(h.db.rpcCalls).toHaveLength(0);
  });

  it('QUIRK: a failed receipt stamp is non-fatal — still 200 ok', async () => {
    const h = withOrder(makeReceiptHarness());
    h.db.onRpc('mark_receipt_sent', { error: { message: 'stamp failed' } });
    const { status, body } = await call(h, { order_id: 'order-1' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe('send-receipt handler — rendered HTML pins', () => {
  const previewHtml = async (row: Record<string, unknown>): Promise<string> => {
    const h = withOrder(makeReceiptHarness(), row);
    const { body } = await call(h, { order_id: 'order-1', preview: true });
    return body.html as string;
  };

  it('links the secure /track receipt only when a lookup token exists', async () => {
    expect(await previewHtml(receiptOrderRow())).toContain(`${TEST_SITE_URL}/track?t=${VALID_TOKEN}`);
    expect(await previewHtml(receiptOrderRow({ lookup_token: null }))).not.toContain('/track?t=');
  });

  it('renders tracking + delivered rows only when present', async () => {
    const html = await previewHtml(
      receiptOrderRow({ tracking_number: '1Z999', delivered_at: '2026-07-19T12:00:00.000Z' }),
    );
    expect(html).toContain('1Z999');
    expect(html).toContain('Paid · Delivered');
    const bare = await previewHtml(receiptOrderRow());
    expect(bare).not.toContain('Tracking');
    expect(bare).not.toContain('· Delivered');
  });

  it('falls back to the total in the subtotal row and to — for null amounts', async () => {
    // subtotal null → subtotal cell shows the total; shipping null → em dash.
    const html = await previewHtml(receiptOrderRow({ subtotal_cents: null, shipping_cents: null }));
    expect(html.match(/\$59\.98/g)!.length).toBeGreaterThanOrEqual(2); // subtotal fallback + total
    // total null → subject-level fmtUsd handled in send mode; here Total Paid shows —
    const nullTotal = await previewHtml(receiptOrderRow({ invoice_amount_cents: null }));
    expect(nullTotal).toContain('—');
  });

  it('escapes buyer-controlled fields in the HTML', async () => {
    const html = await previewHtml(
      receiptOrderRow({ buyer_name: '<script>alert(1)</script>', buyer_organization: 'A&B "Labs"' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B &quot;Labs&quot;');
  });
});
