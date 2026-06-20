// supabase/functions/place-order/index.ts
// Auto-invoice checkout.
//
// On checkout the buyer's cart becomes a real ORDER and they immediately
// receive a branded invoice email with payment instructions. The order is
// recorded so it shows up in admin (Orders, Customers, Reports, Audit-able
// via the order row) exactly like an admin-created order.
//
// Flow:
//   1. Validate payload (buyer + items + per-line cart prices)
//   2. Rate-limit (≤ 5 checkouts per contact per hour)
//   3. Insert an inquiry row (history + customer auto-upsert trigger)
//   4. Insert inquiry_items (best-effort)
//   5. Insert an order (status = invoice_sent, amount = sum of lines)
//   6. Insert order_lines (with unit_price_cents from the cart)
//   7. Email the buyer the branded invoice + payment instructions
//   8. Email the business a copy
//   9. Return order number + amount to the client
//
// SECURITY NOTE: line prices are currently provided by the client (the
// catalog uses placeholder pricing). Because payment is verified manually
// (Zelle / PayPal Friends & Family, matched to the order number) this is
// acceptable for now. When real pricing lands, recompute totals server-side
// from a trusted price source before billing.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   RESEND_API_KEY
//   INQUIRY_TO_EMAIL        business inbox (default below)
//   RESEND_FROM_EMAIL       from header (default below)
//   ALLOWED_ORIGIN          production domain (omit for * in dev)
//   ZELLE_HANDLE            <-- SET THIS (phone/email Zelle is registered to)
//   PAYPAL_HANDLE           <-- SET THIS (paypal.me link or email)
//   BRAND_STAMP_URL         optional hosted PNG of the stamp for the email

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTurnstile, clientIp } from "../_shared/turnstile.ts";
import {
  buildInvoiceHtml,
  invoiceSubject,
  type OrderRow,
  type OrderLine,
} from "../_shared/invoiceEmail.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItemPayload {
  product: { id: string; name: string; category: string | null; sku?: string };
  quantity: number;
  note?: string;
  unitPriceCents?: number;
}

