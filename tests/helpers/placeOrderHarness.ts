/**
 * Test harness for the place-order orchestration (handler.ts).
 *
 * createOrderHandler() takes every runtime seam as an injected dependency, so
 * this harness can drive the REAL request handler — the exact decision paths
 * production runs — fully offline and deterministically:
 *
 *   • MockDb — a scriptable supabase-js stand-in. Every `.from(table)` chain
 *     is recorded (table, first verb, every method call + args) and resolved
 *     by the LAST matching route the test registered, falling back to inert
 *     defaults ({ data: null, error: null, count: 0 }) plus synthesized rows
 *     for the two inserts the handler re-reads (inquiries, orders).
 *   • Recorded emails — deps.fetch captures each Resend POST; tests flip
 *     `emailResponder` to fail the buyer/business sends.
 *   • Recorded telemetry — alertOperator/logEvent calls land in arrays.
 *   • Turnstile — passes by default; set `turnstileResult` to test the 403.
 *
 * The harness NEVER reaches into handler internals — everything is asserted
 * from observable behavior: the Response, the recorded queries/RPCs, the
 * captured emails and alerts. That keeps the suite a behavior pin, not an
 * implementation mirror.
 */

import {
  createOrderHandler,
  type OrderHandlerConfig,
  type OrderHandlerDeps,
  type OrderSupabaseClient,
} from '../../supabase/functions/place-order/handler';
import type { OrderPayload } from '../../supabase/functions/place-order/orderPayload';

// ---------------------------------------------------------------------------
// MockDb — scriptable supabase-js query/rpc surface
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
// Harness
// ---------------------------------------------------------------------------

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  from: string;
}

export interface RecordedAlert {
  stage: string;
  summary: string;
  ctx?: Record<string, unknown>;
}

export interface Harness {
  handler: (req: Request) => Promise<Response>;
  config: OrderHandlerConfig;
  db: MockDb;
  /** Every Resend POST body, in send order (buyer first when both send). */
  emails: SentEmail[];
  alerts: RecordedAlert[];
  logs: { level: string; message: string }[];
  /** Flip to fail sends: receives the parsed body, returns the HTTP status. */
  emailResponder: (email: SentEmail) => { status: number; body?: unknown } | { throw: Error };
  /** Result verifyTurnstile resolves with (default pass). */
  turnstileResult: { ok: boolean; reason?: string };
  /** Sessions the anon auth client resolves: bearer → user. */
  sessions: Map<string, { id: string; email?: string | null }>;
  /** When set, auth.getUser REJECTS with this error (the catch-path). */
  authThrows: Error | null;
}

export const TEST_CORS = { 'Access-Control-Allow-Origin': 'https://test.example' };

export function makeConfig(overrides: Partial<OrderHandlerConfig> = {}): OrderHandlerConfig {
  return {
    supabaseUrl: 'http://supabase.mock',
    supabaseServiceKey: 'service-role-key',
    supabaseAnonKey: 'anon-key',
    resendApiKey: 're_test_key',
    businessEmail: 'biz@test.example',
    fromEmail: 'VSR Test <from@test.example>',
    zelleHandle: 'zelle@test.example',
    brandStampUrl: '',
    corsHeaders: TEST_CORS,
    ...overrides,
  };
}

