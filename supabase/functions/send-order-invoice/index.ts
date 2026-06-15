// supabase/functions/send-order-invoice/index.ts
// Sends the "Order Received – Payment Instructions" email to the buyer
// when an admin marks an order as invoiced. Pulls the canonical order
// from Postgres so client-supplied amounts can't be spoofed (the function
// re-reads the order_number, buyer_contact, and invoice_amount_cents
// from the DB; the request body only carries order_id + invoice_url +
// invoice_amount_cents for redundancy / validation).
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
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>";
const ALLOWED_ORIGIN       = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvoicePayload {
  order_id: string;
  invoice_url: string;
  invoice_amount_cents: number;
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

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function buildInvoiceEmailHtml(args: {
  orderNumber: string;
  buyerName: string;
  invoiceUrl: string;
  amountCents: number;
}): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;line-height:1.55;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(args.orderNumber)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">
        Order Received — Payment Instructions
      </h2>
      <p>Hi ${escapeHtml(args.buyerName || "there")},</p>
      <p>Thank you for your inquiry with VS Research Labs.</p>
      <p>
        Your order request has been received and is currently being prepared for
        processing. To complete your order, payment of
        <strong>${escapeHtml(formatUsd(args.amountCents))}</strong>
        must be submitted using one of the approved payment methods listed below:
      </p>
      <ul style="padding-left:1.25em;">
        <li>PayPal (Friends &amp; Family)</li>
        <li>Zelle</li>
      </ul>
      <p>Payment details are included with your invoice:</p>
      <p style="margin:18px 0;">
        <a
          href="${escapeHtml(args.invoiceUrl)}"
          style="display:inline-block;background:#111;color:#fff;text-decoration:none;
                 padding:10px 22px;border-radius:999px;font-size:13px;letter-spacing:0.04em;"
        >View invoice</a>
      </p>
      <p style="background:#f6f6f6;padding:14px 16px;border-radius:6px;font-size:13px;color:#444;">
        <strong>Please note:</strong> payments sent through PayPal Goods &amp;
        Services, chargeback-enabled methods, or any payment method not specified
        on the invoice may result in the order being cancelled and any received
        funds being returned.
      </p>
      <p>
        Once payment is received and verified, you will receive an order
        confirmation and fulfillment update.
      </p>
      <p>
        If you have any questions regarding your order, invoice, or payment
        instructions, please reply to this email and our team will be happy to
        assist.
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
        For Research Purposes Only — Not for Human or Veterinary Use.
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

  let payload: InvoicePayload;
  try {
    payload = (await req.json()) as InvoicePayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!payload.order_id) return jsonResponse({ error: "order_id is required." }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Re-read canonical order from DB (don't trust client amounts / contacts).
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_number, buyer_name, buyer_contact, invoice_url, invoice_amount_cents, status")
    .eq("id", payload.order_id)
    .single();

  if (orderError || !order) {
    return jsonResponse({ error: "Order not found." }, 404);
  }

  if (order.status !== "invoice_sent") {
    return jsonResponse({ error: `Order status is ${order.status}; expected invoice_sent.` }, 409);
  }

  if (!EMAIL_REGEX.test(order.buyer_contact)) {
    return jsonResponse({
      ok: false,
      skipped: true,
      reason: "Buyer contact is not an email address; invoice email skipped.",
    });
  }

  const subject = `Order Received — Payment Instructions · ${order.order_number}`;
  const html = buildInvoiceEmailHtml({
    orderNumber: order.order_number,
    buyerName:   order.buyer_name,
    invoiceUrl:  order.invoice_url ?? payload.invoice_url ?? "",
    amountCents: order.invoice_amount_cents ?? payload.invoice_amount_cents ?? 0,
  });

  const result = await sendResendEmail({
    to:      order.buyer_contact,
    subject,
    html,
  });

  if (!result.ok) {
    console.error("Invoice email failed:", result);
    return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
  }

  return jsonResponse({ ok: true, orderNumber: order.order_number });
});
