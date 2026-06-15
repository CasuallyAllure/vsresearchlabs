// supabase/functions/send-shipment-notification/index.ts
// Sends a "Your order has shipped" notification to the buyer when an
// admin marks an order as fulfilled. Modeled after send-order-invoice —
// re-reads the order from Postgres to avoid client-supplied spoofing.
//
// Required env vars (same as send-order-invoice):
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>";
const ALLOWED_ORIGIN       = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ShipmentPayload {
  order_id: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface OrderLine {
  product_name: string;
  quantity: number;
  sku: string;
}

function buildShipmentEmailHtml(args: {
  orderNumber: string;
  buyerName: string;
  trackingNumber: string | null;
  lines: OrderLine[];
}): string {
  const trackingBlock = args.trackingNumber
    ? `
        <p style="margin:18px 0;">
          <strong>Tracking number:</strong>
          <span style="font-family:monospace;font-size:14px;">${escapeHtml(args.trackingNumber)}</span>
        </p>
      `
    : `
        <p style="margin:18px 0;color:#555;">
          Tracking information will follow separately.
        </p>
      `;

  const itemRows = args.lines
    .map(
      (l) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#555;">
            ${escapeHtml(l.sku)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            ${escapeHtml(l.product_name)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">
            ${l.quantity}
          </td>
        </tr>`,
    )
    .join("");

  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;line-height:1.55;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(args.orderNumber)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">
        Your order has shipped.
      </h2>
      <p>Hi ${escapeHtml(args.buyerName || "there")},</p>
      <p>
        Your order with VS Research Labs has been packed and
        handed off to the carrier.
      </p>
      ${trackingBlock}
      <h3 style="margin-top:24px;font-weight:400;letter-spacing:0.03em;">Shipment Contents</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">SKU</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin-top:24px;">
        If you have any questions about your shipment, please reply to this
        email and our team will be happy to assist.
      </p>
      <p>Thank you for choosing VS Research Labs.</p>
      <p style="margin-top:28px;color:#666;font-size:12px;">
        Velari Systems Research Labs<br/>
        Northern California Biopeptide Sciences
      </p>
      <p style="margin-top:18px;color:#888;font-size:11px;">
        Reference: <span style="font-family:monospace;">${escapeHtml(args.orderNumber)}</span>
      </p>
      <p style="margin-top:12px;color:#888;font-size:11px;">
        For Research Purposes Only — Not for Human Use.
      </p>
    </div>`;
}

async function sendResendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      args.to,
      subject: args.subject,
      html:    args.html,
    }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!RESEND_API_KEY)                              return jsonResponse({ error: "Email service not configured." }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)       return jsonResponse({ error: "Database service not configured." }, 500);

  let payload: ShipmentPayload;
  try {
    payload = (await req.json()) as ShipmentPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!payload.order_id) {
    return jsonResponse({ error: "order_id is required." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_number, buyer_name, buyer_contact, tracking_number, status")
    .eq("id", payload.order_id)
    .single();

  if (orderError || !order) {
    return jsonResponse({ error: "Order not found." }, 404);
  }

  if (order.status !== "fulfilled") {
    return jsonResponse({
      error: `Order status is ${order.status}; expected fulfilled.`,
    }, 409);
  }

  if (!EMAIL_REGEX.test(order.buyer_contact)) {
    return jsonResponse({
      ok: false,
      skipped: true,
      reason: "Buyer contact is not an email address; shipment notification skipped.",
    });
  }

  const { data: lines, error: linesError } = await supabase
    .from("order_lines")
    .select("sku, product_name, quantity")
    .eq("order_id", order.id);

  if (linesError) {
    return jsonResponse({ error: `Failed to load order lines: ${linesError.message}` }, 502);
  }

  const subject = `Your order has shipped — ${order.order_number}`;
  const html = buildShipmentEmailHtml({
    orderNumber:    order.order_number,
    buyerName:      order.buyer_name,
    trackingNumber: order.tracking_number,
    lines:          (lines ?? []) as OrderLine[],
  });

  const result = await sendResendEmail({
    to:      order.buyer_contact,
    subject,
    html,
  });

  if (!result.ok) {
    console.error("Shipment email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }

  return jsonResponse({ ok: true, orderNumber: order.order_number });
});
