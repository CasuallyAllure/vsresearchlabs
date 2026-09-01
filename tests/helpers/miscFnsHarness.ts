/**
 * Test harness for the five small edge-function orchestrations extracted on
 * 2026-07-18 (health, reconcile, send-invite, report-error, resolve-video),
 * adapted from placeOrderHarness.ts's philosophy: script every runtime seam,
 * record everything, and assert ONLY observable behavior (Responses, recorded
 * fetches/uploads/logs) — never handler internals.
 *
 * Seams provided:
 *   • FetchMock — a route-table fetch stand-in (adapted from MockDb's
 *     last-registration-wins routing). Every call is recorded; unrouted URLs
 *     throw so a test can never silently hit an unexpected endpoint.
 *   • MockStorage — the storage slice of MockDb's idea, for resolve-video's
 *     thumbnail upload + getPublicUrl.
 *   • Recorded logs — injected logEvent lands in an array.
 *   • Admin gate — controllable pass/fail stand-in for requireAdmin.
 */

import {
  createHealthHandler,
  type HealthHandlerConfig,
} from '../../supabase/functions/health/handler';
import {
  createReconcileHandler,
  type ReconcileHandlerConfig,
} from '../../supabase/functions/reconcile/handler';
import {
  createSendInviteHandler,
  type AdminGateResult,
  type SendInviteHandlerConfig,
} from '../../supabase/functions/send-invite/handler';
import { createReportErrorHandler } from '../../supabase/functions/report-error/handler';
import {
  createSendPreparedCartHandler,
  type PreparedCartEmailPayload,
  type SendPreparedCartConfig,
} from '../../supabase/functions/send-prepared-cart/handler';
import {
  createSendMemberOfferHandler,
  type CampaignRecipient,
  type SendMemberOfferConfig,
} from '../../supabase/functions/send-member-offer/handler';
import {
  createResolveVideoHandler,
  type ResolveVideoHandlerConfig,
  type VideoSupabaseClient,
} from '../../supabase/functions/resolve-video/handler';

export type { AdminGateResult };

// ---------------------------------------------------------------------------
// FetchMock — recorded, route-table fetch
// ---------------------------------------------------------------------------

export interface RecordedFetch {
  url: string;
  init?: RequestInit;
}

type FetchResponder = (url: string, init?: RequestInit) => Response | Promise<Response>;

interface FetchRoute {
  match: (url: string, init?: RequestInit) => boolean;
  respond: FetchResponder;
}

export class FetchMock {
  /** Every fetch call, in execution order. */
  calls: RecordedFetch[] = [];
  private routes: FetchRoute[] = [];

  /** Register a responder. LAST registration wins, so tests override defaults. */
  on(match: FetchRoute['match'], respond: FetchResponder): this {
    this.routes.push({ match, respond });
    return this;
  }

  /** Convenience: route by URL substring. */
  onUrl(substring: string, respond: FetchResponder): this {
    return this.on((url) => url.includes(substring), respond);
  }

  fn = async (url: string, init?: RequestInit): Promise<Response> => {
    this.calls.push({ url, init });
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const route = this.routes[i];
      if (route.match(url, init)) return route.respond(url, init);
    }
    throw new Error(`FetchMock: no route registered for ${url}`);
  };
}

/** JSON Response shorthand. */
export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A Response whose `.url` reports `finalUrl` — constructed Responses have an
 * empty url, but expandUrl() reads `res.url` after redirect-follow, so tests
 * pin redirect landing spots by overriding the getter.
 */
export function responseWithUrl(finalUrl: string, status = 200): Response {
  const res = new Response(null, { status });
  Object.defineProperty(res, 'url', { value: finalUrl });
  return res;
}

// ---------------------------------------------------------------------------
// Recorded telemetry
// ---------------------------------------------------------------------------

export interface RecordedLog {
  severity: string;
  fn: string;
  message: string;
  ctx?: Record<string, unknown>;
}

export function makeLogRecorder(): {
  logs: RecordedLog[];
  logEvent: (severity: 'info' | 'warn' | 'error' | 'fatal', fn: string, message: string, ctx?: Record<string, unknown>) => void;
} {
  const logs: RecordedLog[] = [];
  return {
    logs,
    logEvent: (severity, fn, message, ctx) => {
      logs.push({ severity, fn, message, ctx });
    },
  };
}

