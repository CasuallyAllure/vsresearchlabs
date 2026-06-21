// supabase/functions/send-order-invoice/index.ts
// Branded invoice email — pricing breakdown + Zelle payment instructions.
//
// Re-fires the buyer invoice for an existing order (admin re-send). Re-reads
// the canonical order from Postgres (no client-supplied amounts can be spoofed)
// and renders the invoice via the shared template in _shared/invoiceEmail.ts —
// the SAME template place-order uses to send the invoice inline at checkout, so
// the two can never drift.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildInvoiceHtml,
  buildInvoiceText,
  invoiceSubject,
  type OrderRow,
  type OrderLine,
} from "../_shared/invoiceEmail.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>";
const ALLOWED_ORIGIN       = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
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
             payment_method, status, notes,
             ship_street, ship_city, ship_state, ship_zip, ship_country, created_at, lookup_token`)
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

  const orderRow = order as OrderRow;
  const orderLines = (lines ?? []) as OrderLine[];
  const html = buildInvoiceHtml({ order: orderRow, lines: orderLines, notes: payload.notes });
  const text = buildInvoiceText({ order: orderRow, lines: orderLines });
  const result = await sendResendEmail({ to: order.buyer_contact, subject: invoiceSubject(order), html, text });

  if (!result.ok) {
    console.error("Invoice email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }
  return jsonResponse({ ok: true, orderNumber: order.order_number });
});
