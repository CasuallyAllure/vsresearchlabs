/**
 * Orchestration suite for the send-member-offer handler
 * (supabase/functions/send-member-offer/handler.ts) — the admin member-offer
 * campaign email. Pins the gate ordering, every validation branch (including
 * the campaign key that IS the idempotency period), the consent refusal, the
 * insert-then-send claim and its release on delivery failure, and the exact
 * Resend payload.
 */

import { describe, expect, test } from 'vitest';
import { EMAIL_BRAND } from '../../supabase/functions/_shared/emailBrand';
import {
  buildOfferHtml,
  buildOfferText,
  formatOfferDate,
} from '../../supabase/functions/send-member-offer/handler';
import {
  GATE_FAIL,
  TEST_CORS,
  campaignRecipientFixture,
  jsonRequest,
  makeSendMemberOfferHarness,
  readJson,
} from '../helpers/miscFnsHarness';

const VALID = {
  contact: 'ada@example.com',
  subject: 'A member-only rate this week',
  body: 'Hello,\n\n30% off through Friday.',
  campaign_key: 'member30-2026-08-24',
  offer: { code: 'member30', percent: 30, expires_on: '2026-08-28' },
};

function offerRequest(body: unknown, opts: { method?: string; rawBody?: string } = {}): Request {
  return jsonRequest('send-member-offer', body, opts);
}

describe('preflight + gate ordering', () => {
  test('OPTIONS short-circuits to 204 with CORS headers BEFORE the admin gate', async () => {
    const h = makeSendMemberOfferHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(offerRequest(undefined, { method: 'OPTIONS' }));

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TEST_CORS['Access-Control-Allow-Origin']);
    expect(h.gateCalls).toHaveLength(0);
  });

  test('failed admin gate → its status/body verbatim, nothing sent or claimed', async () => {
    const h = makeSendMemberOfferHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(offerRequest(VALID));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Unauthorized' });
    expect(h.emails).toHaveLength(0);
    expect(h.claims).toHaveLength(0);
  });

  test('non-POST after a passing gate → 405', async () => {
    const h = makeSendMemberOfferHarness();

    const res = await h.handler(offerRequest(VALID, { method: 'GET' }));

    expect(res.status).toBe(405);
    expect(await readJson(res)).toEqual({ error: 'Method not allowed.' });
  });

  test('missing Resend key → 500 before anything is read', async () => {
    const h = makeSendMemberOfferHarness({ resendApiKey: '' });

    const res = await h.handler(offerRequest(VALID));

    expect(res.status).toBe(500);
    expect(await readJson(res)).toEqual({ error: 'Email service not configured.' });
    expect(h.claims).toHaveLength(0);
  });
});

describe('payload validation', () => {
  test('unparseable body → 400', async () => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest(undefined, { rawBody: '{not json' }));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Invalid JSON body.' });
  });

  test.each([
    ['missing contact', { ...VALID, contact: '' }, 'A valid contact email is required.'],
    ['malformed contact', { ...VALID, contact: 'ada@' }, 'A valid contact email is required.'],
    ['missing subject', { ...VALID, subject: '   ' }, 'Subject is required.'],
    ['missing body', { ...VALID, body: '' }, 'Message body is required.'],
  ])('%s → 400', async (_label, payload, message) => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest(payload));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: message });
    expect(h.emails).toHaveLength(0);
  });

  test('over-long subject → 400', async () => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest({ ...VALID, subject: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Subject must be 200 characters or fewer.' });
  });

  test('over-long body → 400', async () => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest({ ...VALID, body: 'x'.repeat(5001) }));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Message must be 5000 characters or fewer.' });
  });

  test.each([
    ['absent', undefined],
    ['too short', 'ab'],
    ['illegal characters', 'summer sale!'],
    ['too long', 'a'.repeat(65)],
  ])('campaign key %s → 400, because the key IS the idempotency period', async (_label, key) => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest({ ...VALID, campaign_key: key }));
    expect(res.status).toBe(400);
    expect(String((await readJson(res)).error)).toMatch(/campaign key/i);
    expect(h.claims).toHaveLength(0);
  });

  test.each([
    ['bad code', { code: 'xy', percent: 30 }, /Offer code/],
    ['fractional percent', { code: 'M30', percent: 30.5 }, /percent/],
    ['percent out of range', { code: 'M30', percent: 0 }, /percent/],
    ['bad expiry', { code: 'M30', percent: 30, expires_on: 'friday' }, /YYYY-MM-DD/],
  ])('invalid offer (%s) → 400', async (_label, offer, pattern) => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest({ ...VALID, offer }));
    expect(res.status).toBe(400);
    expect(String((await readJson(res)).error)).toMatch(pattern);
    expect(h.emails).toHaveLength(0);
  });

  test('no offer at all is valid — a plain member note still sends', async () => {
    const h = makeSendMemberOfferHarness();
    const res = await h.handler(offerRequest({ ...VALID, offer: null }));
    expect(res.status).toBe(200);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].html).not.toContain('one use per account');
    expect(h.claims[0].metadata).toMatchObject({ offer_code: null, offer_percent: null });
  });
});

