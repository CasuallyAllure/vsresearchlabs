/**
 * Orchestration suite for supabase/functions/mark-payment-claimed/handler.ts —
 * the PUBLIC "✓ I've sent payment" endpoint (verify_jwt off; the 256-bit
 * lookup_token IS the authorization), driven end-to-end through the REAL
 * handler via the scriptable harness (tests/helpers/invoiceFnsHarness.ts).
 *
 * The fail-closed token semantics are security-critical and pinned exactly:
 * every failure path is a bodiless 302 to /track that leaks nothing beyond
 * the flag in the redirect URL (&claimed=1 / &error=1 / bare). Quirks are
 * pinned, not fixed (e.g. a missing Resend key silently skips the admin
 * notification but still claims; the 405 message has no trailing period).
 */

import { describe, expect, it } from 'vitest';
import {
  CLAIM_URL,
  TEST_SITE_URL,
  VALID_TOKEN,
  callJson,
  claimOrderRow,
  makeClaimHarness,
  queryHas,
  type ClaimHarness,
} from '../helpers/invoiceFnsHarness';

const TRACK = `${TEST_SITE_URL}/track`;

function withOrder(h: ClaimHarness, row: Record<string, unknown> = claimOrderRow()): ClaimHarness {
  h.db.on('orders', 'select', { data: row });
  return h;
}

/** GET with ?t=<token> — the invoice-email link shape. */
async function claimByGet(h: ClaimHarness, token?: string): Promise<Response> {
  const url = token === undefined ? CLAIM_URL : `${CLAIM_URL}?t=${encodeURIComponent(token)}`;
  return h.handler(new Request(url, { method: 'GET' }));
}

async function expectEmptyBody(res: Response): Promise<void> {
  expect(await res.text()).toBe('');
}

describe('mark-payment-claimed handler — method + token gates', () => {
  it('answers OPTIONS with 204 + CORS', async () => {
    const h = makeClaimHarness();
    const res = await h.handler(new Request(CLAIM_URL, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://test.example');
  });

  it.each(['PUT', 'DELETE', 'PATCH'])('rejects %s with a 405 JSON error (no trailing period)', async (method) => {
    const h = makeClaimHarness();
    const { status, body } = await callJson(h.handler, CLAIM_URL, {}, { method });
    expect(status).toBe(405);
    expect(body).toEqual({ error: 'Method not allowed' });
  });

  it('redirects a tokenless GET to bare /track without touching the database', async () => {
    const h = makeClaimHarness();
    const res = await claimByGet(h);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(TRACK);
    expect(h.db.queries).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
    await expectEmptyBody(res);
  });

  it('fails closed on a short token (31 chars) but admits the 32-char boundary', async () => {
    const short = makeClaimHarness();
    const shortRes = await claimByGet(short, 'a'.repeat(31));
    expect(shortRes.status).toBe(302);
    expect(shortRes.headers.get('Location')).toBe(TRACK);
    expect(short.db.queries).toHaveLength(0);

    const boundary = withOrder(makeClaimHarness());
    await claimByGet(boundary, 'a'.repeat(32));
    expect(boundary.db.queries).toHaveLength(1); // token long enough → lookup runs
  });

  it('treats an unparseable or non-string POST token as missing', async () => {
    const badJson = makeClaimHarness();
    const res1 = await badJson.handler(
      new Request(CLAIM_URL, { method: 'POST', body: 'not-json{' }),
    );
    expect(res1.status).toBe(302);
    expect(res1.headers.get('Location')).toBe(TRACK);

    const numeric = makeClaimHarness();
    const res2 = await numeric.handler(
      new Request(CLAIM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 12345 }),
      }),
    );
    expect(res2.status).toBe(302);
    expect(res2.headers.get('Location')).toBe(TRACK);
    expect(numeric.db.queries).toHaveLength(0);
  });

  it('redirects with &error=1 when the database config is missing', async () => {
    for (const overrides of [{ supabaseUrl: '' }, { supabaseServiceKey: '' }]) {
      const h = makeClaimHarness(overrides);
      const res = await claimByGet(h, VALID_TOKEN);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}&error=1`);
      expect(h.db.queries).toHaveLength(0);
    }
  });
});

describe('mark-payment-claimed handler — token resolution + claim', () => {
  it('redirects an unknown token to /track?t=<token> with NO status flag (leaks nothing)', async () => {
    const h = makeClaimHarness(); // inert db → data: null
    const res = await claimByGet(h, VALID_TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}`);
    await expectEmptyBody(res);
    const q = h.db.of('orders', 'select')[0];
    expect(queryHas(q, 'eq', 'lookup_token', VALID_TOKEN)).toBe(true);
    expect(queryHas(q, 'single')).toBe(true);
    expect(h.db.rpcCalls).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  it('redirects with &error=1 when the claim RPC fails — no admin email fires', async () => {
    const h = withOrder(makeClaimHarness());
    h.db.onRpc('mark_payment_claimed', { error: { message: 'rpc boom' } });
    const res = await claimByGet(h, VALID_TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}&error=1`);
    expect(h.emails).toHaveLength(0);
  });

  it('claims via GET: RPC by order id, admin notified, buyer lands on &claimed=1', async () => {
    const h = withOrder(makeClaimHarness());
    const res = await claimByGet(h, VALID_TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}&claimed=1`);
    await expectEmptyBody(res);

    expect(h.db.rpcCalls).toEqual([{ fn: 'mark_payment_claimed', args: { p_order_id: 'order-1' } }]);

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.to).toBe('biz@test.example');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.subject).toBe('VSR-ORD-260718-001 — buyer claims paid ($59.98)');
    expect(email.html).toContain('zelle@test.example'); // where to look
    expect(email.html).toContain('>001<'); // expected payment note (serial after final dash)
    expect(email.html).toContain('Test Buyer');
    expect(email.html).toContain('buyer@test.example');
  });

  it('claims via POST {token} identically', async () => {
    const h = withOrder(makeClaimHarness());
    const res = await h.handler(
      new Request(CLAIM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: VALID_TOKEN }),
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}&claimed=1`);
    expect(h.db.rpcCalls).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
  });

  it('URL-encodes the token it echoes into every redirect', async () => {
    const weird = `${'x'.repeat(32)}+&=`;
    const unknown = makeClaimHarness();
    const res = await unknown.handler(
      new Request(CLAIM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: weird }),
      }),
    );
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${encodeURIComponent(weird)}`);
  });
});

