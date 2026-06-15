// supabase/functions/send-delivered-notification/index.ts
// Sends a "Your order was delivered" email with a post-delivery discount code
// when an admin marks an order delivered. Modeled on send-shipment-notification:
// re-reads the order from Postgres to avoid client-supplied spoofing.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN
// Optional:
//   DISCOUNT_CODE    (default "BACK25")
//   DISCOUNT_PERCENT (default "25")
//   DISCOUNT_DAYS    (default "30")

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>";
const ALLOWED_ORIGIN       = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const DISCOUNT_CODE        = Deno.env.get("DISCOUNT_CODE") ?? "BACK25";
const DISCOUNT_PERCENT     = Deno.env.get("DISCOUNT_PERCENT") ?? "25";
const DISCOUNT_DAYS        = Number(Deno.env.get("DISCOUNT_DAYS") ?? "30");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  code: string;
  percent: string;
  expires: string;
}): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;line-height:1.55;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(args.orderNumber)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">
        Your order was delivered.
      </h2>
      <p>Hi ${escapeHtml(args.buyerName || "there")},</p>
      <p>
        Your order from VS Research Labs has been delivered. We hope everything
        arrived in perfect condition — if anything's off, just reply to this email.
      </p>
      <div style="margin:26px 0;padding:22px;border:1px solid #34727A;border-radius:10px;text-align:center;background:#f5f8f8;">
        <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.04em;color:#444;">
          A thank-you for your order — <strong>${escapeHtml(args.percent)}% off</strong> your next one
        </p>
        <p style="margin:0;font-family:monospace;font-size:26px;letter-spacing:0.12em;color:#1A1714;">
          ${escapeHtml(args.code)}
        </p>
        <p style="margin:10px 0 0;font-size:11px;color:#888;">
          Valid through ${escapeHtml(args.expires)}. Mention the code when you place your next order.
        </p>
      </div>
      <p>Thank you for choosing VS Research Labs.</p>
      <p style="margin-top:28px;color:#666;font-size:12px;">
        Velari Systems Research Labs<br/>
        Northern California Biopeptide Sciences
      </p>
      <p style="margin-top:12px;color:#888;font-size:11px;">
        For Research Purposes Only — Not for Human Use.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
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

  const expiresDate = new Date(Date.now() + DISCOUNT_DAYS * 24 * 60 * 60 * 1000);
  const expires = expiresDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const html = buildDeliveredEmailHtml({
    orderNumber: order.order_number,
    buyerName:   order.buyer_name,
    code:        DISCOUNT_CODE,
    percent:     DISCOUNT_PERCENT,
    expires,
  });

  const result = await sendResendEmail({
    to:      order.buyer_contact,
    subject: `Delivered — and a thank-you inside (${order.order_number})`,
    html,
  });

  if (!result.ok) {
    console.error("Delivered email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }
  return jsonResponse({ ok: true });
});
