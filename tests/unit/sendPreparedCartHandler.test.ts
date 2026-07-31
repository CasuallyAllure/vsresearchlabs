/**
 * Orchestration suite for the send-prepared-cart handler
 * (supabase/functions/send-prepared-cart/handler.ts) — the branded "we built
 * you a cart" email.
 *
 * Structurally a sibling of sendInviteHandler.test.ts (same gate ordering, same
 * Resend payload contract, same 502-on-delivery-failure shape), plus the three
 * things this function owns that send-invite does not:
 *
 *   • THE TOKEN IS VERIFIED, NOT TRUSTED. The plaintext link token exists only
 *     in the admin's browser (081 stores a digest), so it has to arrive in the
 *     request — which means it has to be checked. `token_ok:false` is refused
 *     rather than mailed: a link that does not open costs the member a wasted
 *     trip to a dead page, which is the exact failure this whole workstream was
 *     opened to fix.
 *   • CONSENT. A prepared cart is an unsolicited commercial offer, the same
 *     category as 075's `winback`, so it gates on marketing_opt_out — and says
 *     so, rather than reporting a send that did not happen.
 *   • IDEMPOTENCY THAT CAN STILL BE RETRIED. The email_log claim goes in BEFORE
 *     the send (075's contract), but unlike member-automations a failed send
 *     RELEASES its claim: a human is watching this one, and "already sent" for
 *     a mail that never existed would be a lie they cannot get past.
 */

import { describe, expect, test } from 'vitest';
import { EMAIL_BRAND } from '../../supabase/functions/_shared/emailBrand';
import {
  describeLine,
  formatExpiry,
} from '../../supabase/functions/send-prepared-cart/handler';
import {
  GATE_FAIL,
  TEST_CORS,
  jsonRequest,
  makeSendPreparedCartHarness,
  preparedCartFixture,
  readJson,
} from '../helpers/miscFnsHarness';

const CART_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const TOKEN = 'a'.repeat(64);
const VALID = { cart_id: CART_ID, token: TOKEN };

function sendRequest(body: unknown, opts: { method?: string; rawBody?: string } = {}): Request {
  return jsonRequest('send-prepared-cart', body, opts);
}

/* ── Gate ordering ─────────────────────────────────────────────────────────── */

