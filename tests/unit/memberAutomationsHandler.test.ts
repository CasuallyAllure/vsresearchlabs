/**
 * Orchestration suite for the member-automations handler
 * (supabase/functions/member-automations/handler.ts) — the DARK-by-default
 * membership automation runner.
 *
 * Pins the whole safety contract: the fail-closed secret gate (unset secret →
 * 503 before ANY outbound call; wrong/missing header → 401), the
 * insert-then-send claim ordering (email_log POST lands BEFORE the Resend
 * call), conflict-skip (409 claim → no send), dry_run evaluating without
 * claiming or sending, disabled kinds never being evaluated, per-kind error
 * surfacing (the workflow greps the body for "error"), and the copy
 * invariants that matter (winback's opt-out line, invite_followup's signup
 * deep link).
 *
 * Local harness (FetchMock + recorded logs, same philosophy as
 * miscFnsHarness.ts) rather than an addition to the shared helper — this
 * train touches only its own files.
 */

import { describe, expect, test } from 'vitest';
import { EMAIL_BRAND } from '../../supabase/functions/_shared/emailBrand';
import {
  createMemberAutomationsHandler,
  type MemberAutomationsConfig,
} from '../../supabase/functions/member-automations/handler';
import { MANAGE_PREFERENCES_LINE } from '../../supabase/functions/member-automations/templates';
import { FetchMock, jsonRequest, makeLogRecorder, readJson, type RecordedLog } from '../helpers/miscFnsHarness';

const SECRET = 'cron-secret';

interface SentEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface Harness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  logs: RecordedLog[];
  emails: SentEmail[];
  /** Bodies POSTed to /rest/v1/email_log, in claim order. */
  claims: Record<string, unknown>[];
  /** How many times the referral settlement seam was invoked. */
  settleCalls: number;
}

interface HarnessOpts {
  config?: Partial<MemberAutomationsConfig>;
  /** kind → enabled, rendered into the settings response. Default all off. */
  enabled?: Record<string, boolean>;
  /** kind → candidate rows the automation_candidates RPC returns. */
  candidates?: Record<string, unknown[]>;
  /** Status for email_log claim inserts (default 201). */
  claimStatus?: number;
  /** Status for the Resend send (default 200). */
  resendStatus?: number;
  /** settle_referral_conversions() result, or an Error it should throw. */
  settle?: number | Error;
}

const ALL_KINDS = [
  'reward_ready', 'invite_followup', 'winback', 'discount_expiry', 'welcome',
  'review_request', 'referral_bonus',
];

function makeHarness(opts: HarnessOpts = {}): Harness {
  const config: MemberAutomationsConfig = {
    supabaseUrl: 'http://supabase.mock',
    serviceKey: 'service-role-key',
    cronSecret: SECRET,
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    ...opts.config,
  };
  const fetchMock = new FetchMock();
  const { logs, logEvent } = makeLogRecorder();
  const emails: SentEmail[] = [];
  const claims: Record<string, unknown>[] = [];

  fetchMock.onUrl('/rest/v1/automation_settings', () => {
    const settings = ALL_KINDS.map((kind) => ({ kind, enabled: opts.enabled?.[kind] === true }));
    return new Response(JSON.stringify(settings), { status: 200 });
  });
  fetchMock.onUrl('/rest/v1/rpc/automation_candidates', (_url, init) => {
    const { p_kind } = JSON.parse(String(init?.body ?? '{}')) as { p_kind: string };
    return new Response(JSON.stringify(opts.candidates?.[p_kind] ?? []), { status: 200 });
  });
  fetchMock.onUrl('/rest/v1/email_log', (_url, init) => {
    claims.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(null, { status: opts.claimStatus ?? 201 });
  });
  fetchMock.onUrl('api.resend.com/emails', (_url, init) => {
    emails.push(JSON.parse(String(init?.body ?? '{}')) as SentEmail);
    return new Response(JSON.stringify({ id: 'email-1' }), { status: opts.resendStatus ?? 200 });
  });

  const state = { settleCalls: 0 };
  const handler = createMemberAutomationsHandler(config, {
    fetch: fetchMock.fn,
    logEvent,
    settleReferrals: async () => {
      state.settleCalls += 1;
      if (opts.settle instanceof Error) throw opts.settle;
      return typeof opts.settle === 'number' ? opts.settle : 0;
    },
  });

  return {
    handler,
    fetchMock,
    logs,
    emails,
    claims,
    get settleCalls() { return state.settleCalls; },
  };
}

