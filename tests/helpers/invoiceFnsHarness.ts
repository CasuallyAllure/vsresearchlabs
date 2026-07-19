/**
 * Test harness for the three invoice-family edge functions (handler.ts each):
 *
 *   • send-order-invoice — admin re-send of the buyer invoice
 *   • send-receipt       — branded PAID receipt (email or preview)
 *   • mark-payment-claimed — PUBLIC token-gated "I've sent payment" endpoint
 *
 * Each createXxxHandler() takes every runtime seam as an injected dependency,
 * so this harness can drive the REAL request handlers — the exact decision
 * paths production runs — fully offline and deterministically:
 *
 *   • MockDb — a scriptable supabase-js stand-in (adapted from
 *     placeOrderHarness.ts, which is frozen). Every `.from(table)` chain is
 *     recorded (table, first verb, every method call + args) and resolved by
 *     the LAST matching route the test registered, falling back to inert
 *     defaults ({ data: null, error: null, count: 0 }).
 *   • Recorded emails — deps.fetch captures each Resend POST; tests flip
 *     `emailResponder` to fail or throw on sends.
 *   • Admin gate — injected as a stub; tests flip `gateResult` to deny.
 *
 * The harness NEVER reaches into handler internals — everything is asserted
 * from observable behavior: the Response, the recorded queries/RPCs, the
 * captured emails. That keeps the suites behavior pins, not implementation
 * mirrors.
 */

import {
  createInvoiceHandler,
  type AdminGateResult,
  type InvoiceHandlerConfig,
  type InvoiceSupabaseClient,
} from '../../supabase/functions/send-order-invoice/handler';
import {
  createReceiptHandler,
  type ReceiptHandlerConfig,
  type ReceiptSupabaseClient,
} from '../../supabase/functions/send-receipt/handler';
import {
  createClaimHandler,
  type ClaimHandlerConfig,
  type ClaimSupabaseClient,
} from '../../supabase/functions/mark-payment-claimed/handler';

// ---------------------------------------------------------------------------
// MockDb — scriptable supabase-js query/rpc surface (mirrors placeOrderHarness)
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

export interface RpcResult {
  data?: unknown;
  error?: { message?: string } | null;
}

export type RpcResponder =
  | RpcResult
  | ((args: Record<string, unknown> | undefined) => RpcResult);

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

interface RpcRoute {
  fn: string;
  responder: RpcResponder;
}

export class MockDb {
  /** Every awaited chain, in execution order. */
  queries: RecordedQuery[] = [];
  rpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];

  private tableRoutes: TableRoute[] = [];
  private rpcRoutes: RpcRoute[] = [];

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

  onRpc(fn: string, responder: RpcResponder): this {
    this.rpcRoutes.push({ fn, responder });
    return this;
  }

  /** All recorded queries for a table (optionally one verb). */
  of(table: string, op?: string): RecordedQuery[] {
    return this.queries.filter((q) => q.table === table && (!op || q.op === op));
  }

  from(table: string): unknown {
    return makeBuilder(this, table);
  }

  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }> {
    this.rpcCalls.push({ fn, args });
    for (let i = this.rpcRoutes.length - 1; i >= 0; i--) {
      const route = this.rpcRoutes[i];
      if (route.fn !== fn) continue;
      const res = typeof route.responder === 'function' ? route.responder(args) : route.responder;
      return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
    }
    return Promise.resolve({ data: null, error: null });
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
// Shared harness plumbing
// ---------------------------------------------------------------------------

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
}

export const TEST_CORS = { 'Access-Control-Allow-Origin': 'https://test.example' };

/** EMAIL_BRAND.siteUrl under the test env stub (every env read misses →
 *  documented default). The claim handler builds its redirects from this. */
export const TEST_SITE_URL = 'https://vsresearchlabs.com';

interface BaseHarness {
  db: MockDb;
  /** Every Resend POST body, in send order. */
  emails: SentEmail[];
  /** Flip to fail sends: receives the parsed body, returns the HTTP status. */
  emailResponder: (email: SentEmail) => { status: number; body?: unknown } | { throw: Error };
}