describe('preflight + admin gate', () => {
  test('OPTIONS short-circuits to 204 with CORS headers BEFORE the admin gate', async () => {
    const h = makeSendPreparedCartHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(sendRequest(undefined, { method: 'OPTIONS' }));

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TEST_CORS['Access-Control-Allow-Origin']);
    expect(h.gateCalls).toHaveLength(0);
  });

  test('a failed admin gate returns its status/body verbatim and mails nothing', async () => {
    const h = makeSendPreparedCartHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(sendRequest(VALID));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Unauthorized' });
    expect(h.emails).toHaveLength(0);
    expect(h.claims).toHaveLength(0);
  });

  test('a non-admin never even reaches the cart lookup — no member email is read', async () => {
    const h = makeSendPreparedCartHarness();
    h.gateResult = GATE_FAIL;
    h.cart = null;

    await h.handler(sendRequest(VALID));
    expect(h.emails).toHaveLength(0);
  });

  test('gate ok + non-POST is 405', async () => {
    const h = makeSendPreparedCartHarness();
    const res = await h.handler(sendRequest(undefined, { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  test('an unconfigured Resend key is a 500, not a silent no-op', async () => {
    const h = makeSendPreparedCartHarness({ resendApiKey: '' });
    const res = await h.handler(sendRequest(VALID));

    expect(res.status).toBe(500);
    expect((await readJson(res) as { error: string }).error).toMatch(/not configured/i);
  });
});

/* ── Request validation ────────────────────────────────────────────────────── */

describe('request validation', () => {
  test('a non-JSON body is 400', async () => {
    const h = makeSendPreparedCartHarness();
    const res = await h.handler(sendRequest(undefined, { rawBody: 'not json' }));
    expect(res.status).toBe(400);
  });

  test.each([
    ['a missing cart id', { token: TOKEN }],
    ['a non-uuid cart id', { cart_id: 'cart-1', token: TOKEN }],
    ['an empty cart id', { cart_id: '   ', token: TOKEN }],
  ])('%s is refused', async (_label, body) => {
    const h = makeSendPreparedCartHarness();
    const res = await h.handler(sendRequest(body));
    expect(res.status).toBe(400);
    expect(h.claims).toHaveLength(0);
  });

  test.each([
    ['a missing token', { cart_id: CART_ID }],
    ['a short token', { cart_id: CART_ID, token: 'abc' }],
    ['a non-hex token', { cart_id: CART_ID, token: 'z'.repeat(64) }],
  ])('%s is refused before anything is mailed', async (_label, body) => {
    const h = makeSendPreparedCartHarness();
    const res = await h.handler(sendRequest(body));
    expect(res.status).toBe(400);
    expect(h.emails).toHaveLength(0);
  });
});

/* ── The cart itself ───────────────────────────────────────────────────────── */

describe('what the function refuses to mail', () => {
  test('an unknown cart is 404', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = { ok: false, reason: 'not_found' };

    const res = await h.handler(sendRequest(VALID));
    expect(res.status).toBe(404);
    expect(h.emails).toHaveLength(0);
  });

  test('a null lookup result is 404 rather than a crash', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = null;
    expect((await h.handler(sendRequest(VALID))).status).toBe(404);
  });

  test('a lookup that throws is a 502, and nothing is claimed', async () => {
    const h = makeSendPreparedCartHarness();
    h.cartThrows = new Error('connection reset');

    const res = await h.handler(sendRequest(VALID));
    expect(res.status).toBe(502);
    expect(h.claims).toHaveLength(0);
  });

  test('a token that does not open this cart is REFUSED, never mailed', async () => {
    // The one check that makes the emailed link trustworthy. A mail carrying a
    // dud URL is worse than no mail at all.
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ token_ok: false });

    const res = await h.handler(sendRequest(VALID));
    expect(res.status).toBe(400);
    expect((await readJson(res) as { error: string }).error).toMatch(/does not open this cart/i);
    expect(h.emails).toHaveLength(0);
  });

  test('a revoked cart is 409', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ revoked: true });
    expect((await h.handler(sendRequest(VALID))).status).toBe(409);
    expect(h.emails).toHaveLength(0);
  });

  test('an already-expired cart is 409 — do not mail a link that is dead on arrival', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ expired: true });
    expect((await h.handler(sendRequest(VALID))).status).toBe(409);
  });

  test('a cart with no lines is 409', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ lines: [] });
    expect((await h.handler(sendRequest(VALID))).status).toBe(409);
  });

  test('a member with no email address is 404, not a send to nowhere', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ recipient: undefined });
    expect((await h.handler(sendRequest(VALID))).status).toBe(404);
  });
});

/* ── Consent ───────────────────────────────────────────────────────────────── */

describe('consent — marketing_opt_out is honoured and REPORTED', () => {
  test('an opted-out member is not emailed, and the admin is told so', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ marketing_opt_out: true });

    const res = await h.handler(sendRequest(VALID));

    // 200: nothing went wrong, we chose not to send. The admin panel renders
    // this distinctly and keeps the copyable link.
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: false, status: 'opted_out', recipient: 'ada@example.com' });
    expect(h.emails).toHaveLength(0);
  });

  test('a suppressed send claims nothing — the cart stays sendable if consent changes', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ marketing_opt_out: true });

    await h.handler(sendRequest(VALID));
    expect(h.claims).toHaveLength(0);
  });

  test('consent is checked BEFORE the claim but AFTER the cart is validated', async () => {
    // Order matters: a revoked cart for an opted-out member should report the
    // revocation, which is the thing the admin can actually act on.
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ marketing_opt_out: true, revoked: true });
    expect((await h.handler(sendRequest(VALID))).status).toBe(409);
  });
});

/* ── Idempotency ───────────────────────────────────────────────────────────── */