export function makeHarness(configOverrides: Partial<OrderHandlerConfig> = {}): Harness {
  const config = makeConfig(configOverrides);
  const db = new MockDb();

  // Synthesized rows for the two inserts the handler re-reads. Tests override
  // by registering their own routes AFTER construction (last wins).
  db.on('inquiries', 'insert', (q) => {
    const row = q.payload as { reference_id?: string };
    return {
      data: {
        id: 'inq-1',
        reference_id: row?.reference_id ?? 'VSR-REF-TEST',
        created_at: '2026-07-18T00:00:00.000Z',
      },
    };
  });
  db.on('orders', 'insert', (q) => {
    const row = q.payload as { order_number?: string };
    return {
      data: {
        id: 'order-1',
        order_number: row?.order_number ?? 'VSR-ORD-TEST',
        created_at: '2026-07-18T00:00:01.000Z',
      },
    };
  });
  // The buyer-invoice re-read (select … .eq('id', …).single()) — synthesize the
  // canonical row from the recorded orders insert so amounts match what the
  // handler persisted. The idempotency select filters on idempotency_key and
  // falls through to the inert default (data: null) via the `where` guard.
  db.on(
    'orders',
    'select',
    () => {
      const inserted = db.of('orders', 'insert')[0]?.payload as Record<string, unknown> | undefined;
      if (!inserted) return { data: null };
      return {
        data: {
          id: 'order-1',
          invoice_url: null,
          lookup_token: 'tok-test-1',
          created_at: '2026-07-18T00:00:01.000Z',
          ...inserted,
        },
      };
    },
    (q) => queryHas(q, 'eq', 'id'),
  );

  const harness: Harness = {
    handler: undefined as unknown as Harness['handler'],
    config,
    db,
    emails: [],
    alerts: [],
    logs: [],
    emailResponder: () => ({ status: 200, body: { id: 'email-1' } }),
    turnstileResult: { ok: true },
    sessions: new Map(),
    authThrows: null,
  };

  const authClient = {
    from: db.from.bind(db),
    rpc: db.rpc.bind(db),
    auth: {
      getUser: async (jwt: string) => {
        if (harness.authThrows) throw harness.authThrows;
        const user = harness.sessions.get(jwt);
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
  } as unknown as OrderSupabaseClient;

  const serviceClient = {
    from: db.from.bind(db),
    rpc: db.rpc.bind(db),
    auth: authClient.auth,
  } as unknown as OrderSupabaseClient;

  const deps: OrderHandlerDeps = {
    createClient: (_url, key) => (key === config.supabaseAnonKey ? authClient : serviceClient),
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
    verifyTurnstile: async () => harness.turnstileResult,
    clientIp: () => '203.0.113.7',
    alertOperator: async (args) => {
      harness.alerts.push({
        stage: args.stage,
        summary: args.summary,
        ctx: args.ctx as Record<string, unknown> | undefined,
      });
    },
    logEvent: (level, _fn, message) => {
      harness.logs.push({ level, message });
    },
  };

  harness.handler = createOrderHandler(config, deps);
  return harness;
}

// ---------------------------------------------------------------------------
// Request + payload fixtures
// ---------------------------------------------------------------------------

export interface PlaceOrderOptions {
  method?: string;
  bearer?: string;
  rawBody?: string;
}

export function orderRequest(payload: OrderPayload | undefined, opts: PlaceOrderOptions = {}): Request {
  return new Request('http://localhost/functions/v1/place-order', {
    method: opts.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
    },
    body:
      opts.method === 'OPTIONS' || opts.method === 'GET'
        ? undefined
        : opts.rawBody ?? JSON.stringify(payload ?? {}),
  });
}

export async function placeOrder(
  h: Harness,
  payload: OrderPayload | undefined,
  opts: PlaceOrderOptions = {},
): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  const response = await h.handler(orderRequest(payload, opts));
  let body: Record<string, unknown> = {};
  try {
    body = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body, response };
}

/** One verified catalog line: BPC-157 5mg, qty 1, $49.99 (matches CATALOG_ROWS). */
export const BPC_SKU = 'VSR-RS-BPC';
export const BPC_PRICE_CENTS = 4999;

/** A product_variant_stock row as the handler reads it — price check fields
 *  plus the promo planner's availability columns. */
export interface CatalogVariantRow {
  sku: string;
  dose: string | null;
  price_cents: number | null;
  on_hand: number;
  inbound_units: number;
  lead_days: number | null;
  wholesale_eligible: boolean;
}

/** Catalog rows that verify basePayload()'s line exactly. Full row shape so the
 *  same rows serve the price check AND the promo planner's availability read. */
export function catalogRows(): CatalogVariantRow[] {
  return [
    {
      sku: BPC_SKU,
      dose: '5mg',
      price_cents: BPC_PRICE_CENTS,
      on_hand: 8,
      inbound_units: 0,
      lead_days: null,
      wholesale_eligible: false,
    },
  ];
}

/** A fresh, valid guest checkout payload (deep copy each call). */
export function basePayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    name: 'Test Buyer',
    contact: 'buyer@test.example',
    ship_street: '1 Research Way',
    ship_city: 'Lab City',
    ship_state: 'CA',
    ship_zip: '90001',
    ship_country: 'US',
    items: [
      {
        product: { id: 'bpc-157', name: 'BPC-157 — 5mg', category: 'biopeptides', sku: BPC_SKU },
        quantity: 1,
        unitPriceCents: BPC_PRICE_CENTS,
        fast: true,
      },
    ],
    ...overrides,
  };
}

/** Register the catalog rows so basePayload()'s line verifies as priced. */
export function withCatalog(h: Harness, rows: CatalogVariantRow[] = catalogRows()): Harness {
  h.db.on('product_variant_stock', 'select', { data: rows });
  h.db.on('product_stock', 'select', { data: [] });
  return h;
}
