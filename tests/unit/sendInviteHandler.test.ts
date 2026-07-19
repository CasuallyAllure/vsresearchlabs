/**
 * Orchestration suite for the send-invite handler
 * (supabase/functions/send-invite/handler.ts) — the admin "send invite"
 * branded email. Pins the gate ordering (admin gate BEFORE the method gate),
 * every validation branch, points sanitization, the exact Resend payload
 * (from/to/subject/html/text/reply_to), HTML escaping of admin-supplied
 * text, and the delivery-failure 502 contract.
 */

import { describe, expect, test } from 'vitest';
import { EMAIL_BRAND } from '../../supabase/functions/_shared/emailBrand';
import {
  GATE_FAIL,
  TEST_CORS,
  jsonRequest,
  makeSendInviteHarness,
  readJson,
} from '../helpers/miscFnsHarness';

const VALID = {
  contact: 'guest@example.com',
  subject: 'Your reward points are waiting',
  body: 'Hi there,\n\nYou have 120 points banked.',
  points: 120,
};

function inviteRequest(
  body: unknown,
  opts: { method?: string; rawBody?: string } = {},
): Request {
  return jsonRequest('send-invite', body, opts);
}

describe('preflight + gate ordering', () => {
  test('OPTIONS short-circuits to 204 with CORS headers BEFORE the admin gate', async () => {
    const h = makeSendInviteHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(inviteRequest(undefined, { method: 'OPTIONS' }));

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.gateCalls).toHaveLength(0);
  });

  test('failed admin gate → its status/body verbatim, nothing sent', async () => {
    const h = makeSendInviteHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(inviteRequest(VALID));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Unauthorized' });
    expect(h.emails).toHaveLength(0);
  });

  test('QUIRK (pinned): the admin gate runs before the method gate, so a bad-method request with a failing gate gets 401, not 405', async () => {
    const h = makeSendInviteHarness();
    h.gateResult = GATE_FAIL;

    const res = await h.handler(inviteRequest(undefined, { method: 'GET' }));

    expect(res.status).toBe(401);
  });

  test('gate ok + non-POST → 405', async () => {
    const h = makeSendInviteHarness();
    const res = await h.handler(inviteRequest(undefined, { method: 'GET' }));

    expect(res.status).toBe(405);
    expect(await readJson(res)).toEqual({ error: 'Method not allowed.' });
  });

  test('missing RESEND_API_KEY → 500 fail-closed, nothing sent', async () => {
    const h = makeSendInviteHarness({ resendApiKey: '' });
    const res = await h.handler(inviteRequest(VALID));

    expect(res.status).toBe(500);
    expect(await readJson(res)).toEqual({ error: 'Email service not configured.' });
    expect(h.emails).toHaveLength(0);
  });
});

describe('validation', () => {
  test('invalid JSON body → 400', async () => {
    const h = makeSendInviteHarness();
    const res = await h.handler(inviteRequest(undefined, { rawBody: '{nope' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Invalid JSON body.' });
  });

  test.each([
    ['empty contact', { ...VALID, contact: '' }, 'A valid contact email is required.'],
    ['malformed contact', { ...VALID, contact: 'not-an-email' }, 'A valid contact email is required.'],
    ['contact with spaces', { ...VALID, contact: 'a b@c.com' }, 'A valid contact email is required.'],
    ['empty subject', { ...VALID, subject: '' }, 'Subject is required.'],
    ['whitespace subject', { ...VALID, subject: '   ' }, 'Subject is required.'],
    ['201-char subject', { ...VALID, subject: 'x'.repeat(201) }, 'Subject must be 200 characters or fewer.'],
    ['empty body', { ...VALID, body: '' }, 'Message body is required.'],
    ['5001-char body', { ...VALID, body: 'x'.repeat(5001) }, 'Message must be 5000 characters or fewer.'],
  ])('rejects %s with the exact message', async (_label, payload, message) => {
    const h = makeSendInviteHarness();
    const res = await h.handler(inviteRequest(payload));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: message });
    expect(h.emails).toHaveLength(0);
  });

  test('boundary lengths (200-char subject, 5000-char body) are accepted', async () => {
    const h = makeSendInviteHarness();
    const res = await h.handler(
      inviteRequest({ ...VALID, subject: 's'.repeat(200), body: 'b'.repeat(5000) }),
    );

    expect(res.status).toBe(200);
  });

  test.each([
    [-5, 0],
    [4.7, 4],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    ['12' as unknown as number, 0],
    [undefined, 0],
  ])('points %s sanitizes to %i in the response', async (points, expected) => {
    const h = makeSendInviteHarness();
    const res = await h.handler(inviteRequest({ ...VALID, points }));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true, contact: VALID.contact, points: expected });
  });
});

describe('the sent email', () => {
  test('POSTs exactly one Resend email with the composed fields', async () => {
    const h = makeSendInviteHarness();
    const res = await h.handler(inviteRequest(VALID));

    expect(res.status).toBe(200);
    expect(h.fetchMock.calls).toHaveLength(1);
    expect(h.fetchMock.calls[0].url).toBe('https://api.resend.com/emails');
    expect(
      (h.fetchMock.calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe('Bearer re_test_key');

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0];
    expect(email.from).toBe('VSR Test <from@test.example>');
    expect(email.to).toBe(VALID.contact);
    expect(email.subject).toBe(VALID.subject);
    expect(email.reply_to).toBe(EMAIL_BRAND.opsEmail);

    const signupUrl = `${EMAIL_BRAND.siteUrl}/account?mode=signup&email=${encodeURIComponent(VALID.contact)}`;
    expect(email.html).toContain(`href="${signupUrl}"`);
    expect(email.text).toBe(`${VALID.body}\n\n${signupUrl}`);
    // pre-wrap body rendered escaped inside the branded chrome.
    expect(email.html).toContain('You have 120 points banked.');
    expect(email.html).toContain(EMAIL_BRAND.name);
  });

  test('escapes admin-supplied HTML in subject, body, and contact', async () => {
    const h = makeSendInviteHarness();
    await h.handler(
      inviteRequest({
        ...VALID,
        contact: 'guest+<x>@example.com',
        subject: '<script>alert(1)</script>',
        body: 'Hello <b>&</b> "friends"',
      }),
    );

    const html = h.emails[0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Hello &lt;b&gt;&amp;&lt;/b&gt; &quot;friends&quot;');
    expect(html).toContain('guest+&lt;x&gt;@example.com');
  });

  test('trims whitespace before composing', async () => {
    const h = makeSendInviteHarness();
    const res = await h.handler(
      inviteRequest({ contact: '  guest@example.com  ', subject: '  Hi  ', body: '  Yo  ' }),
    );

    expect(res.status).toBe(200);
    expect(h.emails[0].to).toBe('guest@example.com');
    expect(h.emails[0].subject).toBe('Hi');
    expect(h.emails[0].text?.startsWith('Yo\n\n')).toBe(true);
  });

  test('Resend rejection → 502 with the provider body as detail', async () => {
    const h = makeSendInviteHarness();
    h.emailResponder = () => ({ status: 422, body: { message: 'invalid from' } });

    const res = await h.handler(inviteRequest(VALID));

    expect(res.status).toBe(502);
    expect(await readJson(res)).toEqual({
      error: 'Email delivery failed.',
      detail: { message: 'invalid from' },
    });
  });
});