describe('idempotency — the email_log claim', () => {
  test('the claim lands BEFORE the send, keyed pc-<cart id> on the member', async () => {
    const h = makeSendPreparedCartHarness();
    await h.handler(sendRequest(VALID));

    expect(h.claims).toEqual([
      {
        userId: '11111111-1111-4111-8111-111111111111',
        recipient: 'ada@example.com',
        periodKey: `pc-${CART_ID}`,
        metadata: { cart_id: CART_ID, lines: 1, coupon_code: null },
      },
    ]);
  });

  test('a conflicting claim reports "already sent" and mails NOTHING', async () => {
    const h = makeSendPreparedCartHarness();
    h.claimResult = false;

    const res = await h.handler(sendRequest(VALID));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: false, status: 'already_sent', recipient: 'ada@example.com' });
    expect(h.emails).toHaveLength(0);
  });

  test('a claim that throws is a 502 — never send without a claim', async () => {
    const h = makeSendPreparedCartHarness();
    h.claimThrows = new Error('postgrest down');

    expect((await h.handler(sendRequest(VALID))).status).toBe(502);
    expect(h.emails).toHaveLength(0);
  });

  test('a FAILED send releases its claim, so the admin can retry', async () => {
    // The deliberate departure from member-automations: a human is watching
    // this, and "already sent" for a mail that never went out is unrecoverable.
    const h = makeSendPreparedCartHarness();
    h.emailResponder = () => ({ status: 422, body: { message: 'rejected' } });

    const res = await h.handler(sendRequest(VALID));

    expect(res.status).toBe(502);
    expect(h.releases).toEqual([{ recipient: 'ada@example.com', periodKey: `pc-${CART_ID}` }]);
  });

  test('a SUCCESSFUL send keeps its claim — that row is the record it went out', async () => {
    const h = makeSendPreparedCartHarness();
    await h.handler(sendRequest(VALID));
    expect(h.releases).toHaveLength(0);
  });

  test('a release that itself fails still reports the delivery failure honestly', async () => {
    const h = makeSendPreparedCartHarness();
    h.emailResponder = () => ({ status: 500 });
    h.releaseThrows = new Error('delete failed');

    const res = await h.handler(sendRequest(VALID));
    expect(res.status).toBe(502);
    expect((await readJson(res) as { error: string }).error).toMatch(/delivery failed/i);
  });
});

/* ── The email itself ──────────────────────────────────────────────────────── */

