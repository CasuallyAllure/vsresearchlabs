/**
 * Test harness for the notification/inquiry edge-function handlers:
 *
 *   • send-shipment-notification   (admin-gated, order → "shipped" email)
 *   • send-processing-notification (admin-gated, order → "processing" email)
 *   • send-delivered-notification  (admin-gated, order → "complete" email)
 *   • send-inquiry                 (public, turnstile → persist → 2 emails)
 *   • send-contact                 (public, turnstile → persist → 2 emails)
 *
 * Each create*Handler() factory takes every runtime seam as an injected
 * dependency, so this harness can drive the REAL request handlers — the exact
 * decision paths production runs — fully offline and deterministically:
 *
 *   • MockDb — a scriptable supabase-js stand-in (adapted from
 *     tests/helpers/placeOrderHarness.ts; that file stays untouched). Every
 *     `.from(table)` chain is recorded and resolved by the LAST matching
 *     route the test registered, falling back to inert defaults.
 *   • Recorded emails — deps.fetch captures each Resend POST; tests flip
 *     `emailResponder` to fail specific sends.
 *   • Admin gate — injected; passes by default, tests set `adminGateResult`
 *     (calls are counted so tests can pin when the gate runs).
 *   • Turnstile — passes by default; set `turnstileResult` to test the 403.
 *
 * The harness NEVER reaches into handler internals — everything is asserted
 * from observable behavior: the Response, the recorded queries, the captured
 * emails. That keeps the suites behavior pins, not implementation mirrors.
 */

import {
  createShipmentNotificationHandler,
  type ShipmentNotificationConfig,
  type AdminGateResult,
} from '../../supabase/functions/send-shipment-notification/handler';
import {
  createProcessingNotificationHandler,
  type ProcessingNotificationConfig,
} from '../../supabase/functions/send-processing-notification/handler';
import {
  createDeliveredNotificationHandler,
  type DeliveredNotificationConfig,
} from '../../supabase/functions/send-delivered-notification/handler';
import {
  createInquiryHandler,
  type InquiryHandlerConfig,
  type InquiryPayload,
} from '../../supabase/functions/send-inquiry/handler';
import {
  createContactHandler,
  type ContactHandlerConfig,
} from '../../supabase/functions/send-contact/handler';

// ---------------------------------------------------------------------------
// MockDb — scriptable supabase-js query surface (adapted from placeOrderHarness)
// ---------------------------------------------------------------------------

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  table: string;
  /** The first verb called on the chain (select/insert/update/delete). */
  op: string;
  /** insert()/update() payload, when the verb carried one. */
  payload?: unknown;
  calls: RecordedCall[];
  /** select was called with { count: 'exact', head: true }. */
  isCount: boolean;
}

/** Everything a resolved chain can carry; missing fields default to inert. */
export interface QueryResult {
  data?: unknown;
  error?: { message?: string; code?: string } | null;
  count?: number | null;
}

export type QueryResponder = QueryResult | ((q: RecordedQuery) => QueryResult);

/** Convenience: did the chain call `method` with these leading args? */
export function queryHas(q: RecordedQuery, method: string, ...args: unknown[]): boolean {
  return q.calls.some(
    (c) =>
      c.method === method &&
      args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)),
  );
}

interface TableRoute {
  table: string;
  op: string;
  where?: (q: RecordedQuery) => boolean;
  responder: QueryResponder;
}

export class MockDb {
  /** Every awaited chain, in execution order. */
  queries: RecordedQuery[] = [];

  private tableRoutes: TableRoute[] = [];

  /** Register a responder. LAST registration wins, so tests override defaults. */
  on(
    table: string,
    op: string,
    responder: QueryResponder,
    where?: (q: RecordedQuery) => boolean,
  ): this {
    this.tableRoutes.push({ table, op, responder, where });
    return this;
  }

  /** All recorded queries for a table (optionally one verb). */
  of(table: string, op?: string): RecordedQuery[] {
    return this.queries.filter((q) => q.table === table && (!op || q.op === op));
  }

  from(table: string): unknown {
    return makeBuilder(this, table);
  }

  resolve(q: RecordedQuery): { data: unknown; error: { message?: string; code?: string } | null; count: number | null } {
    this.queries.push(q);
    for (let i = this.tableRoutes.length - 1; i >= 0; i--) {
      const route = this.tableRoutes[i];
      if (route.table !== q.table || route.op !== q.op) continue;
      if (route.where && !route.where(q)) continue;
      const res = typeof route.responder === 'function' ? route.responder(q) : route.responder;
      return { data: res.data ?? null, error: res.error ?? null, count: res.count ?? null };
    }
    return { data: null, error: null, count: 0 };
  }
}

