// supabase/functions/send-order-invoice/index.ts
// Branded invoice email — pricing breakdown + Zelle payment instructions.
//
// Triggered when an admin marks an order as invoiced. Re-reads the
// canonical order from Postgres (no client-supplied amounts can be
// spoofed) and renders a real invoice: ship-to block, itemized lines,
// subtotal + shipping + total, and Zelle payment instructions with the
// order number called out as the required memo.
//
// Required env vars:
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
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>";
const ALLOWED_ORIGIN       = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const ZELLE_EMAIL = "info@velariss.co";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvoicePayload {
  order_id: string;
  invoice_url?: string;
}

interface OrderLine {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  item_note: string | null;
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

interface OrderRow {
  id: string;
  order_number: string;
  buyer_name: string;
  buyer_contact: string;
  buyer_organization: string | null;
  invoice_url: string | null;
  invoice_amount_cents: number | null;
  subtotal_cents: number | null;
  shipping_cents: number | null;
  payment_method: string | null;
  status: string;
  notes: string | null;
  ship_street: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  ship_country: string | null;
  created_at: string;
}

function buildInvoiceHtml(args: { order: OrderRow; lines: OrderLine[] }): string {
  const { order, lines } = args;
  const subtotal = order.subtotal_cents;
  const shipping = order.shipping_cents;
  const total    = order.invoice_amount_cents;

  const shipBlock = [
    order.ship_street,
    [order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(", "),
    order.ship_country,
  ].filter(Boolean).map(escapeHtml).join("<br/>");

  const lineRows = lines.map((l) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;">
        ${escapeHtml(l.sku)}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;color:#1A1714;font-size:13px;">
        ${escapeHtml(l.product_name)}
        ${l.item_note ? `<div style="color:#6F665C;font-size:11px;margin-top:2px;">Note: ${escapeHtml(l.item_note)}</div>` : ""}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#1A1714;">
        ${l.quantity}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#6F665C;">
        ${fmtUsd(l.unit_price_cents)}
      </td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Invoice ${escapeHtml(order.order_number)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:680px;margin:0 auto;padding:28px 14px;">

    <!-- Centered brand hero -->
    <div style="text-align:center;margin:0 0 28px;">
      <img src="https://vsresearchlabs.pages.dev/brand/vs-dna-s-full-colour.png" alt="VS Research Labs" width="96" height="96" style="display:inline-block;width:96px;height:96px;margin-bottom:14px;border:0;" />
      <div style="font-size:12px;letter-spacing:0.30em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:4px;">VS Research Labs</div>
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:14px;">Northern California Biopeptide Sciences</div>
      <span style="display:inline-block;padding:5px 13px;border-radius:999px;background:#FBF9F4;border:0.5px solid rgba(26,23,20,0.18);font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;letter-spacing:0.18em;color:#1A1714;text-transform:uppercase;">Invoice</span>
    </div>

    <!-- Order card -->
    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">

      <!-- Centered Order Reference -->
      <div style="text-align:center;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid #E4DFD5;">
        <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:8px;">Order Reference</div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:22px;letter-spacing:0.04em;color:#1A1714;font-weight:700;margin-bottom:6px;word-break:break-all;">${escapeHtml(order.order_number)}</div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;letter-spacing:0.08em;">${escapeHtml(order.created_at.slice(0, 10))} · ${escapeHtml(order.created_at.slice(11, 19))} UTC</div>
      </div>

      <!-- Bill To stacked above Ship To for symmetry -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Bill To</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.55;">
          <strong>${escapeHtml(order.buyer_name)}</strong><br/>
          ${escapeHtml(order.buyer_contact)}
          ${order.buyer_organization ? `<br/>${escapeHtml(order.buyer_organization)}` : ""}
        </div>
      </div>

      <div style="margin-bottom:22px;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Ship To</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.55;">${shipBlock || '<span style="color:#A09689;">— to be provided —</span>'}</div>
      </div>

      <!-- Items -->
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

      <!-- Totals -->
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Subtotal</td>
            <td style="padding:5px 14px;text-align:right;width:120px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${fmtUsd(subtotal ?? total)}</td></tr>
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Shipping estimate</td>
            <td style="padding:5px 14px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${shipping !== null && shipping !== undefined ? fmtUsd(shipping) : '<span style="color:#A09689;">TBD</span>'}</td></tr>
        <tr style="border-top:1px solid #E4DFD5;">
          <td style="padding:14px 14px 6px;text-align:right;font-size:11px;color:#6F665C;letter-spacing:0.2em;text-transform:uppercase;">Total Due</td>
          <td style="padding:14px 14px 6px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:20px;color:#1A1714;font-weight:700;">${fmtUsd(total)}</td>
        </tr>
      </table>
    </div>

    <!-- Payment instructions card -->
    <div style="background:#FBF9F4;border:1px solid rgba(52,114,122,0.35);border-radius:12px;padding:22px 24px;margin-top:16px;">
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:10px;">Payment Instructions</div>
      <p style="margin:0 0 12px;font-size:14px;color:#1A1714;line-height:1.6;">Please send <strong>${fmtUsd(total)}</strong> via <strong>Zelle</strong> to:</p>
      <div style="background:#F4EFE6;border:0.5px solid rgba(26,23,20,0.14);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:15px;color:#1A1714;letter-spacing:0.04em;word-break:break-all;"><strong>${escapeHtml(ZELLE_EMAIL)}</strong></div>
      <p style="margin:0 0 8px;font-size:13.5px;color:#1A1714;line-height:1.6;"><strong>Include your order number in the memo / note field:</strong></p>
      <div style="background:#F4EFE6;border:0.5px solid rgba(26,23,20,0.14);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:14px;color:#1A1714;letter-spacing:0.04em;word-break:break-all;"><strong>${escapeHtml(order.order_number)}</strong></div>
      <p style="margin:0;font-size:12.5px;color:#6F665C;line-height:1.6;background:#F4EFE6;padding:10px 14px;border-radius:6px;border-left:2px solid #34727A;">
        Send as <strong>family &amp; friends</strong> if Zelle prompts you to choose. Payments without the order number in the memo may delay fulfillment — please double-check before sending.
      </p>
    </div>

    <p style="margin:20px 4px 8px;font-size:13px;color:#1A1714;line-height:1.6;">
      Once payment is received and verified, your order moves to fulfillment and ships from our nearest warehouse (<strong>Sacramento</strong> or <strong>Vallejo, California</strong>). You'll receive a tracking number by email as soon as it leaves the dock.
    </p>
    <p style="margin:0 4px 16px;font-size:13px;color:#1A1714;line-height:1.6;">Questions? Simply reply to this email — your message lands on the same reference thread.</p>

    <div style="border-top:1px solid rgba(26,23,20,0.10);padding-top:14px;margin-top:20px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#6F665C;margin-bottom:4px;">VS Research Labs · Northern California Biopeptide Sciences</div>
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
             ship_street, ship_city, ship_state, ship_zip, ship_country, created_at`)
    .eq("id", payload.order_id)
    .single();
  if (orderError || !order) return jsonResponse({ error: "Order not found." }, 404);
  if (order.status !== "invoice_sent") return jsonResponse({ error: `Order status is ${order.status}; expected invoice_sent.` }, 409);
  if (!EMAIL_REGEX.test(order.buyer_contact)) {
    return jsonResponse({ ok: false, skipped: true, reason: "Buyer contact is not an email address; invoice email skipped." });
  }

  const { data: lines } = await supabase
    .from("order_lines")
    .select("sku, product_name, quantity, unit_price_cents, item_note")
    .eq("order_id", order.id);

  const html = buildInvoiceHtml({ order: order as OrderRow, lines: (lines ?? []) as OrderLine[] });
  const subject = `Invoice ${order.order_number} · ${fmtUsd(order.invoice_amount_cents)} · VS Research Labs`;
  const result = await sendResendEmail({ to: order.buyer_contact, subject, html });

  if (!result.ok) {
    console.error("Invoice email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }
  return jsonResponse({ ok: true, orderNumber: order.order_number });
});
