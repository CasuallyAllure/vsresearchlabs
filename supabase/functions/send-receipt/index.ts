// supabase/functions/send-receipt/index.ts
// Branded PAID receipt — "payment complete, here's your receipt/invoice".
//
// Re-reads the canonical order from Postgres (no client-supplied amounts) and
// renders a paid receipt: PAID badge, payment-confirmation block, itemized
// lines, subtotal + shipping + total, and delivery status. The receipt is
// always regenerable from the order, so it's retrievable anytime.
//
// Modes (body):
//   { order_id }                 → email the buyer + stamp receipt_sent_at, returns { ok, html }
//   { order_id, preview: true }  → just render + return { ok, html } (no email, no write)
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   SUPABASE_ANON_KEY                        (auto-injected; used for the admin auth gate)
//   RESEND_API_KEY, RESEND_FROM_EMAIL, ALLOWED_ORIGIN
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts). Once gated, preview:true rendering the full
// HTML in the response is fine — the caller is a verified admin.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import { EMAIL_BRAND } from "../_shared/emailBrand.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>";
// Public site origin for the customer's secure receipt link.
const SITE_URL = EMAIL_BRAND.siteUrl;

const CORS_HEADERS = buildCorsHeaders();

interface ReceiptPayload {
  order_id: string;
  preview?: boolean;
}

interface OrderLine {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  item_note: string | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  buyer_name: string;
  buyer_contact: string;
  buyer_organization: string | null;
  invoice_amount_cents: number | null;
  subtotal_cents: number | null;
  shipping_cents: number | null;
  payment_method: string | null;
  tracking_number: string | null;
  carrier: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  delivered_at: string | null;
  ship_street: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  ship_country: string | null;
  created_at: string;
  lookup_token: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return `${iso.slice(0, 10)} · ${iso.slice(11, 19)} UTC`;
}