const CHAIN_VERBS = new Set(['select', 'insert', 'update', 'delete', 'upsert']);

function makeBuilder(db: MockDb, table: string): unknown {
  const q: RecordedQuery = { table, op: '', calls: [], isCount: false };
  const proxy: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          const p = Promise.resolve(db.resolve(q));
          return p.then.bind(p);
        }
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          q.calls.push({ method: prop, args });
          if (!q.op && CHAIN_VERBS.has(prop)) {
            q.op = prop;
            if (prop === 'insert' || prop === 'update' || prop === 'upsert') q.payload = args[0];
          }
          if (prop === 'select' && (args[1] as { head?: boolean } | undefined)?.head) q.isCount = true;
          return proxy;
        };
      },
    },
  ) as Record<string | symbol, unknown>;
  return proxy;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
  from: string;
}

export interface Harness {
  handler: (req: Request) => Promise<Response>;
  db: MockDb;
  /** Every Resend POST body, in send order. */
  emails: SentEmail[];
  /** Flip to fail sends: receives the parsed body, returns the HTTP status. */
  emailResponder: (email: SentEmail) => { status: number; body?: unknown } | { throw: Error };
  /** What the injected requireAdmin resolves with (default pass). */
  adminGateResult: AdminGateResult;
  /** Requests the admin gate saw, in order. */
  adminGateCalls: Request[];
  /** Result verifyTurnstile resolves with (default pass). */
  turnstileResult: { ok: boolean; reason?: string };
}

export const TEST_CORS = { 'Access-Control-Allow-Origin': 'https://test.example' };

/** Shared config shape — every handler config is a subset of this. */
interface FullConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  resendApiKey: string;
  businessEmail: string;
  fromEmail: string;
  corsHeaders: Record<string, string>;
}