/** Byte-identical copy of _shared/telemetry.ts's truncate — injected into the
 *  report-error handler so truncation pins match production exactly. (The
 *  real module reads Deno.env at load and is typechecked by deno, not tsc,
 *  so tests cannot import it directly.) */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `…[+${s.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

export const TEST_CORS = { 'Access-Control-Allow-Origin': 'https://test.example' };

export const GATE_PASS: AdminGateResult = { ok: true, status: 200 };
export const GATE_FAIL: AdminGateResult = {
  ok: false,
  status: 401,
  body: { error: 'Unauthorized' },
};

export function jsonRequest(
  path: string,
  body: unknown,
  opts: { method?: string; rawBody?: string; headers?: Record<string, string> } = {},
): Request {
  const method = opts.method ?? 'POST';
  return new Request(`http://localhost/functions/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body:
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
        ? undefined
        : opts.rawBody ?? JSON.stringify(body ?? {}),
  });
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.clone().json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

export interface HealthHarness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  config: HealthHandlerConfig;
}

export function makeHealthHarness(overrides: Partial<HealthHandlerConfig> = {}): HealthHarness {
  const config: HealthHandlerConfig = {
    supabaseUrl: 'http://supabase.mock',
    serviceKey: 'service-role-key',
    ...overrides,
  };
  const fetchMock = new FetchMock();
  return { handler: createHealthHandler(config, { fetch: fetchMock.fn }), fetchMock, config };
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

export interface ReconcileHarness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  logs: RecordedLog[];
  config: ReconcileHandlerConfig;
}

export function makeReconcileHarness(
  overrides: Partial<ReconcileHandlerConfig> = {},
): ReconcileHarness {
  const config: ReconcileHandlerConfig = {
    supabaseUrl: 'http://supabase.mock',
    serviceKey: 'service-role-key',
    ...overrides,
  };
  const fetchMock = new FetchMock();
  const { logs, logEvent } = makeLogRecorder();
  return {
    handler: createReconcileHandler(config, { fetch: fetchMock.fn, logEvent }),
    fetchMock,
    logs,
    config,
  };
}

// ---------------------------------------------------------------------------
// send-invite
// ---------------------------------------------------------------------------

/** Resend POST body as send-invite builds it. */
export interface SentInviteEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
}

export interface SendInviteHarness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  /** Every Resend POST body, in send order. */
  emails: SentInviteEmail[];
  /** What requireAdmin resolves with (default pass). */
  gateResult: AdminGateResult;
  /** Requests the gate saw. */
  gateCalls: Request[];
  /** Flip to fail the Resend send. */
  emailResponder: (email: SentInviteEmail) => { status: number; body?: unknown };
  config: SendInviteHandlerConfig;
}

export function makeSendInviteHarness(
  overrides: Partial<SendInviteHandlerConfig> = {},
): SendInviteHarness {
  const config: SendInviteHandlerConfig = {
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
  const fetchMock = new FetchMock();
  const harness: SendInviteHarness = {
    handler: undefined as unknown as SendInviteHarness['handler'],
    fetchMock,
    emails: [],
    gateResult: GATE_PASS,
    gateCalls: [],
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    config,
  };
  fetchMock.onUrl('api.resend.com/emails', (_url, init) => {
    const email = JSON.parse(String(init?.body ?? '{}')) as SentInviteEmail;
    harness.emails.push(email);
    const res = harness.emailResponder(email);
    return jsonRes(res.body ?? { id: 'email-1' }, res.status);
  });
  harness.handler = createSendInviteHandler(config, {
    requireAdmin: async (req) => {
      harness.gateCalls.push(req);
      return harness.gateResult;
    },
    fetch: fetchMock.fn,
  });
  return harness;
}

// ---------------------------------------------------------------------------
// send-prepared-cart
// ---------------------------------------------------------------------------

export interface SentPreparedCartEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
}

/** One recorded email_log claim attempt. `kind` is send-member-offer only
 *  (prepared-cart's email_log kind is fixed and not passed through). */
export interface RecordedClaim {
  userId: string | null;
  recipient: string;
  periodKey: string;
  kind?: string;
  metadata: Record<string, unknown>;
}

export interface SendPreparedCartHarness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  /** Emails Resend was actually asked to send. */
  emails: SentPreparedCartEmail[];
  gateResult: AdminGateResult;
  gateCalls: Request[];
  /** What prepared_cart_email_payload answers. Overwrite per test. */
  cart: PreparedCartEmailPayload | null;
  /** Throw instead of answering, to drive the lookup-failure branch. */
  cartThrows: Error | null;
  /** email_log claim outcome: true = claimed, false = UNIQUE conflict. */
  claimResult: boolean;
  claimThrows: Error | null;
  claims: RecordedClaim[];
  /** Claims that were undone after a failed send — the retry-ability guarantee. */
  releases: Array<{ recipient: string; periodKey: string }>;
  releaseThrows: Error | null;
  emailResponder: (email: SentPreparedCartEmail) => { status: number; body?: unknown };
  config: SendPreparedCartConfig;
}

