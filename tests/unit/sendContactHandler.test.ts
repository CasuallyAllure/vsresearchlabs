/**
 * Orchestration tests — send-contact (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/
 * notificationFnsHarness) and pins every decision path: method/env gates,
 * JSON parsing, turnstile, every validation rejection, the topic whitelist,
 * the rate limit, the contact_messages insert (row shape + failure), the
 * business/buyer email pair (both best-effort — different from send-inquiry),
 * HTML escaping, and the exact response contract.
 */
import { describe, expect, test } from 'vitest';
import {
  callFn,
  contactPayload,
  makeContactHarness,
  queryHas,
  TEST_CORS,
  withContactInsert,
} from '../helpers/notificationFnsHarness';

function readyHarness() {
  return withContactInsert(makeContactHarness());
}

describe('request gates', () => {
  test('OPTIONS preflight returns 204 with the CORS headers and touches nothing', async () => {
    const h = makeContactHarness();
    const { status, response } = await callFn(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('non-POST methods are refused with 405', async () => {
    const h = makeContactHarness();
    const { status, body } = await callFn(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed.');
  });

  test('missing Resend key fails closed with 500 before any work', async () => {
    const h = makeContactHarness({ resendApiKey: '' });
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(500);
    expect(body.error).toBe('Email service not configured.');
    expect(h.db.queries).toHaveLength(0);
  });

  test.each([
    ['supabaseUrl', { supabaseUrl: '' }],
    ['supabaseServiceKey', { supabaseServiceKey: '' }],
  ] as const)('missing %s fails closed with 500', async (_label, overrides) => {
    const h = makeContactHarness(overrides);
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(500);
    expect(body.error).toBe('Database service not configured.');
  });

  test('unparseable JSON body is a 400', async () => {
    const h = makeContactHarness();
    const { status, body } = await callFn(h, undefined, { rawBody: 'not json {' });
    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body.');
  });

  test('failed turnstile verification is a 403 carrying the reason', async () => {
    const h = makeContactHarness();
    h.turnstileResult = { ok: false, reason: 'Bot check failed.' };
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(403);
    expect(body.error).toBe('Bot check failed.');
    expect(h.db.queries).toHaveLength(0);
  });

  test('failed turnstile without a reason falls back to the generic message', async () => {
    const h = makeContactHarness();
    h.turnstileResult = { ok: false };
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(403);
    expect(body.error).toBe('Verification failed.');
  });
});

describe('payload validation', () => {
  test.each([
    ['blank name', { name: '  ' }, 'Name is required.'],
    ['name too long', { name: 'x'.repeat(121) }, 'Name too long.'],
    ['missing email', { email: '' }, 'Valid email is required.'],
    ['non-email email', { email: 'not-an-email' }, 'Valid email is required.'],
    ['phone too long', { phone: '1'.repeat(51) }, 'Phone too long.'],
    ['organization too long', { organization: 'x'.repeat(201) }, 'Organization too long.'],
    ['role too long', { role_title: 'x'.repeat(121) }, 'Role too long.'],
    ['referrer too long', { referrer: 'x'.repeat(501) }, 'Referrer too long.'],
    ['empty message', { message: '' }, 'Please share a few sentences about your inquiry.'],
    ['message under 8 chars', { message: 'short' }, 'Please share a few sentences about your inquiry.'],
    ['message too long', { message: 'x'.repeat(6001) }, 'Message too long.'],
    ['unknown topic', { topic: 'spam' }, 'Invalid topic.'],
  ])('%s is a 400 with the exact message', async (_label, overrides, message) => {
    const h = makeContactHarness();
    const { status, body } = await callFn(h, contactPayload(overrides));
    expect(status).toBe(400);
    expect(body.error).toBe(message);
    expect(h.db.queries).toHaveLength(0);
  });

  test('a valid email longer than 200 chars is rejected as too long', async () => {
    const h = makeContactHarness();
    const { status, body } = await callFn(
      h,
      contactPayload({ email: `${'a'.repeat(195)}@test.example` }),
    );
    expect(status).toBe(400);
    expect(body.error).toBe('Email too long.');
  });

  test('an omitted topic defaults to general', async () => {
    const h = readyHarness();
    const { status } = await callFn(h, contactPayload());
    expect(status).toBe(200);
    const row = h.db.of('contact_messages', 'insert')[0].payload as Record<string, unknown>;
    expect(row.topic).toBe('general');
    expect(h.emails[0].html).toContain('Contact Inquiry — General Inquiry');
  });
});

describe('rate limit', () => {
  test('the 5th message in an hour from one email is a 429', async () => {
    const h = makeContactHarness();
    h.db.on('contact_messages', 'select', { count: 5 }, (q) => q.isCount);
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(429);
    expect(body.error).toBe(
      'Too many messages from this email. Please wait before sending again.',
    );
    expect(h.db.of('contact_messages', 'insert')).toHaveLength(0);
  });

  // QUIRK (pinned, not fixed): the bucket uses ilike WITHOUT escaping LIKE
  // metacharacters (place-order escapes them) — an address containing % or _
  // matches as a pattern, so e.g. a_b@x.com and aXb@x.com share a bucket.
  test('QUIRK: the email bucket is an unescaped ilike match', async () => {
    const h = readyHarness();
    await callFn(h, contactPayload({ email: 'a_b@test.example' }));
    const countQuery = h.db.of('contact_messages', 'select').find((q) => q.isCount);
    expect(countQuery).toBeDefined();
    expect(queryHas(countQuery!, 'ilike', 'email', 'a_b@test.example')).toBe(true);
  });
});

describe('persistence', () => {
  test('the contact_messages row carries the normalized payload with OPEN status', async () => {
    const h = readyHarness();
    await callFn(h, contactPayload({
      name: '  Test Sender ',
      phone: '555-0100',
      organization: 'Acme',
      role_title: 'PI',
      topic: 'procurement',
      referrer: 'a friend',
    }));
    const row = h.db.of('contact_messages', 'insert')[0].payload as Record<string, unknown>;
    expect(row).toMatchObject({
      name: 'Test Sender',
      email: 'sender@test.example',
      phone: '555-0100',
      organization: 'Acme',
      role_title: 'PI',
      topic: 'procurement',
      message: 'I would like to know more about your catalog.',
      referrer: 'a friend',
      status: 'OPEN',
      intake_channel: 'VSR-WEB-PORTAL',
    });
    expect(String(row.reference_id)).toMatch(/^VSR-MSG-\d{6}-\d{3}$/);
  });

  test('empty optional fields are stored as null', async () => {
    const h = readyHarness();
    await callFn(h, contactPayload());
    const row = h.db.of('contact_messages', 'insert')[0].payload as Record<string, unknown>;
    expect(row.phone).toBeNull();
    expect(row.organization).toBeNull();
    expect(row.role_title).toBeNull();
    expect(row.referrer).toBeNull();
  });

  test('an insert failure is a 502 and sends no email', async () => {
    const h = makeContactHarness();
    h.db.on('contact_messages', 'insert', { error: { message: 'insert died' } });
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(502);
    expect(body.error).toBe('Failed to record message. Please try again.');
    expect(h.emails).toHaveLength(0);
  });
});

describe('emails + response contract', () => {
  test('happy path sends business then buyer email and reports both flags', async () => {
    const h = readyHarness();
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      referenceId: expect.stringMatching(/^VSR-MSG-\d{6}-\d{3}$/),
      submittedAt: '2026-07-18T00:00:00.000Z',
      userCopySent: true,
      notificationSent: true,
    });

    expect(h.emails).toHaveLength(2);
    // Business first, reply-to the sender.
    expect(h.emails[0].to).toBe('biz@test.example');
    expect(h.emails[0].from).toBe('VSR Test <from@test.example>');
    expect(h.emails[0].subject).toMatch(/^Contact VSR-MSG-\d{6}-\d{3} — Test Sender$/);
    expect(h.emails[0].reply_to).toBe('sender@test.example');
    // Buyer confirmation second, no reply-to.
    expect(h.emails[1].to).toBe('sender@test.example');
    expect(h.emails[1].subject).toMatch(/^Message received — VSR-MSG-\d{6}-\d{3}$/);
    expect(h.emails[1].reply_to).toBeUndefined();
  });

  test('a business email failure is best-effort — buyer copy still sent, notificationSent:false', async () => {
    const h = readyHarness();
    h.emailResponder = (email) =>
      email.to === 'biz@test.example'
        ? { status: 500, body: { message: 'down' } }
        : { status: 200 };
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.notificationSent).toBe(false);
    expect(body.userCopySent).toBe(true);
    expect(h.emails).toHaveLength(2); // unlike send-inquiry, the buyer copy still goes out
  });

  test('a buyer email failure is best-effort — success with userCopySent:false', async () => {
    const h = readyHarness();
    h.emailResponder = (email) =>
      email.to === 'sender@test.example'
        ? { status: 500, body: { message: 'down' } }
        : { status: 200 };
    const { status, body } = await callFn(h, contactPayload());
    expect(status).toBe(200);
    expect(body.notificationSent).toBe(true);
    expect(body.userCopySent).toBe(false);
  });

  test('user-controlled fields are HTML-escaped in both emails', async () => {
    const h = readyHarness();
    await callFn(h, contactPayload({
      name: '<script>alert(1)</script>',
      message: 'hello & <world> "quoted"',
      organization: 'Acme & Sons',
      referrer: '<a href="evil">link</a>',
    }));
    for (const email of h.emails) {
      expect(email.html).not.toContain('<script>');
      expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(email.html).toContain('hello &amp; &lt;world&gt; &quot;quoted&quot;');
    }
    // Business email renders the optional rows, escaped.
    expect(h.emails[0].html).toContain('Acme &amp; Sons');
    expect(h.emails[0].html).toContain('&lt;a href=&quot;evil&quot;&gt;link&lt;/a&gt;');
  });

  test('a custom topic key outside the label map is refused, known keys render their label', async () => {
    const h = readyHarness();
    await callFn(h, contactPayload({ topic: 'media' }));
    expect(h.emails[0].html).toContain('Contact Inquiry — Media / Press');
  });
});