describe('recipient resolution + consent', () => {
  test('lookup failure → 502, nothing claimed', async () => {
    const h = makeSendMemberOfferHarness();
    h.recipientThrows = new Error('boom');
    const res = await h.handler(offerRequest(VALID));
    expect(res.status).toBe(502);
    expect(await readJson(res)).toEqual({ error: 'Could not read that member.' });
    expect(h.claims).toHaveLength(0);
  });

  test('not a member → 404', async () => {
    const h = makeSendMemberOfferHarness();
    h.recipient = null;
    const res = await h.handler(offerRequest(VALID));
    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ error: 'That address is not a member.' });
    expect(h.emails).toHaveLength(0);
  });

  test('opted out → 200 with status opted_out, and NOTHING is sent or claimed', async () => {
    const h = makeSendMemberOfferHarness();
    h.recipient = campaignRecipientFixture({ optOut: true });
    const res = await h.handler(offerRequest(VALID));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: false, status: 'opted_out', recipient: 'ada@example.com' });
    expect(h.emails).toHaveLength(0);
    expect(h.claims).toHaveLength(0);
  });
});

describe('claim, send, release', () => {
  test('claim conflict → 200 already_sent, no second email', async () => {
    const h = makeSendMemberOfferHarness();
    h.claimResult = false;
    const res = await h.handler(offerRequest(VALID));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: false, status: 'already_sent', recipient: 'ada@example.com' });
    expect(h.emails).toHaveLength(0);
  });

  test('claim failure → 502, nothing sent', async () => {
    const h = makeSendMemberOfferHarness();
    h.claimThrows = new Error('db down');
    const res = await h.handler(offerRequest(VALID));
    expect(res.status).toBe(502);
    expect(await readJson(res)).toEqual({ error: 'Could not record the send.' });
    expect(h.emails).toHaveLength(0);
  });

  test('the claim is keyed by (recipient, campaign key) and carries the offer', async () => {
    const h = makeSendMemberOfferHarness();
    await h.handler(offerRequest(VALID));
    expect(h.claims).toEqual([
      {
        userId: '11111111-1111-4111-8111-111111111111',
        recipient: 'ada@example.com',
        periodKey: 'member30-2026-08-24',
        metadata: {
          campaign_key: 'member30-2026-08-24',
          subject: VALID.subject,
          offer_code: 'MEMBER30',
          offer_percent: 30,
        },
      },
    ]);
  });

  test('a member with no linked auth user still claims (userId null)', async () => {
    const h = makeSendMemberOfferHarness();
    h.recipient = campaignRecipientFixture({ userId: null });
    await h.handler(offerRequest(VALID));
    expect(h.claims[0].userId).toBeNull();
  });

  test('delivery failure → 502 AND the claim is released so a retry is possible', async () => {
    const h = makeSendMemberOfferHarness();
    h.emailResponder = () => ({ status: 422, body: { message: 'rejected' } });

    const res = await h.handler(offerRequest(VALID));

    expect(res.status).toBe(502);
    expect(await readJson(res)).toEqual({ error: 'Email delivery failed.', detail: { message: 'rejected' } });
    expect(h.releases).toEqual([{ recipient: 'ada@example.com', periodKey: 'member30-2026-08-24' }]);
  });

  test('a failing release never masks the delivery failure', async () => {
    const h = makeSendMemberOfferHarness();
    h.emailResponder = () => ({ status: 500, body: null });
    h.releaseThrows = new Error('delete failed');

    const res = await h.handler(offerRequest(VALID));

    expect(res.status).toBe(502);
    expect(String((await readJson(res)).error)).toBe('Email delivery failed.');
  });

  test('success → 200 sent, with the exact Resend payload', async () => {
    const h = makeSendMemberOfferHarness();

    const res = await h.handler(offerRequest(VALID));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      ok: true,
      status: 'sent',
      recipient: 'ada@example.com',
      kind: 'campaign',
      campaignKey: 'member30-2026-08-24',
    });
    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.to).toBe('ada@example.com');
    expect(email.subject).toBe(VALID.subject);
    expect(email.reply_to).toBe(EMAIL_BRAND.opsEmail);
    // The code is normalized to the shape coupons are stored in (031).
    expect(email.html).toContain('MEMBER30');
    expect(email.html).toContain('August 28, 2026');
    expect(email.text).toContain('Code: MEMBER30 — 30% off');
    // Marketing consent pointer, on every campaign send.
    expect(email.html).toContain('Manage email preferences');
    expect(email.text).toContain('Manage email preferences');
  });

  test('the contact is normalized before every downstream use', async () => {
    const h = makeSendMemberOfferHarness();
    await h.handler(offerRequest({ ...VALID, contact: '  Ada@Example.com ', campaign_key: 'Member30-2026-08-24' }));
    expect(h.emails[0].to).toBe('ada@example.com');
    expect(h.claims[0].periodKey).toBe('member30-2026-08-24');
  });
});

describe('composition', () => {
  test('admin-supplied text is HTML-escaped, never injected', () => {
    const html = buildOfferHtml({
      subject: 'Hi',
      body: '<script>alert(1)</script> & "quotes"',
      offer: null,
      catalogUrl: 'https://example.test/catalog',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('an offer without an expiry omits the deadline line rather than inventing one', () => {
    const offer = { code: 'MEMBER30', percent: 30, expiresOn: null };
    const html = buildOfferHtml({ subject: 'Hi', body: 'Hello', offer, catalogUrl: 'u' });
    expect(html).toContain('Enter the code at checkout.');
    expect(html).not.toContain('Valid through');
    expect(buildOfferText({ body: 'Hello', offer, catalogUrl: 'u' })).not.toContain('Valid through');
  });

  test('an unparseable date formats to nothing instead of "Invalid Date"', () => {
    expect(formatOfferDate('not-a-date')).toBe('');
    expect(formatOfferDate(null)).toBe('');
  });
});