/** A live, sendable cart. Tests narrow it field by field. */
export function preparedCartFixture(
  over: Partial<PreparedCartEmailPayload> = {},
): PreparedCartEmailPayload {
  return {
    ok: true,
    user_id: '11111111-1111-4111-8111-111111111111',
    recipient: 'ada@example.com',
    display_name: 'Ada Reyes',
    marketing_opt_out: false,
    coupon_code: null,
    note: null,
    expires_at: '2026-08-13T00:00:00Z',
    revoked: false,
    expired: false,
    token_ok: true,
    lines: [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }],
    ...over,
  };
}

export function makeSendPreparedCartHarness(
  overrides: Partial<SendPreparedCartConfig> = {},
): SendPreparedCartHarness {
  const config: SendPreparedCartConfig = {
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
  const fetchMock = new FetchMock();
  const harness: SendPreparedCartHarness = {
    handler: undefined as unknown as SendPreparedCartHarness['handler'],
    fetchMock,
    emails: [],
    gateResult: GATE_PASS,
    gateCalls: [],
    cart: preparedCartFixture(),
    cartThrows: null,
    claimResult: true,
    claimThrows: null,
    claims: [],
    releases: [],
    releaseThrows: null,
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    config,
  };
  fetchMock.onUrl('api.resend.com/emails', (_url, init) => {
    const email = JSON.parse(String(init?.body ?? '{}')) as SentPreparedCartEmail;
    harness.emails.push(email);
    const res = harness.emailResponder(email);
    return jsonRes(res.body ?? { id: 'email-1' }, res.status);
  });
  harness.handler = createSendPreparedCartHandler(config, {
    requireAdmin: async (req) => {
      harness.gateCalls.push(req);
      return harness.gateResult;
    },
    fetch: fetchMock.fn,
    loadCart: async () => {
      if (harness.cartThrows) throw harness.cartThrows;
      return harness.cart;
    },
    claimSend: async (args) => {
      harness.claims.push(args);
      if (harness.claimThrows) throw harness.claimThrows;
      return harness.claimResult;
    },
    releaseSend: async (args) => {
      harness.releases.push(args);
      if (harness.releaseThrows) throw harness.releaseThrows;
    },
  });
  return harness;
}

// ---------------------------------------------------------------------------
// send-member-offer
// ---------------------------------------------------------------------------

export interface SentOfferEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
}

export interface SendMemberOfferHarness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  /** Emails Resend was actually asked to send. */
  emails: SentOfferEmail[];
  gateResult: AdminGateResult;
  gateCalls: Request[];
  /** What admin_campaign_recipients answers. Overwrite per test. */
  recipient: CampaignRecipient | null;
  /** Throw instead of answering, to drive the lookup-failure branch. */
  recipientThrows: Error | null;
  /** email_log claim outcome: true = claimed, false = UNIQUE conflict. */
  claimResult: boolean;
  claimThrows: Error | null;
  claims: RecordedClaim[];
  /** Claims undone after a failed send — the retry-ability guarantee. */
  releases: Array<{ recipient: string; periodKey: string; kind?: string }>;
  releaseThrows: Error | null;
  emailResponder: (email: SentOfferEmail) => { status: number; body?: unknown };
  config: SendMemberOfferConfig;
}

/** A consenting member. Tests narrow it field by field. */
export function campaignRecipientFixture(
  over: Partial<CampaignRecipient> = {},
): CampaignRecipient {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    name: 'Ada Reyes',
    contact: 'ada@example.com',
    optOut: false,
    ...over,
  };
}