describe('the email', () => {
  test('goes to the member with the branded from/reply-to and both bodies', async () => {
    const h = makeSendPreparedCartHarness();
    const res = await h.handler(sendRequest(VALID));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ ok: true, status: 'sent', recipient: 'ada@example.com' });
    expect(h.emails).toHaveLength(1);

    const [email] = h.emails;
    expect(email.to).toBe('ada@example.com');
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.reply_to).toBe(EMAIL_BRAND.opsEmail);
    expect(email.subject).toContain(EMAIL_BRAND.name);
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text.length).toBeGreaterThan(0);
  });

  test('the CTA is the claim link, with the token in the HASH', async () => {
    // A fragment is never sent to a server and never rides in a Referer header.
    const h = makeSendPreparedCartHarness();
    await h.handler(sendRequest(VALID));

    const claimUrl = `${EMAIL_BRAND.siteUrl}/account/prepared#t=${TOKEN}`;
    expect(h.emails[0].html).toContain(`href="${claimUrl}"`);
    expect(h.emails[0].text).toContain(claimUrl);
    // The token must not also appear as a query parameter anywhere.
    expect(h.emails[0].html).not.toContain(`?t=${TOKEN}`);
  });

  test('names who it is from, what is in the cart, and when the link dies', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({
      lines: [
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
        { sku: 'VSR-LE-MIX', dose: '', quantity: 1 },
      ],
    });
    await h.handler(sendRequest(VALID));

    const [email] = h.emails;
    expect(email.html).toContain(EMAIL_BRAND.name);
    expect(email.html).toContain('VSR-RS-BPC');
    expect(email.html).toContain('10mg');
    expect(email.html).toContain('VSR-LE-MIX');
    expect(email.html).toContain('August 13, 2026');
    expect(email.text).toContain('August 13, 2026');
  });

  test('says prices resolve at checkout, and never quotes one', async () => {
    // 081 stores no money at all. A figure invented here would be the exact
    // mistake the schema was shaped to prevent.
    const h = makeSendPreparedCartHarness();
    await h.handler(sendRequest(VALID));

    const [email] = h.emails;
    expect(email.html).toMatch(/again at checkout/i);
    expect(email.html).toMatch(/nothing is locked in/i);
    expect(email.text).toMatch(/again at checkout/i);
    expect(email.html).not.toMatch(/\$\d/);
    expect(email.text).not.toMatch(/\$\d/);
  });

  test('says the link only works for the account it was sent to', async () => {
    const h = makeSendPreparedCartHarness();
    await h.handler(sendRequest(VALID));
    expect(h.emails[0].text).toMatch(/only for the account it was sent to/i);
  });

  test('greets by first name, and falls back to a plain hello with no name on file', async () => {
    const named = makeSendPreparedCartHarness();
    await named.handler(sendRequest(VALID));
    expect(named.emails[0].text.startsWith('Hi Ada,')).toBe(true);

    const anon = makeSendPreparedCartHarness();
    anon.cart = preparedCartFixture({ display_name: null });
    await anon.handler(sendRequest(VALID));
    expect(anon.emails[0].text.startsWith('Hello,')).toBe(true);
  });

  test('a blank display name does not produce "Hi ,"', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ display_name: '   ' });
    await h.handler(sendRequest(VALID));
    expect(h.emails[0].text.startsWith('Hello,')).toBe(true);
  });

  test('the coupon code and the note are carried through when present', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ coupon_code: 'SPRING20', note: 'For the Tuesday run' });
    await h.handler(sendRequest(VALID));

    const [email] = h.emails;
    expect(email.html).toContain('SPRING20');
    expect(email.html).toContain('For the Tuesday run');
    expect(email.text).toContain('SPRING20');
    expect(email.text).toContain('For the Tuesday run');
  });

  test('a blank coupon/note is omitted rather than rendered empty', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ coupon_code: '  ', note: '  ' });
    await h.handler(sendRequest(VALID));
    expect(h.emails[0].html).not.toMatch(/is applied when you open the cart/);
  });

  test('an admin-authored note is HTML-escaped', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ note: '<script>alert(1)</script>' });
    await h.handler(sendRequest(VALID));

    expect(h.emails[0].html).not.toContain('<script>');
    expect(h.emails[0].html).toContain('&lt;script&gt;');
  });

  test('a missing expiry degrades to the shorter sentence, never "until undefined"', async () => {
    const h = makeSendPreparedCartHarness();
    h.cart = preparedCartFixture({ expires_at: undefined });
    await h.handler(sendRequest(VALID));

    expect(h.emails[0].text).not.toMatch(/undefined|Invalid Date/);
    expect(h.emails[0].html).not.toMatch(/undefined|Invalid Date/);
  });

  test('a delivery failure is a 502 carrying the provider detail', async () => {
    const h = makeSendPreparedCartHarness();
    h.emailResponder = () => ({ status: 422, body: { message: 'Domain not verified' } });

    const res = await h.handler(sendRequest(VALID));
    expect(res.status).toBe(502);
    expect(await readJson(res)).toMatchObject({
      error: 'Email delivery failed.',
      detail: { message: 'Domain not verified' },
    });
  });
});

/* ── The two pure helpers ──────────────────────────────────────────────────── */

describe('formatExpiry', () => {
  test('renders an unambiguous long-form date in UTC', () => {
    expect(formatExpiry('2026-08-13T00:00:00Z')).toBe('August 13, 2026');
  });

  test.each([
    ['undefined', undefined],
    ['an unparseable string', 'not-a-date'],
  ])('%s becomes an empty string, so callers can drop the sentence', (_label, iso) => {
    expect(formatExpiry(iso)).toBe('');
  });
});

describe('describeLine', () => {
  test('names the sku, the dose and the quantity', () => {
    expect(describeLine({ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 })).toBe('VSR-RS-BPC (10mg) × 2');
  });

  test('a single-config line carries no empty parentheses', () => {
    expect(describeLine({ sku: 'VSR-LE-MIX', dose: '', quantity: 1 })).toBe('VSR-LE-MIX × 1');
  });
});