describe('mark-payment-claimed handler — admin notification edges', () => {
  it('QUIRK: with no Resend key the notification is silently skipped but the claim succeeds', async () => {
    const h = withOrder(makeClaimHarness({ resendApiKey: '' }));
    const res = await claimByGet(h, VALID_TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}&claimed=1`);
    expect(h.db.rpcCalls).toHaveLength(1); // status still advanced
    expect(h.emails).toHaveLength(0);
  });

  it('a throwing notification send is swallowed — the buyer flow never breaks', async () => {
    const h = withOrder(makeClaimHarness());
    h.emailResponder = () => ({ throw: new Error('network down') });
    const res = await claimByGet(h, VALID_TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${TRACK}?t=${VALID_TOKEN}&claimed=1`);
  });

  it('falls back invoice_amount_cents → subtotal_cents → — for the amount', async () => {
    const viaSubtotal = withOrder(makeClaimHarness(), claimOrderRow({ invoice_amount_cents: null }));
    await claimByGet(viaSubtotal, VALID_TOKEN);
    expect(viaSubtotal.emails[0].subject).toBe('VSR-ORD-260718-001 — buyer claims paid ($49.99)');

    const noAmounts = withOrder(
      makeClaimHarness(),
      claimOrderRow({ invoice_amount_cents: null, subtotal_cents: null }),
    );
    await claimByGet(noAmounts, VALID_TOKEN);
    expect(noAmounts.emails[0].subject).toBe('VSR-ORD-260718-001 — buyer claims paid (—)');
  });

  it('renders — for a null buyer name/contact and escapes hostile values', async () => {
    const nulls = withOrder(
      makeClaimHarness(),
      claimOrderRow({ buyer_name: null, buyer_contact: null }),
    );
    await claimByGet(nulls, VALID_TOKEN);
    expect(nulls.emails[0].html).toContain('—');

    const hostile = withOrder(
      makeClaimHarness(),
      claimOrderRow({ buyer_name: '<img src=x onerror=alert(1)>' }),
    );
    await claimByGet(hostile, VALID_TOKEN);
    expect(hostile.emails[0].html).not.toContain('<img src=x');
    expect(hostile.emails[0].html).toContain('&lt;img src=x');
  });

  it('uses the whole order number as the payment code when it has no dashes', async () => {
    const h = withOrder(makeClaimHarness(), claimOrderRow({ order_number: 'LEGACY42' }));
    await claimByGet(h, VALID_TOKEN);
    expect(h.emails[0].html).toContain('>LEGACY42<');
  });
});