interface OrderPayload {
  name: string;
  contact: string;
  organization?: string;
  notes?: string;
  ship_street?: string;
  ship_city?: string;
  ship_state?: string;
  ship_zip?: string;
  ship_country?: string;
  items: OrderItemPayload[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const BUSINESS_EMAIL       = Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquiries@vsresearchlabs.com";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>";
const ALLOWED_ORIGIN       = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const ZELLE_HANDLE         = Deno.env.get("ZELLE_HANDLE") ?? "[SET ZELLE_HANDLE]";
const PAYPAL_HANDLE        = Deno.env.get("PAYPAL_HANDLE") ?? "[SET PAYPAL_HANDLE]";
const BRAND_STAMP_URL      = Deno.env.get("BRAND_STAMP_URL") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INTAKE_CHANNEL  = "VSR-WEB-PORTAL";
const PROCESSING_NODE = "VSR-HQ-INTAKE";
const MAX_LINE_CENTS  = 100_000_00; // $100k per line sanity cap

// ---------------------------------------------------------------------------
// Reference / order number — server-authoritative. VSR-REQ / VSR-ORD-YYMMDD-NNN
// ---------------------------------------------------------------------------

function stamp(prefix: string): string {
  const now = new Date();
  const yy  = String(now.getUTCFullYear()).slice(2);
  const mm  = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd  = String(now.getUTCDate()).padStart(2, "0");
  const seq = String(Math.floor(now.getTime() / 100) % 1000).padStart(3, "0");
  return `${prefix}-${yy}${mm}${dd}-${seq}`;
}
const generateReferenceId = () => stamp("VSR-REQ");
const generateOrderNumber = () => stamp("VSR-ORD");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
function clampQty(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(9999, Math.max(1, Math.floor(n)));
}
function clampCents(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_LINE_CENTS, Math.floor(n));
}
function usd(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Email building
// ---------------------------------------------------------------------------

function brandHeaderHtml(): string {
  // Prefer a hosted PNG of the stamp if provided; otherwise an email-safe
  // text "stamp" that mirrors the on-site mark (no SVG — clients strip it).
  if (BRAND_STAMP_URL) {
    return `<div style="text-align:center;margin:0 0 20px;">
      <img src="${escapeHtml(BRAND_STAMP_URL)}" alt="VS Research Labs" width="248" style="display:inline-block;max-width:248px;height:auto;" />
    </div>`;
  }
  return `
    <div style="border:1px solid #c9cdd2;border-radius:8px;padding:14px 18px;margin:0 0 22px;text-align:center;">
      <img src="https://vsresearchlabs.pages.dev/brand/vs-dna-s-full-colour.png" alt="VS Research Labs" width="64" height="64" style="display:block;margin:0 auto;width:64px;height:64px;border:0;" />
      <div style="font-family:'Cormorant Garamond','EB Garamond',Garamond,Georgia,serif;font-weight:500;font-size:26px;letter-spacing:0.02em;color:#1A1714;margin-top:8px;line-height:1;">
        Research Labs
      </div>
      <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:8px;letter-spacing:1px;color:#6a6f76;text-transform:uppercase;margin-top:8px;white-space:nowrap;">
        BioPeptides · Nootropics · Skincare
      </div>
      <div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:0.8px;color:#9aa0a6;text-transform:uppercase;margin-top:3px;white-space:nowrap;">
        For Research Use Only · Not For Human Use
      </div>
    </div>`;
}

function lineRowsHtml(items: OrderItemPayload[]): string {
  return items.map((item) => {
    const name = escapeHtml(item.product?.name ?? "Item");
    const sku  = item.product?.sku ? escapeHtml(item.product.sku) : "—";
    const qty  = clampQty(item.quantity);
    const unit = clampCents(item.unitPriceCents);
    const line = unit * qty;
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#555;">${sku}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${qty}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;">${unit ? usd(unit) : "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;">${line ? usd(line) : "—"}</td>
      </tr>`;
  }).join("");
}

// "Ship to" block — shows the address the buyer entered in the cart so they
// can verify it before paying, and so the business knows where to ship.
// Renders nothing if no address fields are present (e.g. equipment quote).
function shipBlockHtml(payload: OrderPayload, opts: { heading: string }): string {
  const street  = (payload.ship_street  ?? "").trim();
  const city    = (payload.ship_city    ?? "").trim();
  const state   = (payload.ship_state   ?? "").trim();
  const zip     = (payload.ship_zip     ?? "").trim();
  const country = (payload.ship_country ?? "").trim();
  if (!street && !city && !state && !zip) return "";
  const cityLine = [city, state].filter(Boolean).join(", ");
  const cityZip = [cityLine, zip].filter(Boolean).join(" ").trim();
  return `
    <div style="border:1px solid #dcdcdc;border-radius:8px;padding:14px 18px;margin:0 0 18px;background:#fafafa;">
      <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.25em;color:#6a6f76;text-transform:uppercase;margin:0 0 8px;">
        ${escapeHtml(opts.heading)}
      </div>
      <div style="font-size:14px;color:#111;line-height:1.45;">
        ${escapeHtml(payload.name)}<br/>
        ${street ? escapeHtml(street) + "<br/>" : ""}
        ${cityZip ? escapeHtml(cityZip) + "<br/>" : ""}
        ${country ? escapeHtml(country) : ""}
      </div>
      <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.18em;color:#9aa0a6;text-transform:uppercase;margin-top:10px;">
        Please verify before paying — reply to this email if anything is wrong.
      </div>
    </div>`;
}

// Extract the short payment code (the serial after the final dash).
// Format is VSR-ORD-YYMMDD-NNN(N) — combined with the date the buyer pays,
// the serial is uniquely identifying. Customers only need to type these
// 3–4 digits in the Zelle/PayPal note.
function paymentCode(orderNumber: string): string {
  const parts = orderNumber.split("-");
  return parts[parts.length - 1] || orderNumber;
}

function paymentBlockHtml(orderNumber: string, totalCents: number): string {
  const code = paymentCode(orderNumber);
  return `
    <div style="border:1px solid #dcdcdc;border-radius:8px;padding:18px 20px;margin-top:24px;background:#fafafa;">
      <h3 style="margin:0 0 10px;font-weight:600;letter-spacing:0.03em;color:#111;">How to pay</h3>
      <p style="margin:0 0 12px;color:#222;">Amount due: <strong>${usd(totalCents)}</strong></p>
      <p style="margin:0 0 10px;color:#333;">
        Send payment using <strong>one</strong> of the methods below. You
        <strong>must send it as Friends &amp; Family</strong> — any payment
        not sent as Friends &amp; Family will be <strong>rejected</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;">
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;width:80px;"><strong>Zelle</strong></td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(ZELLE_HANDLE)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#666;"><strong>PayPal</strong></td>
          <td style="padding:8px 0;font-family:monospace;">${escapeHtml(PAYPAL_HANDLE)} <span style="color:#888;font-family:Inter,Arial,sans-serif;">(Friends &amp; Family — not Goods &amp; Services)</span></td>
        </tr>
      </table>
      <div style="border:1px solid #c9cdd2;border-radius:8px;padding:14px 18px;margin:0 0 12px;background:#fff;text-align:center;">
        <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.3em;color:#6a6f76;text-transform:uppercase;margin:0 0 8px;">
          Payment note · enter exactly
        </div>
        <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-weight:700;font-size:34px;letter-spacing:0.18em;color:#1A1714;line-height:1;">
          ${escapeHtml(code)}
        </div>
        <div style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#666;margin-top:8px;">
          That's all you type in the Zelle / PayPal note — no dashes, no letters.
        </div>
      </div>
      <p style="margin:0 0 6px;color:#444;font-size:12px;">
        Your full order reference is
        <span style="font-family:monospace;color:#111;">${escapeHtml(orderNumber)}</span>
        — we use that on our end; you don't need to retype it.
      </p>
      <p style="margin:0;color:#333;">
        Once your payment is confirmed, your order will be processed and your
        products shipped.
      </p>
    </div>`;
}

// Short acknowledgement sent at order-placement time. Confirms the order
// was received and tells the buyer the formal invoice arrives shortly
// (admin reviews + sends it manually via /admin/orders/:id). Replaces the
// old "auto-invoice at cart submit" flow.
function buildAcknowledgementHtml(
  payload: OrderPayload, orderNumber: string,
): string {
  const shipLines: string[] = [];
  if (payload.ship_street) shipLines.push(escapeHtml(payload.ship_street));
  const cityState = [payload.ship_city, payload.ship_state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, payload.ship_zip].filter(Boolean).join(" ").trim();
  if (cityStateZip) shipLines.push(escapeHtml(cityStateZip));
  if (payload.ship_country) shipLines.push(escapeHtml(payload.ship_country));

  return `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:8px;">
      ${brandHeaderHtml()}
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:18px 0 12px;text-align:center;">
        We got your order, ${escapeHtml((payload.name ?? "").split(" ")[0] || "researcher")}.
      </h2>
      <p style="font-size:14px;color:#444;line-height:1.55;margin:0 0 16px;text-align:center;">
        Your reference number is
        <span style="font-family:monospace;font-weight:700;color:#111;">${escapeHtml(orderNumber)}</span>.
        A team member will review pricing + availability, then email you a
        formal invoice with payment instructions. You don't need to do
        anything until that arrives — usually within a few hours during
        business hours.
      </p>
      ${shipLines.length > 0 ? `
        <div style="border:1px solid #dcdcdc;border-radius:8px;padding:14px 18px;margin:0 0 18px;background:#fafafa;">
          <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.25em;color:#6a6f76;text-transform:uppercase;margin:0 0 8px;">
            Ship to
          </div>
          <div style="font-size:13px;color:#111;line-height:1.5;">
            ${escapeHtml(payload.name)}<br/>
            ${shipLines.join("<br/>")}
          </div>
          <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.18em;color:#9aa0a6;text-transform:uppercase;margin-top:10px;">
            Reply to this email if anything is wrong.
          </div>
        </div>
      ` : ""}
      <p style="margin-top:24px;color:#888;font-size:12px;text-align:center;">
        VS Research Labs — For Research Purposes Only · Not for Human Use
      </p>
    </div>`;
}

function buildInvoiceEmailHtml(
  payload: OrderPayload, orderNumber: string, totalCents: number,
): string {
  return `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:8px;">
      ${brandHeaderHtml()}
      <table style="width:100%;font-size:13px;color:#444;margin:0 0 14px;">
        <tr>
          <td style="padding:2px 0;">Order number</td>
          <td style="padding:2px 0;text-align:right;font-family:monospace;font-weight:700;color:#111;">${escapeHtml(orderNumber)}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Billed to</td>
          <td style="padding:2px 0;text-align:right;">${escapeHtml(payload.name)}</td>
        </tr>
      </table>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">Your invoice</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">SKU</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Qty</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Unit</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Line</th>
          </tr>
        </thead>
        <tbody>${lineRowsHtml(payload.items)}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="padding:12px;text-align:right;font-weight:600;">Total</td>
            <td style="padding:12px;text-align:right;font-weight:700;font-family:monospace;">${usd(totalCents)}</td>
          </tr>
        </tfoot>
      </table>
      ${shipBlockHtml(payload, { heading: "Ship to · verify before paying" })}
      ${paymentBlockHtml(orderNumber, totalCents)}
      <p style="margin-top:24px;color:#888;font-size:12px;">
        VS Research Labs — For Research Purposes Only · Not for Human Use
      </p>
    </div>`;
}

function buildBusinessEmailHtml(
  payload: OrderPayload, orderNumber: string, referenceId: string, totalCents: number,
): string {
  const org = payload.organization
    ? `<tr><td style="padding:2px 0;">Organization</td><td style="padding:2px 0;text-align:right;">${escapeHtml(payload.organization)}</td></tr>` : "";
  const notes = payload.notes
    ? `<div style="border:1px solid #eee;border-radius:6px;padding:10px 12px;margin:14px 0;background:#fafafa;color:#333;font-size:13px;"><strong style="display:block;margin-bottom:4px;color:#666;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;font-size:11px;">Buyer notes</strong>${escapeHtml(payload.notes).replace(/\n/g, "<br/>")}</div>` : "";
  return `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:8px;">
      ${brandHeaderHtml()}
      <div style="text-align:center;margin:-8px 0 18px;font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.25em;color:#9aa0a6;text-transform:uppercase;">
        Internal copy · Buyer invoice auto-sent
      </div>
      <table style="width:100%;font-size:13px;color:#444;margin:0 0 14px;">
        <tr>
          <td style="padding:2px 0;">Order number</td>
          <td style="padding:2px 0;text-align:right;font-family:monospace;font-weight:700;color:#111;">${escapeHtml(orderNumber)}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Reference</td>
          <td style="padding:2px 0;text-align:right;font-family:monospace;color:#666;">${escapeHtml(referenceId)}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Buyer</td>
          <td style="padding:2px 0;text-align:right;">${escapeHtml(payload.name)}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Contact</td>
          <td style="padding:2px 0;text-align:right;font-family:monospace;">${escapeHtml(payload.contact)}</td>
        </tr>
        ${org}
      </table>
      ${shipBlockHtml(payload, { heading: "Ship to" })}
      ${notes}
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:18px 0 16px;">Order</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">SKU</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Qty</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Unit</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Line</th>
          </tr>
        </thead>
        <tbody>${lineRowsHtml(payload.items)}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="padding:12px;text-align:right;font-weight:600;">Total</td>
            <td style="padding:12px;text-align:right;font-weight:700;font-family:monospace;">${usd(totalCents)}</td>
          </tr>
        </tfoot>
      </table>
      <div style="border:1px solid #dcdcdc;border-radius:8px;padding:14px 18px;margin-top:22px;background:#fafafa;color:#333;font-size:13px;">
        <strong style="display:block;margin-bottom:4px;color:#111;">Action</strong>
        Buyer received their branded invoice with Zelle / PayPal instructions.
        Watch <span style="font-family:monospace;">${escapeHtml(ZELLE_HANDLE)}</span>
        for a payment with note
        <span style="font-family:monospace;font-weight:700;font-size:15px;color:#111;">${escapeHtml(paymentCode(orderNumber))}</span>
        (full order <span style="font-family:monospace;">${escapeHtml(orderNumber)}</span>).
        Mark paid in Admin → Orders once confirmed.
      </div>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        VS Research Labs — Internal notification · Do not forward to buyer
      </p>
    </div>`;
}

async function sendResendEmail(args: { to: string; subject: string; html: string; replyTo?: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL, to: args.to, subject: args.subject, html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed." }, 405);
  if (!RESEND_API_KEY)          return jsonResponse({ error: "Email service not configured." }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: "Database service not configured." }, 500);

  let payload: OrderPayload;
  try { payload = (await req.json()) as OrderPayload; }
  catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

  // Bot check (no-op until TURNSTILE_SECRET is set).
  const ts = await verifyTurnstile(
    (payload as { turnstile_token?: string }).turnstile_token,
    clientIp(req),
  );
  if (!ts.ok) return jsonResponse({ error: ts.reason ?? "Verification failed." }, 403);

  const name         = (payload.name ?? "").trim();
  const contact      = (payload.contact ?? "").trim();
  const organization = (payload.organization ?? "").trim();
  const notes        = (payload.notes ?? "").trim();
  const shipStreet   = (payload.ship_street  ?? "").trim().slice(0, 200);
  const shipCity     = (payload.ship_city    ?? "").trim().slice(0, 120);
  const shipState    = (payload.ship_state   ?? "").trim().slice(0,  60);
  const shipZip      = (payload.ship_zip     ?? "").trim().slice(0,  20);
  const shipCountry  = (payload.ship_country ?? "US").trim().slice(0,  60);
  const rawItems: unknown[] = Array.isArray(payload.items) ? (payload.items as unknown[]) : [];

  if (!name)                     return jsonResponse({ error: "Name is required." }, 400);
  if (name.length > 120)         return jsonResponse({ error: "Name too long." }, 400);
  if (!contact)                  return jsonResponse({ error: "Contact is required." }, 400);
  if (contact.length > 200)      return jsonResponse({ error: "Contact too long." }, 400);
  if (organization.length > 200) return jsonResponse({ error: "Organization too long." }, 400);
  if (notes.length > 4000)       return jsonResponse({ error: "Notes too long." }, 400);
  if (rawItems.length === 0)     return jsonResponse({ error: "Order must contain at least one item." }, 400);
  if (rawItems.length > 100)     return jsonResponse({ error: "Too many items in order." }, 400);

  const items: OrderItemPayload[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") return jsonResponse({ error: "Malformed item." }, 400);
    const r = raw as Record<string, unknown>;
    const product = (r.product ?? null) as Record<string, unknown> | null;
    if (!product || typeof product !== "object") return jsonResponse({ error: "Item missing product details." }, 400);
    const productId   = typeof product.id === "string" ? product.id : "";
    const productName = typeof product.name === "string" ? product.name.trim() : "";
    if (!productId || !productName) return jsonResponse({ error: "Item product must include id and name." }, 400);
    const category = typeof product.category === "string" ? product.category : null;
    const sku      = typeof product.sku === "string" ? product.sku.trim() : "";
    const noteRaw  = typeof r.note === "string" ? r.note.trim() : "";
    items.push({
      product: { id: productId, name: productName, category, sku: sku || undefined },
      quantity: clampQty(r.quantity),
      note: noteRaw.length > 0 ? noteRaw.slice(0, 1000) : undefined,
      unitPriceCents: clampCents(r.unitPriceCents),
    });
  }

  const itemCount  = items.reduce((s, i) => s + clampQty(i.quantity), 0);
  const totalCents = items.reduce((s, i) => s + clampCents(i.unitPriceCents) * clampQty(i.quantity), 0);
  const contactIsEmail = EMAIL_REGEX.test(contact);
  const cleanPayload: OrderPayload = {
    name, contact,
    organization: organization || undefined,
    notes: notes || undefined,
    ship_street:  shipStreet  || undefined,
    ship_city:    shipCity    || undefined,
    ship_state:   shipState   || undefined,
    ship_zip:     shipZip     || undefined,
    ship_country: shipCountry || undefined,
    items,
  };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Rate limit (shared with inquiries by contact)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("inquiries").select("*", { count: "exact", head: true })
    .eq("contact", contact).gte("created_at", oneHourAgo);
  if ((recentCount ?? 0) >= 5) {
    return jsonResponse({ error: "Too many orders from this contact. Please wait before trying again." }, 429);
  }

  // 1) Inquiry row (history + customer trigger)
  const referenceId = generateReferenceId();
  const { data: inquiryRow, error: inqErr } = await supabase
    .from("inquiries")
    .insert({
      reference_id: referenceId, name, contact,
      organization: organization || null, notes: notes || null,
      ship_street:  shipStreet  || null,
      ship_city:    shipCity    || null,
      ship_state:   shipState   || null,
      ship_zip:     shipZip     || null,
      ship_country: shipCountry || null,
      status: "REVIEWING", intake_channel: INTAKE_CHANNEL, processing_node: PROCESSING_NODE,
      item_count: itemCount,
    })
    .select("id, reference_id, created_at").single();
  if (inqErr || !inquiryRow) {
    console.error("Inquiry insert failed:", inqErr);
    return jsonResponse({ error: "Failed to record order. Please try again." }, 502);
  }

  await supabase.from("inquiry_items").insert(items.map((i) => ({
    inquiry_id: inquiryRow.id, sku: i.product.sku ?? i.product.id,
    product_name: i.product.name, quantity: clampQty(i.quantity),
    category: i.product.category ?? null, item_note: i.note ?? null,
  })));

  // 2) Order row — created in invoice_sent. The buyer gets the full
  // branded invoice (with terms + purity guarantee + payment block +
  // "I've sent payment" CTA) immediately at order time, so this stage
  // is already past the "we need to review" step. Admin can still edit
  // lines later and re-fire the invoice from /admin/orders/:id if needed.
  const orderNumber = generateOrderNumber();
  const { data: orderRow, error: ordErr } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber, inquiry_id: inquiryRow.id, status: "invoice_sent",
      buyer_name: name, buyer_contact: contact, buyer_organization: organization || null,
      notes: notes || null,
      ship_street:  shipStreet  || null,
      ship_city:    shipCity    || null,
      ship_state:   shipState   || null,
      ship_zip:     shipZip     || null,
      ship_country: shipCountry || null,
      subtotal_cents:       totalCents,
      shipping_cents:       null,
      invoice_amount_cents: totalCents,
      payment_method:       `Zelle (${ZELLE_HANDLE}) or PayPal (${PAYPAL_HANDLE})`,
      invoiced_at: new Date().toISOString(),
    })
    .select("id, order_number, created_at").single();
  if (ordErr || !orderRow) {
    console.error("Order insert failed:", ordErr);
    // Inquiry is recorded; surface a soft failure so the buyer can be followed up.
    return jsonResponse({ error: "Order could not be created. Our team has your request and will follow up.", referenceId }, 502);
  }

  const { error: linesErr } = await supabase.from("order_lines").insert(items.map((i) => ({
    order_id: orderRow.id, sku: i.product.sku ?? i.product.id, product_name: i.product.name,
    quantity: clampQty(i.quantity), unit_price_cents: clampCents(i.unitPriceCents),
    item_note: i.note ?? null,
  })));
  if (linesErr) console.error("Order lines insert failed:", linesErr);

  // 3) Emails
  //   Buyer: render the FULL branded invoice from the SHARED template
  //     (_shared/invoiceEmail.ts) and send it INLINE over the same Resend path
  //     the business notification uses. We deliberately do NOT call the
  //     send-order-invoice Edge Function over HTTP here: that internal
  //     function-to-function hop proved unreliable (the buyer copy silently
  //     never arrived while the inline business email always did). The shared
  //     template keeps a single source of truth; send-order-invoice still
  //     exists for admin re-sends and renders the identical email.
  //   Business: branded internal notification with prices visible at a
  //     glance + "watch for payment code" action block.
  let invoiceEmailSent = false;
  if (contactIsEmail) {
    try {
      // Re-read the order so we have the DB-generated lookup_token (for the
      // "I've sent payment" + view-invoice links) and the canonical amounts.
      const { data: invOrder } = await supabase
        .from("orders")
        .select(`id, order_number, buyer_name, buyer_contact, buyer_organization,
                 invoice_url, invoice_amount_cents, subtotal_cents, shipping_cents,
                 payment_method, status, notes,
                 ship_street, ship_city, ship_state, ship_zip, ship_country, created_at, lookup_token`)
        .eq("id", orderRow.id)
        .single();
      if (invOrder) {
        const { data: invLines } = await supabase
          .from("order_lines")
          .select("sku, product_name, quantity, unit_price_cents, item_note")
          .eq("order_id", orderRow.id);
        const invRes = await sendResendEmail({
          to: contact,
          subject: invoiceSubject(invOrder),
          html: buildInvoiceHtml({ order: invOrder as OrderRow, lines: (invLines ?? []) as OrderLine[] }),
          replyTo: BUSINESS_EMAIL,
        });
        invoiceEmailSent = invRes.ok;
        if (!invRes.ok) console.error("Buyer invoice email failed:", invRes.status, invRes.body);
      } else {
        console.error("Buyer invoice: could not re-read order", orderRow.id);
      }
    } catch (err) {
      console.error("Buyer invoice email threw:", err);
    }
  }
  const biz = await sendResendEmail({
    to: BUSINESS_EMAIL,
    subject: `New order ${orderNumber} — ${name} (${usd(totalCents)})`,
    html: buildBusinessEmailHtml(cleanPayload, orderNumber, referenceId, totalCents),
    replyTo: contactIsEmail ? contact : undefined,
  });
  if (!biz.ok) console.error("Business email failed:", biz);

  return jsonResponse({
    success: true,
    orderNumber: orderRow.order_number,
    referenceId,
    createdAt: orderRow.created_at,
    amountCents: totalCents,
    invoiceEmailSent,
    contactIsEmail,
  });
});