export function makeSendMemberOfferHarness(
  overrides: Partial<SendMemberOfferConfig> = {},
): SendMemberOfferHarness {
  const config: SendMemberOfferConfig = {
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
  const fetchMock = new FetchMock();
  const harness: SendMemberOfferHarness = {
    handler: undefined as unknown as SendMemberOfferHarness['handler'],
    fetchMock,
    emails: [],
    gateResult: GATE_PASS,
    gateCalls: [],
    recipient: campaignRecipientFixture(),
    recipientThrows: null,
    claimResult: true,
    claimThrows: null,
    claims: [],
    releases: [],
    releaseThrows: null,
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    config,
  };
  fetchMock.onUrl('api.resend.com/emails', (_url, init) => {
    const email = JSON.parse(String(init?.body ?? '{}')) as SentOfferEmail;
    harness.emails.push(email);
    const res = harness.emailResponder(email);
    return jsonRes(res.body ?? { id: 'email-1' }, res.status);
  });
  harness.handler = createSendMemberOfferHandler(config, {
    requireAdmin: async (req) => {
      harness.gateCalls.push(req);
      return harness.gateResult;
    },
    fetch: fetchMock.fn,
    loadRecipient: async () => {
      if (harness.recipientThrows) throw harness.recipientThrows;
      return harness.recipient;
    },
    claimSend: async (args) => {
      harness.claims.push(args);
      if (harness.claimThrows) throw harness.claimThrows;
      return harness.claimResult;
    },
    releaseSend: async (args) => {
      harness.releases.push(args);
      if (harness.releaseThrows) throw harness.releaseThrows;
    },
  });
  return harness;
}

// ---------------------------------------------------------------------------
// report-error
// ---------------------------------------------------------------------------

export interface ReportErrorHarness {
  handler: (req: Request) => Promise<Response>;
  logs: RecordedLog[];
}

export function makeReportErrorHarness(): ReportErrorHarness {
  const { logs, logEvent } = makeLogRecorder();
  return {
    handler: createReportErrorHandler({ corsHeaders: TEST_CORS }, { logEvent, truncate }),
    logs,
  };
}

/** A report-error request from a given IP (x-forwarded-for). */
export function reportRequest(
  body: unknown,
  opts: { ip?: string; method?: string; rawBody?: string } = {},
): Request {
  return jsonRequest('report-error', body, {
    method: opts.method,
    rawBody: opts.rawBody,
    headers: opts.ip ? { 'x-forwarded-for': opts.ip } : {},
  });
}

// ---------------------------------------------------------------------------
// resolve-video
// ---------------------------------------------------------------------------

export interface RecordedUpload {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  options: { contentType: string; upsert: boolean };
}

/** Storage slice of the MockDb idea: record uploads, script the outcome. */
export class MockStorage {
  uploads: RecordedUpload[] = [];
  publicUrlCalls: string[] = [];
  uploadError: { message?: string } | null = null;
  publicUrlFor: (path: string) => string = (path) => `http://cdn.mock/${path}`;

  client(): VideoSupabaseClient {
    return {
      storage: {
        from: (bucket: string) => ({
          upload: async (
            path: string,
            body: Uint8Array,
            options: { contentType: string; upsert: boolean },
          ) => {
            this.uploads.push({ bucket, path, bytes: body, options });
            return { error: this.uploadError };
          },
          getPublicUrl: (path: string) => {
            this.publicUrlCalls.push(path);
            return { data: { publicUrl: this.publicUrlFor(path) } };
          },
        }),
      },
    };
  }
}

export interface ResolveVideoHarness {
  handler: (req: Request) => Promise<Response>;
  fetchMock: FetchMock;
  storage: MockStorage;
  /** How many times the handler built a storage client. */
  createClientCalls: { url: string; key: string }[];
  gateResult: AdminGateResult;
  gateCalls: Request[];
  config: ResolveVideoHandlerConfig;
}

export function makeResolveVideoHarness(
  overrides: Partial<ResolveVideoHandlerConfig> = {},
): ResolveVideoHarness {
  const config: ResolveVideoHandlerConfig = {
    supabaseUrl: 'http://supabase.mock',
    serviceKey: 'service-role-key',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
  const fetchMock = new FetchMock();
  const storage = new MockStorage();
  const harness: ResolveVideoHarness = {
    handler: undefined as unknown as ResolveVideoHarness['handler'],
    fetchMock,
    storage,
    createClientCalls: [],
    gateResult: GATE_PASS,
    gateCalls: [],
    config,
  };
  harness.handler = createResolveVideoHandler(config, {
    createClient: (url, key) => {
      harness.createClientCalls.push({ url, key });
      return storage.client();
    },
    requireAdmin: async (req) => {
      harness.gateCalls.push(req);
      return harness.gateResult;
    },
    fetch: fetchMock.fn,
  });
  return harness;
}

/** A resolve-video request (admin-gated POST). */
export function videoRequest(
  body: { url?: string; sku?: string } | undefined,
  opts: { method?: string; rawBody?: string } = {},
): Request {
  return jsonRequest('resolve-video', body, opts);
}