function buildReceiptHtml(order: OrderRow, lines: OrderLine[]): string {
  const subtotal = order.subtotal_cents;
  const shipping = order.shipping_cents;
  const total    = order.invoice_amount_cents;

  const shipBlock = [
    order.ship_street,
    [order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(", "),
    order.ship_country,
  ].filter((s): s is string => !!s).map(escapeHtml).join("<br/>");

  const paidWhen = order.paid_at ? fmtDate(order.paid_at) : null;
  const deliveredWhen = order.delivered_at ? fmtDate(order.delivered_at) : null;

  const lineRows = lines.map((l) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;">${escapeHtml(l.sku)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;color:#1A1714;font-size:13px;">
        ${escapeHtml(l.product_name)}
        ${l.item_note ? `<div style="color:#6F665C;font-size:11px;margin-top:2px;">Note: ${escapeHtml(l.item_note)}</div>` : ""}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#1A1714;">${l.quantity}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#6F665C;">${fmtUsd(l.unit_price_cents)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Receipt ${escapeHtml(order.order_number)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:680px;margin:0 auto;padding:28px 14px;">

    <div style="text-align:center;margin:0 0 28px;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${escapeHtml(EMAIL_BRAND.name)}" width="96" height="96" style="display:inline-block;width:96px;height:96px;margin-bottom:14px;border:0;" />
      <div style="font-size:12px;letter-spacing:0.30em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:4px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:14px;">${escapeHtml(EMAIL_BRAND.tagline)}</div>
      <span style="display:inline-block;padding:5px 13px;border-radius:999px;background:#2E7D5B;color:#FBF9F4;font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;">Receipt · Paid</span>
    </div>

    <!-- Payment-complete banner -->
    <div style="background:#FBF9F4;border:1px solid rgba(46,125,91,0.35);border-radius:12px;padding:22px 24px;margin-bottom:16px;text-align:center;">
      <div style="font-size:16px;color:#1A1714;font-weight:600;margin-bottom:6px;">Payment complete — thank you.</div>
      <div style="font-size:13px;color:#6F665C;line-height:1.6;">
        We've received your payment in full. This is your receipt and itemized invoice for order
        <span style="font-family:'JetBrains Mono','SF Mono',monospace;color:#1A1714;">${escapeHtml(order.order_number)}</span>.
      </div>
    </div>

    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">

      <div style="text-align:center;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid #E4DFD5;">
        <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:8px;">Order Reference</div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:22px;letter-spacing:0.04em;color:#1A1714;font-weight:700;margin-bottom:6px;word-break:break-all;">${escapeHtml(order.order_number)}</div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;letter-spacing:0.08em;">Ordered ${escapeHtml(fmtDate(order.created_at))}</div>
      </div>

      <!-- Payment confirmation -->
      <div style="background:#F4EFE6;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <tr><td style="padding:3px 0;color:#6F665C;">Status</td><td style="padding:3px 0;text-align:right;color:#2E7D5B;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;">Paid${deliveredWhen ? " · Delivered" : ""}</td></tr>
          ${order.payment_method ? `<tr><td style="padding:3px 0;color:#6F665C;">Method</td><td style="padding:3px 0;text-align:right;color:#1A1714;">${escapeHtml(order.payment_method)}</td></tr>` : ""}
          ${paidWhen ? `<tr><td style="padding:3px 0;color:#6F665C;">Paid</td><td style="padding:3px 0;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;color:#1A1714;">${escapeHtml(paidWhen)}</td></tr>` : ""}
          ${deliveredWhen ? `<tr><td style="padding:3px 0;color:#6F665C;">Delivered</td><td style="padding:3px 0;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;color:#1A1714;">${escapeHtml(deliveredWhen)}</td></tr>` : ""}
          ${order.tracking_number ? `<tr><td style="padding:3px 0;color:#6F665C;">Tracking</td><td style="padding:3px 0;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;color:#1A1714;">${escapeHtml(order.tracking_number)}</td></tr>` : ""}
        </table>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Bill To</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.55;">
          <strong>${escapeHtml(order.buyer_name)}</strong><br/>
          ${escapeHtml(order.buyer_contact)}
          ${order.buyer_organization ? `<br/>${escapeHtml(order.buyer_organization)}` : ""}
        </div>
      </div>

      ${shipBlock ? `<div style="margin-bottom:22px;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Ship To</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.55;">${shipBlock}</div>
      </div>` : ""}

      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:8px;">Items</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #E4DFD5;border-radius:6px;margin-bottom:14px;">
        <thead><tr style="background:#F4EFE6;">
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;">SKU</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;">Item</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:60px;">Qty</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:90px;">Unit</th>
        </tr></thead>
        <tbody>${lineRows}</tbody>
      </table>

      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Subtotal</td>
            <td style="padding:5px 14px;text-align:right;width:120px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${fmtUsd(subtotal ?? total)}</td></tr>
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Shipping</td>
            <td style="padding:5px 14px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${shipping !== null && shipping !== undefined ? fmtUsd(shipping) : "—"}</td></tr>
        <tr style="border-top:1px solid #E4DFD5;">
          <td style="padding:14px 14px 6px;text-align:right;font-size:11px;color:#6F665C;letter-spacing:0.2em;text-transform:uppercase;">Total Paid</td>
          <td style="padding:14px 14px 6px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:20px;color:#2E7D5B;font-weight:700;">${fmtUsd(total)}</td>
        </tr>
      </table>
    </div>

    ${order.lookup_token ? `
    <!-- Secure online receipt link -->
    <div style="text-align:center;margin-top:18px;">
      <a href="${SITE_URL}/track?t=${order.lookup_token}" style="display:inline-block;background:#1A1714;color:#FBF9F4;text-decoration:none;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:13px 28px;border-radius:999px;">View &amp; print your receipt →</a>
      <div style="font-size:11px;color:#6F665C;margin-top:8px;line-height:1.5;">View your receipt online and save a PDF anytime — no login needed.</div>
    </div>` : ""}

    <p style="margin:20px 4px 8px;font-size:13px;color:#1A1714;line-height:1.6;">Thank you for your order. Keep this receipt for your records — you can reply to this email anytime with questions about reference <strong>${escapeHtml(order.order_number)}</strong>.</p>

    <div style="border-top:1px solid rgba(26,23,20,0.10);padding-top:14px;margin-top:20px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#6F665C;margin-bottom:4px;">${escapeHtml(EMAIL_BRAND.name)} · ${escapeHtml(EMAIL_BRAND.tagline)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A09689;">For Research Purposes Only — Not for Human or Veterinary Use</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;color:#A09689;margin-top:10px;letter-spacing:0.08em;">Reference ${escapeHtml(order.order_number)}</div>
    </div>
  </div>
</body></html>`;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const gate = await requireAdmin(req);
  if (!gate.ok) return jsonResponse(gate.body, gate.status);

  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: "Database service not configured." }, 500);

  let payload: ReceiptPayload;
  try { payload = (await req.json()) as ReceiptPayload; }
  catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
  if (!payload.order_id) return jsonResponse({ error: "order_id is required." }, 400);
  const preview = payload.preview === true;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(`id, order_number, status, buyer_name, buyer_contact, buyer_organization,
             invoice_amount_cents, subtotal_cents, shipping_cents, payment_method,
             tracking_number, carrier, paid_at, fulfilled_at, delivered_at,
             ship_street, ship_city, ship_state, ship_zip, ship_country, created_at, lookup_token`)
    .eq("id", payload.order_id)
    .single();
  if (orderError || !order) return jsonResponse({ error: "Order not found." }, 404);

  const { data: lines } = await supabase
    .from("order_lines")
    .select("sku, product_name, quantity, unit_price_cents, item_note")
    .eq("order_id", order.id);
  const fullHtml = buildReceiptHtml(order as OrderRow, (lines ?? []) as OrderLine[]);

  // Preview: render only, no email, no write.
  if (preview) {
    return jsonResponse({ ok: true, preview: true, html: fullHtml, orderNumber: order.order_number });
  }

  // Send mode requires a real email + a payment on record.
  if (!RESEND_API_KEY) return jsonResponse({ error: "Email service not configured." }, 500);
  if (!order.paid_at && order.status !== "paid" && order.status !== "fulfilled") {
    return jsonResponse({ error: `Order is ${order.status}; a receipt is only valid once payment is recorded.` }, 409);
  }
  if (!EMAIL_REGEX.test(order.buyer_contact)) {
    return jsonResponse({ ok: false, skipped: true, reason: "Buyer contact is not an email address; receipt skipped." });
  }

  const subject = `Receipt ${order.order_number} · ${fmtUsd(order.invoice_amount_cents)} · ${EMAIL_BRAND.name}`;
  const result = await sendResendEmail({ to: order.buyer_contact, subject, html: fullHtml });
  if (!result.ok) {
    console.error("Receipt email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }

  // Stamp that we sent it (regenerable receipt → only the fact is stored).
  // Atomic increment via RPC; non-fatal if it fails (email already went out).
  const { error: stampError } = await supabase.rpc("mark_receipt_sent", { p_order_id: order.id });
  if (stampError) console.error("mark_receipt_sent failed:", stampError.message);

  return jsonResponse({ ok: true, html: fullHtml, orderNumber: order.order_number });
});