function autoRequest(
  body: unknown = {},
  opts: { method?: string; secret?: string | null } = {},
): Request {
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  return jsonRequest('member-automations', body, {
    method: opts.method,
    headers: secret === null ? {} : { 'x-automations-secret': secret },
  });
}

const REWARD_CANDIDATE = { userId: 'u1', recipient: 'ada@example.test', periodKey: 'rr-1', points: 420 };

describe('the fail-closed gate', () => {
  test('non-POST → 405, nothing fetched', async () => {
    const h = makeHarness();
    const res = await h.handler(autoRequest(undefined, { method: 'GET' }));

    expect(res.status).toBe(405);
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test('unset AUTOMATIONS_CRON_SECRET → 503 "not configured", nothing fetched', async () => {
    const h = makeHarness({ config: { cronSecret: '' } });
    const res = await h.handler(autoRequest());

    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: 'not configured' });
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test.each([
    ['missing supabaseUrl', { supabaseUrl: '' }],
    ['missing serviceKey', { serviceKey: '' }],
  ])('%s → 503 fail-closed', async (_label, override) => {
    const h = makeHarness({ config: override });
    const res = await h.handler(autoRequest());

    expect(res.status).toBe(503);
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test.each([
    ['missing header', null],
    ['wrong header', 'not-the-secret'],
  ])('%s → 401, nothing fetched', async (_label, secret) => {
    const h = makeHarness();
    const res = await h.handler(autoRequest({}, { secret }));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'unauthorized' });
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test('live run with no Resend key → 503; dry_run still works', async () => {
    const live = makeHarness({ config: { resendApiKey: '' } });
    const liveRes = await live.handler(autoRequest());
    expect(liveRes.status).toBe(503);
    expect(live.fetchMock.calls).toHaveLength(0);

    const dry = makeHarness({
      config: { resendApiKey: '' },
      enabled: { reward_ready: true },
      candidates: { reward_ready: [REWARD_CANDIDATE] },
    });
    const dryRes = await dry.handler(autoRequest({ dry_run: true }));
    expect(dryRes.status).toBe(200);
    const body = await readJson(dryRes);
    expect(body.dryRun).toBe(true);
  });
});

describe('settings + disabled kinds', () => {
  test('all kinds disabled → no candidate RPC, no claims, no sends', async () => {
    const h = makeHarness();
    const res = await h.handler(autoRequest());
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(false);
    const kinds = body.kinds as Record<string, Record<string, unknown>>;
    for (const kind of ALL_KINDS) {
      expect(kinds[kind]).toEqual({ enabled: false, candidates: 0, sent: 0, skippedClaimed: 0, failed: 0 });
    }
    // The only outbound call was the settings load.
    expect(h.fetchMock.calls).toHaveLength(1);
    expect(h.emails).toHaveLength(0);
    expect(h.claims).toHaveLength(0);
  });

  test('settings load failure → 502 with an error body (the workflow pages)', async () => {
    const h = makeHarness();
    h.fetchMock.onUrl('/rest/v1/automation_settings', () => new Response('down', { status: 500 }));

    const res = await h.handler(autoRequest());

    expect(res.status).toBe(502);
    expect(await readJson(res)).toEqual({ ok: false, error: 'settings unavailable' });
    expect(h.logs.some((l) => l.severity === 'error' && l.message === 'settings load failed')).toBe(true);
  });

  test('a null candidates payload is treated as zero candidates', async () => {
    const h = makeHarness({ enabled: { reward_ready: true } });
    h.fetchMock.onUrl('/rest/v1/rpc/automation_candidates', () => new Response('null', { status: 200 }));

    const res = await h.handler(autoRequest());
    const kinds = (await readJson(res)).kinds as Record<string, Record<string, unknown>>;

    expect(kinds.reward_ready).toEqual({ enabled: true, candidates: 0, sent: 0, skippedClaimed: 0, failed: 0 });
    expect(h.emails).toHaveLength(0);
  });

  test('candidate evaluation failure → per-kind "error" in the body, other kinds still run', async () => {
    const h = makeHarness({
      enabled: { reward_ready: true, welcome: true },
      candidates: { welcome: [{ userId: 'u2', recipient: 'new@example.test', periodKey: 'wc-once' }] },
    });
    h.fetchMock.on(
      (url, init) =>
        url.includes('/rest/v1/rpc/automation_candidates') &&
        String(init?.body ?? '').includes('reward_ready'),
      () => new Response('boom', { status: 500 }),
    );

    const res = await h.handler(autoRequest());
    const kinds = (await readJson(res)).kinds as Record<string, Record<string, unknown>>;

    expect(kinds.reward_ready.error).toBe('candidate evaluation failed');
    expect(kinds.reward_ready.sent).toBe(0);
    expect(kinds.welcome.sent).toBe(1);
    expect(h.logs.some((l) => l.message === 'candidate evaluation failed for reward_ready')).toBe(true);
  });
});

describe('insert-then-send', () => {
  test('enabled reward_ready: claims into email_log FIRST, then sends via Resend', async () => {
    const h = makeHarness({
      enabled: { reward_ready: true },
      candidates: { reward_ready: [REWARD_CANDIDATE] },
    });

    const res = await h.handler(autoRequest());
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect((body.kinds as Record<string, unknown>).reward_ready).toEqual({
      enabled: true, candidates: 1, sent: 1, skippedClaimed: 0, failed: 0,
    });

    // The claim: service-role insert with the metadata extras, minimal return.
    expect(h.claims).toHaveLength(1);
    expect(h.claims[0]).toEqual({
      user_id: 'u1',
      recipient: 'ada@example.test',
      kind: 'reward_ready',
      period_key: 'rr-1',
      metadata: { points: 420 },
    });
    const claimCall = h.fetchMock.calls.find((c) => c.url.includes('/rest/v1/email_log'));
    expect((claimCall?.init?.headers as Record<string, string>).Prefer).toBe('return=minimal');
    expect((claimCall?.init?.headers as Record<string, string>).Authorization).toBe('Bearer service-role-key');

    // Ordering: the email_log insert happens strictly BEFORE the Resend call.
    const claimIdx = h.fetchMock.calls.findIndex((c) => c.url.includes('/rest/v1/email_log'));
    const sendIdx = h.fetchMock.calls.findIndex((c) => c.url.includes('api.resend.com'));
    expect(claimIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(claimIdx);

    // The send itself.
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].from).toBe('VSR Test <from@test.example>');
    expect(h.emails[0].to).toBe('ada@example.test');
    expect(h.emails[0].subject).toBe('Your reward credit is available');
    expect(h.emails[0].html).toContain('420');
    expect(h.emails[0].html).toContain(EMAIL_BRAND.name);
  });

  test('claim conflict (409) → skippedClaimed, NO send', async () => {
    const h = makeHarness({
      enabled: { reward_ready: true },
      candidates: { reward_ready: [REWARD_CANDIDATE] },
      claimStatus: 409,
    });

    const res = await h.handler(autoRequest());
    const kinds = (await readJson(res)).kinds as Record<string, Record<string, unknown>>;

    expect(kinds.reward_ready).toEqual({
      enabled: true, candidates: 1, sent: 0, skippedClaimed: 1, failed: 0,
    });
    expect(h.emails).toHaveLength(0);
  });

  test('claim hard-failure (500) → failed, NO send, error logged', async () => {
    const h = makeHarness({
      enabled: { reward_ready: true },
      candidates: { reward_ready: [REWARD_CANDIDATE] },
      claimStatus: 500,
    });

    const res = await h.handler(autoRequest());
    const kinds = (await readJson(res)).kinds as Record<string, Record<string, unknown>>;

    expect(kinds.reward_ready.failed).toBe(1);
    expect(kinds.reward_ready.sent).toBe(0);
    expect(h.emails).toHaveLength(0);
    expect(h.logs.some((l) => l.severity === 'error' && l.message === 'send failed for reward_ready')).toBe(true);
  });

  test('Resend failure after a claim → failed (the claim is the audit trail)', async () => {
    const h = makeHarness({
      enabled: { reward_ready: true },
      candidates: { reward_ready: [REWARD_CANDIDATE] },
      resendStatus: 500,
    });

    const res = await h.handler(autoRequest());
    const kinds = (await readJson(res)).kinds as Record<string, Record<string, unknown>>;

    expect(kinds.reward_ready).toEqual({
      enabled: true, candidates: 1, sent: 0, skippedClaimed: 0, failed: 1,
    });
    expect(h.claims).toHaveLength(1);
  });
});

describe('dry_run', () => {
  test('evaluates candidates but claims NOTHING and sends nothing', async () => {
    const h = makeHarness({
      enabled: { reward_ready: true, welcome: true },
      candidates: {
        reward_ready: [REWARD_CANDIDATE],
        welcome: [{ userId: 'u2', recipient: 'new@example.test', periodKey: 'wc-once' }],
      },
    });

    const res = await h.handler(autoRequest({ dry_run: true }));
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    const kinds = body.kinds as Record<string, Record<string, unknown>>;
    expect(kinds.reward_ready.candidates).toBe(1);
    expect(kinds.welcome.candidates).toBe(1);
    expect(kinds.reward_ready.sent).toBe(0);
    expect(h.claims).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('a malformed body is treated as a live run, not an error', async () => {
    const h = makeHarness();
    const res = await h.handler(
      jsonRequest('member-automations', undefined, {
        rawBody: '{nope',
        headers: { 'x-automations-secret': SECRET },
      }),
    );
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(false);
  });
});

describe('copy invariants', () => {
  test('winback always carries the opt-out pointer to the portal profile', async () => {
    const h = makeHarness({
      enabled: { winback: true },
      candidates: { winback: [{ userId: 'u3', recipient: 'quiet@example.test', periodKey: 'wb-2026Q3' }] },
    });

    await h.handler(autoRequest());

    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].html).toContain(MANAGE_PREFERENCES_LINE);
    expect(h.emails[0].text).toContain(MANAGE_PREFERENCES_LINE);
    // Factual register — no discount bait in the marketing kind.
    expect(h.emails[0].html.toLowerCase()).not.toContain('% off');
  });

  test('invite_followup deep-links to signup with the recipient email prefilled (never localhost)', async () => {
    const h = makeHarness({
      enabled: { invite_followup: true },
      candidates: {
        invite_followup: [{ userId: null, recipient: 'guest+t@example.test', periodKey: 'inv-abc', pointsPromised: 180 }],
      },
    });

    await h.handler(autoRequest());

    const signupUrl = `${EMAIL_BRAND.siteUrl}/account?mode=signup&email=${encodeURIComponent('guest+t@example.test')}`;
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].html).toContain(`href="${signupUrl}"`);
    expect(h.emails[0].text).toContain(signupUrl);
    expect(h.emails[0].html).not.toContain('localhost');
    // Non-account recipient: the claim's user_id is null.
    expect(h.claims[0].user_id).toBeNull();
  });

  test('discount_expiry states the expiry date factually', async () => {
    const h = makeHarness({
      enabled: { discount_expiry: true },
      candidates: {
        discount_expiry: [{
          userId: 'u4', recipient: 'biz@example.test', periodKey: 'de-d1',
          label: 'Lifetime 12.5%', percent: 12.5, expiresOn: '2026-08-05',
        }],
      },
    });

    await h.handler(autoRequest());

    expect(h.emails[0].subject).toBe('Your account discount expires 2026-08-05');
    expect(h.emails[0].html).toContain('2026-08-05');
    expect(h.emails[0].html).toContain('12.5');
  });
});

describe('review_request (089/091)', () => {
  const CANDIDATE = {
    userId: 'u9',
    recipient: 'ada@example.test',
    periodKey: 'rev-o1',
    orderNumber: 'VSR-1042',
    name: 'Ada R.',
    token: 'a'.repeat(64),
  };

  test('links to the review form with the order token, and names the order', async () => {
    const h = makeHarness({ enabled: { review_request: true }, candidates: { review_request: [CANDIDATE] } });

    await h.handler(autoRequest());

    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toBe('How did order VSR-1042 arrive?');
    expect(h.emails[0].html).toContain(`${EMAIL_BRAND.siteUrl}/review?t=${'a'.repeat(64)}`);
    // Marketing consent pointer, as on every non-transactional send.
    expect(h.emails[0].text).toContain(MANAGE_PREFERENCES_LINE);
  });

  test('asks about FULFILMENT — the copy never invites a claim about the material', async () => {
    const h = makeHarness({ enabled: { review_request: true }, candidates: { review_request: [CANDIDATE] } });

    await h.handler(autoRequest());

    expect(h.emails[0].text).toMatch(/packing, transit time, documentation/i);
    expect(h.emails[0].text).toMatch(/fulfilment only/i);
  });

  test('THE TOKEN IS A BEARER SECRET: it is in the email and NOT in the email_log claim', async () => {
    const h = makeHarness({ enabled: { review_request: true }, candidates: { review_request: [CANDIDATE] } });

    await h.handler(autoRequest());

    const claim = h.claims[0] as { metadata: Record<string, unknown> };
    expect(claim.metadata).toEqual({ orderNumber: 'VSR-1042', name: 'Ada R.' });
    expect(JSON.stringify(claim)).not.toContain('a'.repeat(64));
  });

  test('an order with no number still sends, with a generic subject', async () => {
    const h = makeHarness({
      enabled: { review_request: true },
      candidates: { review_request: [{ ...CANDIDATE, orderNumber: undefined, name: undefined }] },
    });

    await h.handler(autoRequest());

    expect(h.emails[0].subject).toBe('How did your order arrive?');
  });
});

describe('referral settlement + referral_bonus (090/091)', () => {
  test('a live run settles referrals BEFORE evaluating kinds, and reports the count', async () => {
    const h = makeHarness({ settle: 3 });

    const res = await h.handler(autoRequest());

    expect(h.settleCalls).toBe(1);
    expect((await readJson(res)).referralsGranted).toBe(3);
  });

  test('a dry run settles NOTHING — it may not mint a coupon', async () => {
    const h = makeHarness({ settle: 2 });

    const res = await h.handler(autoRequest({ dry_run: true }));

    expect(h.settleCalls).toBe(0);
    expect((await readJson(res)).referralsGranted).toBe(0);
  });

  test('a settlement failure is logged and never blocks the sends', async () => {
    const h = makeHarness({
      settle: new Error('deadlock detected'),
      enabled: { welcome: true },
      candidates: { welcome: [{ userId: 'u1', recipient: 'new@example.test', periodKey: 'wc-once' }] },
    });

    const res = await h.handler(autoRequest());

    expect(res.status).toBe(200);
    expect(h.emails).toHaveLength(1);
    expect(h.logs.some((l) => l.severity === 'error' && l.message.includes('referral settlement failed'))).toBe(true);
  });

  test('the bonus notice carries the code, the percent and the deadline', async () => {
    const h = makeHarness({
      enabled: { referral_bonus: true },
      candidates: {
        referral_bonus: [{
          userId: 'u2', recipient: 'referrer@example.test', periodKey: 'rb-c1',
          code: 'BONUS-7KQ2ZM', percent: 15, expiresOn: '2026-09-25',
        }],
      },
    });

    await h.handler(autoRequest());

    expect(h.emails[0].subject).toBe('Your referral bonus code');
    expect(h.emails[0].text).toContain('BONUS-7KQ2ZM');
    expect(h.emails[0].text).toContain('extra 15% off one order');
    expect(h.emails[0].text).toContain('2026-09-25');
  });
});
