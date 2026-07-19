// supabase/functions/send-delivered-notification/handler.ts
// "Your order is complete" notification — the whole decision body, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (mirrors place-order/handler.ts). index.ts is now a
// thin Deno shim: it reads env, wires the real deps (supabase-js createClient,
// fetch, the shared admin gate), and mounts the handler this factory returns
// under Deno.serve. NOTHING in this file may reference Deno globals or
// jsr:/npm: imports — that is the whole point of the split.
//
// Sends the final "Your order is complete — thank you" email when an admin
// marks an order delivered. Modeled on send-shipment-notification: re-reads
// the order from Postgres to avoid client-supplied spoofing.
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts — injected, so the tests can script the gate).

import { EMAIL_BRAND, RESEARCH_USE_DISCLAIMER } from "../_shared/emailBrand.ts";

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

/** Env-derived configuration — index.ts reads Deno.env once at cold start and
 *  passes the resolved values here, preserving the old module-load semantics. */
export interface DeliveredNotificationConfig {
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
export type NotificationQueryBuilder = any;

export interface NotificationSupabaseClient {
  from(table: string): NotificationQueryBuilder;
}

/** Structural copy of ../_shared/adminGate.ts's AdminGateResult. Declared
 *  locally (not type-imported) because adminGate.ts imports supabase-js from
 *  jsr:, which the tests' tsc project cannot resolve; the shapes are checked
 *  against each other where index.ts passes the real requireAdmin in. */
export interface AdminGateResult {
  ok: boolean;
  status: number;
  body?: { error: string };
}

/** Runtime seams. Destructured below under the exact names the decision body
 *  has always used (`fetch` deliberately shadows the global inside the
 *  factory). */
export interface DeliveredNotificationDeps {
  createClient: (url: string, key: string) => NotificationSupabaseClient;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  requireAdmin: (req: Request) => Promise<AdminGateResult>;
}

export function createDeliveredNotificationHandler(
  cfg: DeliveredNotificationConfig,
  deps: DeliveredNotificationDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL         = cfg.supabaseUrl;
  const SUPABASE_SERVICE_KEY = cfg.supabaseServiceKey;
  const RESEND_API_KEY       = cfg.resendApiKey;
  const FROM_EMAIL           = cfg.fromEmail;

  const CORS_HEADERS = cfg.corsHeaders;

  const { createClient, fetch, requireAdmin } = deps;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DeliveredPayload {
  order_id: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildDeliveredEmailHtml(args: {
  orderNumber: string;
  buyerName: string;
}): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;line-height:1.55;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(args.orderNumber)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">
        Your order is complete.
      </h2>
      <p>Hi ${escapeHtml(args.buyerName || "there")},</p>
      <p>
        Your order from ${escapeHtml(EMAIL_BRAND.name)} has been delivered and is now complete.
        We hope everything arrived in perfect condition — if anything's off, just
        reply to this email and our team will take care of it.
      </p>
      <p>Thank you for choosing ${escapeHtml(EMAIL_BRAND.name)}.</p>
      <p style="margin-top:28px;color:#666;font-size:12px;">
        ${escapeHtml(EMAIL_BRAND.signature)}<br/>
        ${escapeHtml(EMAIL_BRAND.tagline)}
      </p>
      <p style="margin-top:18px;color:#888;font-size:11px;">
        Reference: <span style="font-family:monospace;">${escapeHtml(args.orderNumber)}</span>
      </p>
      <p style="margin-top:12px;color:#888;font-size:11px;">
        ${RESEARCH_USE_DISCLAIMER}.
      </p>
    </div>`;
}

async function sendResendEmail(args: { to: string; subject: string; html: string }):
  Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: args.to, subject: args.subject, html: args.html }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

const handleDeliveredNotification = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const gate = await requireAdmin(req);
  if (!gate.ok) return jsonResponse(gate.body, gate.status);

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let payload: DeliveredPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  if (!payload?.order_id) {
    return jsonResponse({ error: "order_id is required." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_number, buyer_name, buyer_contact, delivered_at")
    .eq("id", payload.order_id)
    .single();

  if (orderError || !order) {
    return jsonResponse({ error: "Order not found." }, 404);
  }
  if (!order.delivered_at) {
    return jsonResponse({ error: "Order is not marked delivered." }, 409);
  }
  if (!EMAIL_REGEX.test(order.buyer_contact)) {
    return jsonResponse({
      ok: false, skipped: true,
      reason: "Buyer contact is not an email address; delivered notification skipped.",
    });
  }

  const html = buildDeliveredEmailHtml({
    orderNumber: order.order_number,
    buyerName:   order.buyer_name,
  });

  const result = await sendResendEmail({
    to:      order.buyer_contact,
    subject: `Order completed — thank you (${order.order_number})`,
    html,
  });

  if (!result.ok) {
    console.error("Delivered email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }
  return jsonResponse({ ok: true });
};

  return handleDeliveredNotification;
}