/** Gate-bearing harnesses (send-order-invoice / send-receipt) add these. */
interface GatedHarness extends BaseHarness {
  /** Result the injected requireAdmin resolves with (default: admitted). */
  gateResult: AdminGateResult;
  /** Requests the gate saw, in order. */
  gateCalls: Request[];
}

function makeEmailFetch(h: BaseHarness): (input: string, init?: RequestInit) => Promise<Response> {
  return async (_input, init) => {
    const email = JSON.parse(String(init?.body ?? '{}')) as SentEmail;
    h.emails.push(email);
    const res = h.emailResponder(email);
    if ('throw' in res) throw res.throw;
    return new Response(JSON.stringify(res.body ?? { id: 'email-1' }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function makeGate(h: GatedHarness): (req: Request) => Promise<AdminGateResult> {
  return async (req) => {
    h.gateCalls.push(req);
    return h.gateResult;
  };
}

export const GATE_DENIED: AdminGateResult = { ok: false, status: 401, body: { error: 'Unauthorized' } };

// ---------------------------------------------------------------------------
// send-order-invoice
// ---------------------------------------------------------------------------

export interface InvoiceHarness extends GatedHarness {
  handler: (req: Request) => Promise<Response>;
  config: InvoiceHandlerConfig;
}

export function makeInvoiceConfig(overrides: Partial<InvoiceHandlerConfig> = {}): InvoiceHandlerConfig {
  return {
    supabaseUrl: 'http://supabase.mock',
    supabaseServiceKey: 'service-role-key',
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
}

export function makeInvoiceHarness(configOverrides: Partial<InvoiceHandlerConfig> = {}): InvoiceHarness {
  const config = makeInvoiceConfig(configOverrides);
  const db = new MockDb();
  const harness: InvoiceHarness = {
    handler: undefined as unknown as InvoiceHarness['handler'],
    config,
    db,
    emails: [],
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    gateResult: { ok: true, status: 200 },
    gateCalls: [],
  };
  harness.handler = createInvoiceHandler(config, {
    createClient: () => ({ from: db.from.bind(db) }) as unknown as InvoiceSupabaseClient,
    fetch: makeEmailFetch(harness),
    requireAdmin: makeGate(harness),
  });
  return harness;
}

// ---------------------------------------------------------------------------
// send-receipt
// ---------------------------------------------------------------------------

export interface ReceiptHarness extends GatedHarness {
  handler: (req: Request) => Promise<Response>;
  config: ReceiptHandlerConfig;
}

export function makeReceiptConfig(overrides: Partial<ReceiptHandlerConfig> = {}): ReceiptHandlerConfig {
  return {
    supabaseUrl: 'http://supabase.mock',
    supabaseServiceKey: 'service-role-key',
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
}

export function makeReceiptHarness(configOverrides: Partial<ReceiptHandlerConfig> = {}): ReceiptHarness {
  const config = makeReceiptConfig(configOverrides);
  const db = new MockDb();
  const harness: ReceiptHarness = {
    handler: undefined as unknown as ReceiptHarness['handler'],
    config,
    db,
    emails: [],
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    gateResult: { ok: true, status: 200 },
    gateCalls: [],
  };
  harness.handler = createReceiptHandler(config, {
    createClient: () =>
      ({ from: db.from.bind(db), rpc: db.rpc.bind(db) }) as unknown as ReceiptSupabaseClient,
    fetch: makeEmailFetch(harness),
    requireAdmin: makeGate(harness),
  });
  return harness;
}

// ---------------------------------------------------------------------------
// mark-payment-claimed
// ---------------------------------------------------------------------------

export interface ClaimHarness extends BaseHarness {
  handler: (req: Request) => Promise<Response>;
  config: ClaimHandlerConfig;
}

export function makeClaimConfig(overrides: Partial<ClaimHandlerConfig> = {}): ClaimHandlerConfig {
  return {
    supabaseUrl: 'http://supabase.mock',
    supabaseServiceKey: 'service-role-key',
    resendApiKey: 're_test_key',
    fromEmail: 'VSR Test <from@test.example>',
    businessEmail: 'biz@test.example',
    zelleHandle: 'zelle@test.example',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
}

export function makeClaimHarness(configOverrides: Partial<ClaimHandlerConfig> = {}): ClaimHarness {
  const config = makeClaimConfig(configOverrides);
  const db = new MockDb();
  const harness: ClaimHarness = {
    handler: undefined as unknown as ClaimHarness['handler'],
    config,
    db,
    emails: [],
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
  };
  harness.handler = createClaimHandler(config, {
    createClient: () =>
      ({ from: db.from.bind(db), rpc: db.rpc.bind(db) }) as unknown as ClaimSupabaseClient,
    fetch: makeEmailFetch(harness),
  });
  return harness;
}

// ---------------------------------------------------------------------------
// Request + fixture helpers
// ---------------------------------------------------------------------------

export interface CallOptions {
  method?: string;
  rawBody?: string;
}

/** POST (default) a JSON body at a handler; returns status + parsed body. */
export async function callJson(
  handler: (req: Request) => Promise<Response>,
  url: string,
  payload: unknown,
  opts: CallOptions = {},
): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  const method = opts.method ?? 'POST';
  const response = await handler(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:
        method === 'OPTIONS' || method === 'GET'
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

export const INVOICE_URL = 'http://localhost/functions/v1/send-order-invoice';
export const RECEIPT_URL = 'http://localhost/functions/v1/send-receipt';
export const CLAIM_URL = 'http://localhost/functions/v1/mark-payment-claimed';

/** A 64-char lookup token like migration 019 issues (256-bit hex). */
export const VALID_TOKEN = 'a'.repeat(64);

/** A canonical order row for the invoice re-send (send-order-invoice select). */
export function invoiceOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'VSR-ORD-260718-001',
    buyer_name: 'Test Buyer',
    buyer_contact: 'buyer@test.example',
    buyer_organization: null,
    invoice_url: null,
    invoice_amount_cents: 5998,
    subtotal_cents: 4999,
    shipping_cents: 999,
    discount_cents: 0,
    coupon_code: null,
    user_id: null,
    payment_method: 'Zelle (zelle@test.example)',
    status: 'invoice_sent',
    notes: null,
    ship_street: '1 Research Way',
    ship_city: 'Lab City',
    ship_state: 'CA',
    ship_zip: '90001',
    ship_country: 'US',
    ship_confirmed_at: null,
    created_at: '2026-07-18T00:00:00.000Z',
    lookup_token: VALID_TOKEN,
    ...overrides,
  };
}

/** A canonical PAID order row for send-receipt's select. */
export function receiptOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'VSR-ORD-260718-001',
    status: 'paid',
    buyer_name: 'Test Buyer',
    buyer_contact: 'buyer@test.example',
    buyer_organization: null,
    invoice_amount_cents: 5998,
    subtotal_cents: 4999,
    shipping_cents: 999,
    payment_method: 'Zelle (zelle@test.example)',
    tracking_number: null,
    carrier: null,
    paid_at: '2026-07-18T10:00:00.000Z',
    fulfilled_at: null,
    delivered_at: null,
    ship_street: '1 Research Way',
    ship_city: 'Lab City',
    ship_state: 'CA',
    ship_zip: '90001',
    ship_country: 'US',
    created_at: '2026-07-18T00:00:00.000Z',
    lookup_token: VALID_TOKEN,
    ...overrides,
  };
}

/** The order row mark-payment-claimed's token lookup selects. */
export function claimOrderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'VSR-ORD-260718-001',
    buyer_name: 'Test Buyer',
    buyer_contact: 'buyer@test.example',
    invoice_amount_cents: 5998,
    subtotal_cents: 4999,
    ...overrides,
  };
}