function makeConfig(overrides: Partial<FullConfig>): FullConfig {
  return {
    supabaseUrl: 'http://supabase.mock',
    supabaseServiceKey: 'service-role-key',
    resendApiKey: 're_test_key',
    businessEmail: 'biz@test.example',
    fromEmail: 'VSR Test <from@test.example>',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
}

interface HarnessSeams {
  harness: Harness;
  createClient: (url: string, key: string) => never;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Builds the harness shell (db, email capture, gate + turnstile switches). */
function makeSeams(): HarnessSeams {
  const db = new MockDb();
  const harness: Harness = {
    handler: undefined as unknown as Harness['handler'],
    db,
    emails: [],
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    adminGateResult: { ok: true, status: 200 },
    adminGateCalls: [],
    turnstileResult: { ok: true },
  };
  const client = { from: db.from.bind(db) };
  return {
    harness,
    // Every handler only calls .from(); the cast satisfies each factory's
    // structural client type without five near-identical adapters.
    createClient: (() => client) as unknown as HarnessSeams['createClient'],
    fetch: async (_input, init) => {
      const email = JSON.parse(String(init?.body ?? '{}')) as SentEmail;
      harness.emails.push(email);
      const res = harness.emailResponder(email);
      if ('throw' in res) throw res.throw;
      return new Response(JSON.stringify(res.body ?? { id: 'email-1' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

function adminDeps(seams: HarnessSeams) {
  return {
    createClient: seams.createClient,
    fetch: seams.fetch,
    requireAdmin: async (req: Request) => {
      seams.harness.adminGateCalls.push(req);
      return seams.harness.adminGateResult;
    },
  };
}

function publicDeps(seams: HarnessSeams) {
  return {
    createClient: seams.createClient,
    fetch: seams.fetch,
    verifyTurnstile: async () => seams.harness.turnstileResult,
    clientIp: () => '203.0.113.7',
  };
}

export function makeShipmentHarness(overrides: Partial<ShipmentNotificationConfig> = {}): Harness {
  const seams = makeSeams();
  seams.harness.handler = createShipmentNotificationHandler(
    makeConfig(overrides),
    adminDeps(seams),
  );
  return seams.harness;
}

export function makeProcessingHarness(overrides: Partial<ProcessingNotificationConfig> = {}): Harness {
  const seams = makeSeams();
  seams.harness.handler = createProcessingNotificationHandler(
    makeConfig(overrides),
    adminDeps(seams),
  );
  return seams.harness;
}

export function makeDeliveredHarness(overrides: Partial<DeliveredNotificationConfig> = {}): Harness {
  const seams = makeSeams();
  seams.harness.handler = createDeliveredNotificationHandler(
    makeConfig(overrides),
    adminDeps(seams),
  );
  return seams.harness;
}

export function makeInquiryHarness(overrides: Partial<InquiryHandlerConfig> = {}): Harness {
  const seams = makeSeams();
  seams.harness.handler = createInquiryHandler(makeConfig(overrides), publicDeps(seams));
  return seams.harness;
}

export function makeContactHarness(overrides: Partial<ContactHandlerConfig> = {}): Harness {
  const seams = makeSeams();
  seams.harness.handler = createContactHandler(makeConfig(overrides), publicDeps(seams));
  return seams.harness;
}

// ---------------------------------------------------------------------------
// Request + payload fixtures
// ---------------------------------------------------------------------------

export interface CallOptions {
  method?: string;
  rawBody?: string;
}

export async function callFn(
  h: Harness,
  payload: unknown,
  opts: CallOptions = {},
): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  const response = await h.handler(
    new Request('http://localhost/functions/v1/fn', {
      method: opts.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:
        opts.method === 'OPTIONS' || opts.method === 'GET'
          ? undefined
          : opts.rawBody ?? JSON.stringify(payload ?? {}),
    }),
  );
  let body: Record<string, unknown> = {};
  try {
    body = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body, response };
}

/** A fulfilled order row as the shipment handler re-reads it. */
export function shipmentOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'VSR-ORD-260718-001',
    buyer_name: 'Test Buyer',
    buyer_contact: 'buyer@test.example',
    tracking_number: '9400 1000 0000 0000 0000 00',
    carrier: 'usps',
    status: 'fulfilled',
    ...overrides,
  };
}

/** A paid order row as the processing handler re-reads it. */
export function processingOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'VSR-ORD-260718-001',
    buyer_name: 'Test Buyer',
    buyer_contact: 'buyer@test.example',
    status: 'paid',
    ...overrides,
  };
}

/** A delivered order row as the delivered handler re-reads it. */
export function deliveredOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'VSR-ORD-260718-001',
    buyer_name: 'Test Buyer',
    buyer_contact: 'buyer@test.example',
    delivered_at: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

export const ORDER_LINES = [
  { sku: 'VSR-RS-BPC', product_name: 'BPC-157 — 5mg', quantity: 2 },
];

/** Register the order + order_lines reads for an admin notification handler. */
export function withOrder(h: Harness, order: Record<string, unknown>, lines: unknown = ORDER_LINES): Harness {
  h.db.on('orders', 'select', { data: order }, (q) => queryHas(q, 'eq', 'id'));
  h.db.on('order_lines', 'select', { data: lines });
  return h;
}

/** A fresh, valid inquiry payload (deep copy each call). */
export function inquiryPayload(overrides: Partial<InquiryPayload> = {}): InquiryPayload {
  return {
    name: 'Test Buyer',
    contact: 'buyer@test.example',
    items: [
      {
        product: { id: 'bpc-157', name: 'BPC-157 — 5mg', category: 'biopeptides', sku: 'VSR-RS-BPC' },
        quantity: 2,
      },
    ],
    ...overrides,
  };
}

/** Register the inquiries insert row the inquiry handler re-reads. */
export function withInquiryInsert(h: Harness): Harness {
  h.db.on('inquiries', 'insert', (q) => {
    const row = q.payload as { reference_id?: string };
    return {
      data: {
        id: 'inq-1',
        reference_id: row?.reference_id ?? 'VSR-REQ-TEST',
        created_at: '2026-07-18T00:00:00.000Z',
      },
    };
  });
  return h;
}

/** A fresh, valid contact payload (deep copy each call). */
export function contactPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test Sender',
    email: 'sender@test.example',
    message: 'I would like to know more about your catalog.',
    ...overrides,
  };
}

/** Register the contact_messages insert row the contact handler re-reads. */
export function withContactInsert(h: Harness): Harness {
  h.db.on('contact_messages', 'insert', (q) => {
    const row = q.payload as { reference_id?: string };
    return {
      data: {
        id: 'msg-1',
        reference_id: row?.reference_id ?? 'VSR-MSG-TEST',
        created_at: '2026-07-18T00:00:00.000Z',
      },
    };
  });
  return h;
}
