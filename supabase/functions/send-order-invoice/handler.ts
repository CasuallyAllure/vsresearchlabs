// supabase/functions/send-order-invoice/handler.ts
// Branded invoice email — the WHOLE decision body, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (tests/unit/sendOrderInvoiceHandler.test.ts).
// index.ts is now a thin Deno shim: it reads env, builds the real deps
// (supabase-js createClient, fetch, the _shared/adminGate.ts requireAdmin),
// and mounts the handler this factory returns under Deno.serve. NOTHING in
// this file may reference Deno globals or jsr:/npm: imports — that is the
// whole point of the split.
//
// Re-fires the buyer invoice for an existing order (admin re-send). Re-reads
// the canonical order from Postgres (no client-supplied amounts can be spoofed)
// and renders the invoice via the shared template in _shared/invoiceEmail.ts —
// the SAME template place-order uses to send the invoice inline at checkout, so
// the two can never drift.
//
// Required env vars (read by the shim):
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected; used for the admin auth gate)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts — injected as deps.requireAdmin).

import {
  buildInvoiceHtml,
  buildInvoiceText,
  invoiceSubject,
  type OrderRow,
  type OrderLine,
  type CouponLine,
} from "../_shared/invoiceEmail.ts";
import { EMAIL_BRAND } from "../_shared/emailBrand.ts";

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

/** Env-derived configuration — index.ts reads Deno.env once at cold start and
 *  passes the resolved values here, preserving the old module-load semantics. */
export interface InvoiceHandlerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  resendApiKey: string;
  fromEmail: string;
  corsHeaders: Record<string, string>;
}

/** The structural slice of a supabase-js client this handler actually uses.
 *  Query-builder chains are typed loose (the real client's generics don't
 *  survive injection); every result is narrowed at the use site exactly as
 *  the pre-extraction code did. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InvoiceQueryBuilder = any;

export interface InvoiceSupabaseClient {
  from(table: string): InvoiceQueryBuilder;
}

/** Result shape of _shared/adminGate.ts requireAdmin — mirrored here so the
 *  jsr:-importing gate module never has to load under vitest. */
export interface AdminGateResult {
  ok: boolean;
  status: number;
  body?: { error: string };
}

/** Runtime seams. Destructured below under the exact names the decision body
 *  has always used, so the body is byte-identical to the pre-extraction
 *  index.ts (`fetch` deliberately shadows the global inside the factory). */
export interface InvoiceHandlerDeps {
  createClient: (url: string, key: string) => InvoiceSupabaseClient;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  requireAdmin: (req: Request) => Promise<AdminGateResult>;
}

export function createInvoiceHandler(
  cfg: InvoiceHandlerConfig,
  deps: InvoiceHandlerDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL         = cfg.supabaseUrl;
  const SUPABASE_SERVICE_KEY = cfg.supabaseServiceKey;
  const RESEND_API_KEY       = cfg.resendApiKey;
  const FROM_EMAIL           = cfg.fromEmail;
  // Same derivation invoiceEmail.ts uses for its /track links (EMAIL_BRAND.siteUrl,
  // backed by the PUBLIC_SITE_URL secret) — kept in sync so both CTAs point at
  // the same host.
  const SITE_BASE            = EMAIL_BRAND.siteUrl;

  const CORS_HEADERS = cfg.corsHeaders;

  const { createClient, fetch, requireAdmin } = deps;

interface InvoicePayload {
  order_id: string;
  invoice_url?: string;
  /** Optional order track-record / notes to render in the email (admin opt-in). */
  notes?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function sendResendEmail(args: { to: string; subject: string; html: string; text?: string }):
  Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: args.to, subject: args.subject, html: args.html, ...(args.text ? { text: args.text } : {}) }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

const handleInvoice = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const gate = await requireAdmin(req);
  if (!gate.ok) return jsonResponse(gate.body, gate.status);

  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed." }, 405);
  if (!RESEND_API_KEY)          return jsonResponse({ error: "Email service not configured." }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: "Database service not configured." }, 500);

  let payload: InvoicePayload;
  try { payload = (await req.json()) as InvoicePayload; }
  catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
  if (!payload.order_id) return jsonResponse({ error: "order_id is required." }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(`id, order_number, buyer_name, buyer_contact, buyer_organization,
             invoice_url, invoice_amount_cents, subtotal_cents, shipping_cents,
             discount_cents, coupon_code, user_id,
             payment_method, status, notes,
             ship_street, ship_city, ship_state, ship_zip, ship_country, ship_confirmed_at, created_at, lookup_token`)
    .eq("id", payload.order_id)
    .single();
  if (orderError || !order) return jsonResponse({ error: "Order not found." }, 404);
  if (order.status === "cancelled" || order.status === "refunded") {
    return jsonResponse({ error: `Cannot send invoice for a ${order.status} order.` }, 409);
  }
  if (!EMAIL_REGEX.test(order.buyer_contact)) {
    return jsonResponse({ ok: false, skipped: true, reason: "Buyer contact is not an email address; invoice email skipped." });
  }

  const { data: lines } = await supabase
    .from("order_lines")
    .select("sku, product_name, quantity, unit_price_cents, item_note, fast_ship")
    .eq("order_id", order.id);

  // Applied coupons (migrations 036/037) → itemized discount lines that mirror
  // the admin order editor exactly (one line per code + its amount).
  const { data: couponRows } = await supabase
    .from("order_coupons")
    .select("code, kind, free_label, percent, amount_cents, discount_cents")
    .eq("order_id", order.id)
    .order("created_at");

  const orderRow = order as OrderRow;
  const orderLines = (lines ?? []) as OrderLine[];
  const coupons = (couponRows ?? []) as CouponLine[];
  // "Confirm shipping address" CTA — only while the buyer hasn't confirmed yet
  // (migration 041). Lands on the /track confirm card via the #confirm-address
  // anchor; the token is the same one the payment CTA already uses.
  const shipConfirmedAt = (order as { ship_confirmed_at?: string | null }).ship_confirmed_at ?? null;
  const confirmShippingUrl = order.lookup_token && !shipConfirmedAt
    ? `${SITE_BASE}/track?t=${order.lookup_token}#confirm-address`
    : undefined;
  // Member free-shipping perk (migration 049) → affirmative "Free — member"
  // shipping line. recompute_order_totals has already zeroed the billed
  // shipping; this only drives the label.
  const ownerId = (order as { user_id?: string | null }).user_id ?? null;
  let memberFreeShipping = false;
  if (ownerId) {
    const { data: profRow } = await supabase
      .from("customer_profiles")
      .select("free_shipping")
      .eq("user_id", ownerId)
      .maybeSingle();
    memberFreeShipping = profRow?.free_shipping === true;
  }
  const html = buildInvoiceHtml({ order: orderRow, lines: orderLines, notes: payload.notes, coupons, confirmShippingUrl, memberFreeShipping });
  const text = buildInvoiceText({ order: orderRow, lines: orderLines, coupons, confirmShippingUrl, memberFreeShipping });
  const result = await sendResendEmail({ to: order.buyer_contact, subject: invoiceSubject(order), html, text });

  if (!result.ok) {
    console.error("Invoice email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }
  return jsonResponse({ ok: true, orderNumber: order.order_number });
};

  return handleInvoice;
}
