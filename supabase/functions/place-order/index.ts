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
// SECURITY NOTE: line prices are provided by the client, but every line is
// now CHECKED server-side against the admin-set price (product_variant_stock
// per-dose price, else product_stock.price_cents_override). A mismatch does
// not block the order — payment is verified manually — but it flags the
// business email subject/body, logs, and writes an order_events warning so
// the operator verifies before marking paid. Lines without an admin-set
// price (formula-priced catalog) can't be verified and are skipped.
//
// IDEMPOTENCY: the client sends a UUID idempotency_key that is stable across
// retries of the same checkout; a seen key returns the original order (no
// duplicate row, no duplicate emails). Requires migration 035.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   RESEND_API_KEY
//   INQUIRY_TO_EMAIL        business inbox (default below)
//   RESEND_FROM_EMAIL       from header (default below)
//   ALLOWED_ORIGIN          production domain (falls back to vsresearchlabs.com if unset)
//   ZELLE_HANDLE            <-- SET THIS (phone/email Zelle is registered to)
//   PAYPAL_HANDLE           <-- SET THIS (paypal.me link or email)
//   BRAND_STAMP_URL         optional hosted PNG of the stamp for the email

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTurnstile, clientIp } from "../_shared/turnstile.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { EMAIL_BRAND } from "../_shared/emailBrand.ts";
import {
  buildInvoiceHtml,
  buildInvoiceText,
  invoiceSubject,
  type OrderRow,
  type OrderLine,
  type CouponLine,
} from "../_shared/invoiceEmail.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItemPayload {
  product: { id: string; name: string; category: string | null; sku?: string };
  quantity: number;
  note?: string;
  unitPriceCents?: number;
  /** true = fast ship, false = standard (drop-ship). Drives the email badges. */
  fast?: boolean;
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
  /** Promo/affiliate code. Validated + priced SERVER-SIDE via validate_coupon —
   *  the client never supplies a discount amount, only the code. */
  coupon_code?: string;
  /** Stackable promo codes — the buyer may apply more than one. Superset of
   *  `coupon_code`; each is validated + priced SERVER-SIDE and stacked
   *  (additive off the original subtotal, capped so the order never < $0). */
  coupon_codes?: string[];
  /** Client-generated UUID, stable across retries of the SAME checkout —
   *  a seen key returns the existing order instead of creating a duplicate. */
  idempotency_key?: string;
}

/** One order line whose client-sent price disagrees with the admin-set price. */
interface PriceMismatch {
  sku: string;
  name: string;
  clientCents: number;
  serverCents: number;
}

/** Shape returned by the validate_coupon RPC (migration 031). */
interface CouponCheck {
  valid: boolean;
  reason?: string;
  code?: string;
  kind?: "percent" | "fixed" | "free_item";
  percent?: number | null;
  amount_cents?: number | null;
  discount_cents?: number;
  free_sku?: string | null;
  free_dose?: string | null;
  free_label?: string | null;
  requires_account?: boolean;
}

/** Shape returned by the effective_customer_discount RPC (migration 045). */
interface AccountDiscountRpc {
  found?: boolean;
  scope?: string;
  percent?: number;
  label?: string;
  discount_id?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const BUSINESS_EMAIL       = Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquiries@vsresearchlabs.com";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>";
const ZELLE_HANDLE         = Deno.env.get("ZELLE_HANDLE") ?? "info@velariss.co";
const PAYPAL_HANDLE        = Deno.env.get("PAYPAL_HANDLE") ?? "[SET PAYPAL_HANDLE]";
const BRAND_STAMP_URL      = Deno.env.get("BRAND_STAMP_URL") ?? "";

const CORS_HEADERS = buildCorsHeaders();

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

// Order numbers are short, unguessable codes (VSR-XXXXXX). Alphabet excludes
// ambiguous characters (O/0/I/1/L) so they read cleanly aloud. Matches the
// DB-side gen_order_number() used by the admin path.
const ORDER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += ORDER_ALPHABET[bytes[i] % ORDER_ALPHABET.length];
  return s;
}
const generateReferenceId = () => stamp("VSR-REQ");
const generateOrderNumber = () => `VSR-${randomCode(6)}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      <img src="${escapeHtml(BRAND_STAMP_URL)}" alt="${escapeHtml(EMAIL_BRAND.name)}" width="248" style="display:inline-block;max-width:248px;height:auto;" />
    </div>`;
  }
  return `
    <div style="border:1px solid #c9cdd2;border-radius:8px;padding:14px 18px;margin:0 0 22px;text-align:center;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${escapeHtml(EMAIL_BRAND.name)}" width="64" height="64" style="display:block;margin:0 auto;width:64px;height:64px;border:0;" />
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

function shipTagBiz(fast: boolean | undefined): string {
  if (fast === true)  return `<div style="margin-top:3px;"><span style="font-family:monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#2E7D5B;background:rgba(46,125,91,0.10);border:1px solid rgba(46,125,91,0.30);border-radius:3px;padding:1px 5px;">⚡ 24 HR</span></div>`;
  if (fast === false) return `<div style="margin-top:3px;"><span style="font-family:monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#6a6f76;background:#f3f3f3;border:1px solid #ddd;border-radius:3px;padding:1px 5px;">Standard</span></div>`;
  return "";
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
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${name}${shipTagBiz(item.fast)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${qty}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;">${unit ? usd(unit) : "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;">${line ? usd(line) : "—"}</td>
      </tr>`;
  }).join("");
}

/** Mixed fast + standard → flag in the business email so the operator knows
 *  to split the shipment. Empty when all lines are the same speed (or unknown). */
function mixedShipNoticeHtml(items: OrderItemPayload[]): string {
  const speeds = items.map((i) => i.fast);
  if (!(speeds.includes(true) && speeds.includes(false))) return "";
  return `<div style="border:1px solid rgba(214,158,46,0.45);background:rgba(214,158,46,0.10);border-radius:8px;padding:12px 16px;margin:14px 0;color:#1A1714;font-size:13px;">
    <strong style="display:block;margin-bottom:3px;color:#9A7B1E;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">⚡ Split shipment</strong>
    This order mixes 24-hour-shipping and standard items — ship them separately.
  </div>`;
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
          <td style="padding:8px 0;color:#666;width:80px;"><strong>Zelle</strong></td>
          <td style="padding:8px 0;font-family:monospace;">${escapeHtml(ZELLE_HANDLE)} <span style="color:#888;font-family:Inter,Arial,sans-serif;">(Friends &amp; Family — not Goods &amp; Services)</span></td>
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
          That's all you type in the Zelle note — no dashes, no letters.
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
        ${escapeHtml(EMAIL_BRAND.name)} — For Research Purposes Only · Not for Human Use
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
        ${escapeHtml(EMAIL_BRAND.name)} — For Research Purposes Only · Not for Human Use
      </p>
    </div>`;
}

function priceMismatchNoticeHtml(mismatches: PriceMismatch[]): string {
  if (mismatches.length === 0) return "";
  const rows = mismatches.map((m) =>
    `<div style="font-family:monospace;font-size:12px;margin-top:4px;">${escapeHtml(m.sku)} — billed <strong>${usd(m.clientCents)}</strong>, catalog says <strong>${usd(m.serverCents)}</strong></div>`,
  ).join("");
  return `<div style="border:1px solid rgba(196,64,64,0.5);background:rgba(196,64,64,0.08);border-radius:8px;padding:12px 16px;margin:14px 0;color:#1A1714;font-size:13px;">
    <strong style="display:block;margin-bottom:3px;color:#A03232;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">⚠ Price mismatch — verify before marking paid</strong>
    The cart submitted prices that differ from the admin-set catalog prices.${rows}
  </div>`;
}

function buildBusinessEmailHtml(
  payload: OrderPayload, orderNumber: string, referenceId: string, totalCents: number,
  promo?: { code: string; discountCents: number },
  mismatches: PriceMismatch[] = [],
): string {
  const org = payload.organization
    ? `<tr><td style="padding:2px 0;">Organization</td><td style="padding:2px 0;text-align:right;">${escapeHtml(payload.organization)}</td></tr>` : "";
  const promoRows = promo
    ? `
          <tr>
            <td colspan="4" style="padding:6px 12px;text-align:right;color:#666;">Subtotal</td>
            <td style="padding:6px 12px;text-align:right;font-family:monospace;color:#666;">${usd(totalCents + promo.discountCents)}</td>
          </tr>
          <tr>
            <td colspan="4" style="padding:6px 12px;text-align:right;color:#2E7D5B;">Code <span style="font-family:monospace;font-weight:700;">${escapeHtml(promo.code)}</span></td>
            <td style="padding:6px 12px;text-align:right;font-family:monospace;color:#2E7D5B;">${promo.discountCents > 0 ? "−" + usd(promo.discountCents) : "FREE ITEM"}</td>
          </tr>` : "";
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
        <tfoot>${promoRows}
          <tr>
            <td colspan="4" style="padding:12px;text-align:right;font-weight:600;">Total</td>
            <td style="padding:12px;text-align:right;font-weight:700;font-family:monospace;">${usd(totalCents)}</td>
          </tr>
        </tfoot>
      </table>
      ${mixedShipNoticeHtml(payload.items)}
      ${priceMismatchNoticeHtml(mismatches)}
      <div style="border:1px solid #dcdcdc;border-radius:8px;padding:14px 18px;margin-top:22px;background:#fafafa;color:#333;font-size:13px;">
        <strong style="display:block;margin-bottom:4px;color:#111;">Action</strong>
        Buyer received their branded invoice with Zelle instructions.
        Watch <span style="font-family:monospace;">${escapeHtml(ZELLE_HANDLE)}</span>
        for a payment with note
        <span style="font-family:monospace;font-weight:700;font-size:15px;color:#111;">${escapeHtml(paymentCode(orderNumber))}</span>
        (full order <span style="font-family:monospace;">${escapeHtml(orderNumber)}</span>).
        Mark paid in Admin → Orders once confirmed.
      </div>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        ${escapeHtml(EMAIL_BRAND.name)} — Internal notification · Do not forward to buyer
      </p>
    </div>`;
}

async function sendResendEmail(args: { to: string; subject: string; html: string; text?: string; replyTo?: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL, to: args.to, subject: args.subject, html: args.html,
      ...(args.text ? { text: args.text } : {}),
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
      fast: typeof r.fast === "boolean" ? r.fast : undefined,
    });
  }

  let itemCount = items.reduce((s, i) => s + clampQty(i.quantity), 0);
  const grossSubtotalCents = items.reduce((s, i) => s + clampCents(i.unitPriceCents) * clampQty(i.quantity), 0);
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

  // Idempotency — a retry of the SAME checkout (client re-sends its key after
  // a timeout/network failure) returns the already-created order instead of
  // creating and re-emailing a duplicate. Runs before the rate limit so a
  // legitimate retry can't be 429'd for its own first attempt.
  const idempotencyKey =
    typeof payload.idempotency_key === "string" && UUID_REGEX.test(payload.idempotency_key)
      ? payload.idempotency_key.toLowerCase()
      : null;
  if (idempotencyKey) {
    const { data: dupe } = await supabase
      .from("orders")
      .select("order_number, created_at, invoice_amount_cents, inquiry_id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (dupe) {
      let dupeReference = "";
      if (dupe.inquiry_id) {
        const { data: inq } = await supabase
          .from("inquiries").select("reference_id").eq("id", dupe.inquiry_id).maybeSingle();
        dupeReference = inq?.reference_id ?? "";
      }
      return jsonResponse({
        success: true,
        duplicate: true,
        orderNumber: dupe.order_number,
        referenceId: dupeReference,
        createdAt: dupe.created_at,
        amountCents: dupe.invoice_amount_cents ?? 0,
        invoiceEmailSent: contactIsEmail, // sent on the original attempt
        contactIsEmail,
      });
    }
  }

  // Server price check — compare each client-sent line price against the
  // admin-set price where one authoritatively exists (per-dose variant price,
  // else the per-sku override). FLAG, don't block: payment is verified
  // manually against the invoice, so the operator gets a loud warning in the
  // business email + an order_events entry instead of a hard reject. Lines
  // with no admin-set price (formula-priced catalog) are skipped.
  const priceMismatches: PriceMismatch[] = [];
  {
    const skus = [...new Set(items.map((i) => i.product.sku).filter((s): s is string => !!s))];
    if (skus.length > 0) {
      const [variantRes, stockRes] = await Promise.all([
        supabase.from("product_variant_stock")
          .select("sku, dose, price_cents").in("sku", skus).not("price_cents", "is", null),
        supabase.from("product_stock")
          .select("sku, price_cents_override").in("sku", skus).not("price_cents_override", "is", null),
      ]);
      const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      const variantsBySku = new Map<string, Array<{ dose: string; price_cents: number }>>();
      for (const v of variantRes.data ?? []) {
        const list = variantsBySku.get(v.sku) ?? [];
        list.push({ dose: v.dose, price_cents: v.price_cents });
        variantsBySku.set(v.sku, list);
      }
      const overrideBySku = new Map<string, number>(
        (stockRes.data ?? []).map((r) => [r.sku, r.price_cents_override]),
      );
      for (const item of items) {
        const sku = item.product.sku;
        if (!sku) continue;
        const haystack = squash(`${item.product.name} ${item.note ?? ""}`);
        const doseMatches = (variantsBySku.get(sku) ?? [])
          .filter((v) => v.dose && haystack.includes(squash(v.dose)));
        let serverCents: number | null = null;
        if (doseMatches.length === 1) serverCents = doseMatches[0].price_cents;
        else if (doseMatches.length === 0 && overrideBySku.has(sku)) serverCents = overrideBySku.get(sku)!;
        if (serverCents == null) continue; // no authoritative price — can't verify
        const clientCents = clampCents(item.unitPriceCents);
        if (clientCents !== serverCents) {
          priceMismatches.push({ sku, name: item.product.name, clientCents, serverCents });
        }
      }
      if (priceMismatches.length > 0) {
        console.error("PRICE MISMATCH on checkout:", JSON.stringify(priceMismatches));
      }
    }
  }

  // Rate limit (shared with inquiries by contact)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("inquiries").select("*", { count: "exact", head: true })
    .eq("contact", contact).gte("created_at", oneHourAgo);
  if ((recentCount ?? 0) >= 5) {
    return jsonResponse({ error: "Too many orders from this contact. Please wait before trying again." }, 429);
  }

  // Ownership stamping (portal blueprint §2.1) — STRICTLY ADDITIVE. If the
  // request carries a customer session JWT (supabase-js sends the session
  // token as the Authorization bearer when signed in; the anon key otherwise),
  // resolve it and stamp orders.user_id ONLY when the verified auth email
  // equals the buyer contact (case-insensitive). Any failure — guest, anon-key
  // bearer, bogus/expired token, email mismatch — proceeds exactly as today.
  let stampedUserId: string | null = null;
  {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearer && SUPABASE_ANON_KEY && bearer !== SUPABASE_ANON_KEY && contactIsEmail) {
      try {
        const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await authClient.auth.getUser(bearer);
        const authedEmail = (userData?.user?.email ?? "").trim().toLowerCase();
        if (!userErr && userData?.user && authedEmail && authedEmail === contact.toLowerCase()) {
          stampedUserId = userData.user.id;
          console.log("Checkout ownership stamped for user", stampedUserId);
        }
      } catch {
        /* unresolved session → guest semantics, no log spam */
      }
    }
  }

  // Account discount entitlement (migration 045) — resolved SERVER-SIDE only,
  // and only for a stamped owner. The RPC is service-role-only by design; an
  // error or {found:false} means zero behavior change.
  let accountDiscount: { code: string; scope: string; percent: number; label: string } | null = null;
  if (stampedUserId) {
    const { data: acctData, error: acctErr } = await supabase.rpc("effective_customer_discount", {
      p_user_id: stampedUserId,
    });
    if (!acctErr) {
      const acct = (acctData ?? null) as AccountDiscountRpc | null;
      const pct = Number(acct?.percent);
      if (
        acct?.found === true &&
        Number.isFinite(pct) && pct > 0 && pct <= 100 &&
        (acct.scope === "lifetime" || acct.scope === "business")
      ) {
        accountDiscount = {
          code: acct.scope === "business" ? "ACCT-BUSINESS" : "ACCT-LIFETIME",
          scope: acct.scope,
          percent: pct,
          label: (acct.label ?? "").trim() ||
            (acct.scope === "business" ? "Business discount" : "Lifetime discount"),
        };
      }
    } else {
      console.error("effective_customer_discount failed (order proceeds without it):", acctErr);
    }
  }

  // Member free-shipping perk (migration 049) — for the invoice email's
  // affirmative "Free — member" shipping line. The perk is enforced on the
  // billed total server-side by recompute_order_totals when the admin sends the
  // invoice; here it only drives the email label for a stamped owner.
  let memberFreeShipping = false;
  if (stampedUserId) {
    const { data: profRow } = await supabase
      .from("customer_profiles")
      .select("free_shipping")
      .eq("user_id", stampedUserId)
      .maybeSingle();
    memberFreeShipping = profRow?.free_shipping === true;
  }

  // Reward redemption voucher (migration 050) — a stamped owner may hold ONE
  // active "40% off one item" voucher. Applied below as a flat reduction equal
  // to 40% of the highest single unit price, then marked used. The −300 points
  // were already spent at redeem time.
  let rewardVoucher: { id: string; percent: number } | null = null;
  if (stampedUserId) {
    const { data: vRow } = await supabase
      .from("reward_vouchers")
      .select("id, percent")
      .eq("user_id", stampedUserId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (vRow && Number.isFinite(Number(vRow.percent))) {
      rewardVoucher = { id: vRow.id as string, percent: Number(vRow.percent) };
    }
  }

  // Coupon — the client sends only the CODE; the server validates it and
  // computes the money. percent/fixed reduce the billed total; free_item
  // appends a $0 line for the free product. Invalid codes reject the order
  // (the buyer saw it "applied" in the cart, so silently dropping it would
  // bill more than they expect).
  // Accept one OR many codes (coupon_codes supersedes the legacy coupon_code).
  // Normalize, dedupe, and cap the count so a payload can't spam validation.
  const rawCodes = Array.isArray(payload.coupon_codes)
    ? payload.coupon_codes
    : (payload.coupon_code ? [payload.coupon_code] : []);
  const couponCodes = [...new Set(
    rawCodes
      .map((c) => String(c ?? "").trim().toUpperCase().slice(0, 40))
      .filter((c) => c.length > 0),
  )].slice(0, 10);

  // Per-code ledger — drives redemption + per-code rollback below. `fullDiscount`
  // holds a percent code's discount off the FULL subtotal; pass 2 re-scales it
  // onto the post-flat base so percents apply AFTER free_item/fixed reductions.
  // percent/amountCents/freeLabel are display snapshots for the itemized
  // invoice email (same fields send-order-invoice reads from order_coupons).
  // `freeSku` marks a server-APPENDED $0 line (rollback removes it);
  // `srcFreeSku`/`freeDose` snapshot the coupon's own free_sku/free_dose for
  // the order_coupons row regardless of whether a line was appended or an
  // existing unit was freed.
  const appliedList: {
    code: string; kind: string; contribution: number; freeSku: string | null; fullDiscount: number;
    percent: number | null; amountCents: number | null; freeLabel: string | null;
    srcFreeSku: string | null; freeDose: string | null;
  }[] = [];
  let flatCents = 0; // free_item line values + fixed amounts (reduce the base first)

  // Pass 1 — validate every code; apply the flat reductions now.
  for (const code of couponCodes) {
    const { data: checkData, error: checkErr } = await supabase.rpc("validate_coupon", {
      p_code: code,
      p_subtotal_cents: grossSubtotalCents,
      p_contact: contact,
    });
    if (checkErr) {
      console.error("validate_coupon failed:", checkErr);
      return jsonResponse({ error: "Could not verify the promo code. Please try again." }, 502);
    }
    const coupon = checkData as CouponCheck | null;
    if (!coupon?.valid) {
      // The buyer saw it "applied" in the cart, so silently dropping it would
      // bill more than they expect — reject and let them fix the code.
      return jsonResponse({ error: coupon?.reason ?? `Code ${code} is not valid.` }, 400);
    }
    // Member-gated code (migration 048): authoritative check. validate_coupon
    // can't judge account state (place-order calls it with the service role, so
    // auth.uid() is null there) — the trustworthy signal is stampedUserId, set
    // only when a verified account session matched the buyer email above.
    if (coupon.requires_account === true && !stampedUserId) {
      return jsonResponse({
        error: `Code ${coupon.code ?? code} is for members only. Sign in to your account and try again.`,
      }, 400);
    }
    const appliedCode = coupon.code ?? code;

    if (coupon.kind === "percent") {
      const full = Math.max(Math.floor(Number(coupon.discount_cents ?? 0)), 0);
      appliedList.push({
        code: appliedCode, kind: "percent", contribution: 0, freeSku: null, fullDiscount: full,
        percent: coupon.percent ?? null, amountCents: null, freeLabel: null,
        srcFreeSku: null, freeDose: null,
      });
      continue; // handled in pass 2
    }

    if (coupon.kind === "free_item" && coupon.free_sku && coupon.free_label) {
      // If the buyer already has this item, make ONE unit free (discount = its
      // price) instead of adding a duplicate free line.
      const matchIdx = items.findIndex((i) =>
        (i.product.sku ?? i.product.id) === coupon.free_sku &&
        clampCents(i.unitPriceCents) > 0 &&
        (!coupon.free_dose || (i.product.name ?? "").includes(coupon.free_dose))
      );
      if (matchIdx >= 0) {
        const unit = clampCents(items[matchIdx].unitPriceCents);
        const contribution = Math.max(Math.min(unit, grossSubtotalCents - flatCents), 0);
        flatCents += contribution;
        appliedList.push({
          code: appliedCode, kind: "free_item", contribution, freeSku: null, fullDiscount: 0,
          percent: null, amountCents: null, freeLabel: coupon.free_label ?? null,
          srcFreeSku: coupon.free_sku ?? null, freeDose: coupon.free_dose ?? null,
        });
      } else {
        items.push({
          product: { id: `free-${coupon.free_sku}`, name: `${coupon.free_label} (FREE)`, category: null, sku: coupon.free_sku },
          quantity: 1,
          unitPriceCents: 0,
          note: `Free with code ${appliedCode}`,
        });
        itemCount += 1;
        appliedList.push({
          code: appliedCode, kind: "free_item", contribution: 0, freeSku: coupon.free_sku, fullDiscount: 0,
          percent: null, amountCents: null, freeLabel: coupon.free_label ?? null,
          srcFreeSku: coupon.free_sku ?? null, freeDose: coupon.free_dose ?? null,
        });
      }
    } else {
      // fixed — flat dollars off, capped at the remaining subtotal.
      const raw = Math.floor(Number(coupon.discount_cents ?? 0));
      const safe = Math.max(Number.isFinite(raw) ? raw : 0, 0);
      const contribution = Math.max(Math.min(safe, grossSubtotalCents - flatCents), 0);
      flatCents += contribution;
      appliedList.push({
        code: appliedCode, kind: "fixed", contribution, freeSku: null, fullDiscount: 0,
        percent: null, amountCents: coupon.amount_cents ?? null, freeLabel: null,
        srcFreeSku: null, freeDose: null,
      });
    }
  }

  // Reward voucher (migration 050) — a FLAT reduction of `percent`% of the
  // single highest unit price in the cart ("40% off one item"), applied like a
  // fixed coupon (reduces the base before percents), capped at the remaining
  // subtotal. Materialized as a synthetic order_coupons row below.
  let rewardReduction = 0;
  if (rewardVoucher) {
    const maxUnit = items.reduce((m, i) => Math.max(m, clampCents(i.unitPriceCents)), 0);
    const raw = Math.round((maxUnit * rewardVoucher.percent) / 100);
    rewardReduction = Math.max(Math.min(raw, grossSubtotalCents - flatCents), 0);
    flatCents += rewardReduction;
  }

  // Pass 2 — percents apply to the base AFTER the flat reductions. A percent's
  // discount off the full subtotal, scaled by (baseAfterFlat / subtotal), equals
  // `percent × baseAfterFlat`.
  const baseAfterFlat = Math.max(grossSubtotalCents - flatCents, 0);
  let percentUsed = 0;

  // Pass 2a — the ACCOUNT discount applies first on the same post-flat base;
  // code percents (pass 2b below) keep computing off that same base but their
  // running cap now starts after the account slice. This mirrors
  // recompute_order_totals (045): account rows first, same base per percent
  // row, cap = base − used.
  let accountCents = 0;
  if (accountDiscount) {
    accountCents = Math.max(
      Math.min(Math.round((baseAfterFlat * accountDiscount.percent) / 100), baseAfterFlat),
      0,
    );
    percentUsed += accountCents;
  }

  for (const a of appliedList) {
    if (a.kind !== "percent") continue;
    const scaled = grossSubtotalCents > 0
      ? Math.round((a.fullDiscount * baseAfterFlat) / grossSubtotalCents)
      : 0;
    a.contribution = Math.max(Math.min(scaled, baseAfterFlat - percentUsed), 0);
    percentUsed += a.contribution;
  }

  let discountCents = Math.min(flatCents + percentUsed, grossSubtotalCents);
  const REWARD_CODE = "REWARD";
  // Comma-joined label for the order row, invoice, and emails (all read this).
  // The synthetic account/reward codes lead, matching the order_coupons rows.
  let appliedCoupon: string | null = (accountDiscount || rewardReduction > 0 || appliedList.length)
    ? [
        ...(accountDiscount ? [accountDiscount.code] : []),
        ...(rewardReduction > 0 ? [REWARD_CODE] : []),
        ...appliedList.map((a) => a.code),
      ].join(", ")
    : null;
  let totalCents = grossSubtotalCents - discountCents;

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
      subtotal_cents:       grossSubtotalCents,
      shipping_cents:       null,
      discount_cents:       discountCents,
      coupon_code:          appliedCoupon,
      invoice_amount_cents: totalCents,
      payment_method:       `Zelle (${ZELLE_HANDLE})`,
      invoiced_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      // Ownership stamp — only present for a verified-email session match;
      // guests get the exact insert payload this function has always sent.
      ...(stampedUserId ? { user_id: stampedUserId } : {}),
    })
    .select("id, order_number, created_at").single();
  if (ordErr || !orderRow) {
    // Unique violation on the idempotency index = a concurrent retry already
    // created this order — return the existing one instead of failing.
    if (idempotencyKey && (ordErr as { code?: string } | null)?.code === "23505") {
      const { data: raced } = await supabase
        .from("orders")
        .select("order_number, created_at, invoice_amount_cents")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced) {
        return jsonResponse({
          success: true,
          duplicate: true,
          orderNumber: raced.order_number,
          referenceId,
          createdAt: raced.created_at,
          amountCents: raced.invoice_amount_cents ?? 0,
          invoiceEmailSent: contactIsEmail,
          contactIsEmail,
        });
      }
    }
    console.error("Order insert failed:", ordErr);
    // Inquiry is recorded; surface a soft failure so the buyer can be followed up.
    return jsonResponse({ error: "Order could not be created. Our team has your request and will follow up.", referenceId }, 502);
  }

  const { error: linesErr } = await supabase.from("order_lines").insert(items.map((i) => ({
    order_id: orderRow.id, sku: i.product.sku ?? i.product.id, product_name: i.product.name,
    quantity: clampQty(i.quantity), unit_price_cents: clampCents(i.unitPriceCents),
    item_note: i.note ?? null,
    // Snapshot ship speed so admin invoice re-sends carry the same FAST/standard
    // badge the order-time invoice shows (column added in migration 023).
    fast_ship: typeof i.fast === "boolean" ? i.fast : null,
  })));
  if (linesErr) console.error("Order lines insert failed:", linesErr);

  // Durable record of a price mismatch — lands on the admin order timeline
  // (order_events is admin-read-only, so the buyer never sees it).
  if (priceMismatches.length > 0) {
    const mismatchNote = priceMismatches
      .map((m) => `${m.sku}: billed ${usd(m.clientCents)}, catalog ${usd(m.serverCents)}`)
      .join("; ");
    const { error: evErr } = await supabase.from("order_events").insert({
      order_id: orderRow.id,
      stage: null,
      kind: "system",
      note: `⚠ Price mismatch on checkout — ${mismatchNote}. Verify the invoice amount before marking paid.`,
    });
    if (evErr) console.error("Price-mismatch event insert failed:", evErr);
  }

  // Materialize the account discount as a synthetic order_coupons row
  // (migration 045, source='account') so every invoice surface and the admin
  // recompute treat it exactly like a code — but with NO coupon_redemptions
  // row, NO redeem_coupon call, and NO affiliate involvement.
  if (accountDiscount) {
    const { error: acctRowErr } = await supabase.from("order_coupons").insert({
      order_id: orderRow.id,
      code: accountDiscount.code,
      kind: "percent",
      percent: accountDiscount.percent,
      discount_cents: accountCents,
      source: "account",
    });
    if (acctRowErr) console.error("Account-discount order_coupons insert failed:", acctRowErr);
  }

  // Materialize the reward voucher as a synthetic 'fixed' order_coupons row
  // (migration 050, source='reward') and mark the voucher used. The status
  // filter on the update makes double-consumption a no-op if this order raced.
  if (rewardVoucher && rewardReduction > 0) {
    const { error: rewardRowErr } = await supabase.from("order_coupons").insert({
      order_id: orderRow.id,
      code: REWARD_CODE,
      kind: "fixed",
      amount_cents: rewardReduction,
      free_label: `${rewardVoucher.percent}% off one item`,
      discount_cents: rewardReduction,
      source: "reward",
    });
    if (rewardRowErr) console.error("Reward order_coupons insert failed:", rewardRowErr);

    const { error: voucherErr } = await supabase.from("reward_vouchers")
      .update({ status: "used", used_at: new Date().toISOString(), order_id: orderRow.id })
      .eq("id", rewardVoucher.id)
      .eq("status", "active");
    if (voucherErr) console.error("Reward voucher consume failed:", voucherErr);
  }

  // Record the redemption + commission ledger row (service-role-only RPC;
  // atomically re-checks limits and bumps used_count). If it fails — e.g. two
  // concurrent checkouts raced for the last use of a capped code — ROLL THE
  // COUPON BACK off the order before any email goes out, so the invoice and
  // billed amount stay truthful and a raced-out code can't leak revenue.
  let redeemedList = appliedList; // codes that survive redemption (email itemization)
  if (appliedList.length > 0) {
    const failedCodes: string[] = [];
    for (const a of appliedList) {
      const { data: redeemData, error: redeemErr } = await supabase.rpc("redeem_coupon", {
        p_code: a.code,
        p_order_id: orderRow.id,
        p_contact: contact,
        p_discount_cents: a.contribution,
        p_order_net_cents: totalCents,
      });
      const redeemed = redeemData as { ok?: boolean; reason?: string } | null;
      if (redeemErr || !redeemed?.ok) {
        console.error("Coupon redemption failed — rolling back:", redeemErr ?? redeemed?.reason, a.code, orderRow.id);
        failedCodes.push(a.code);
        discountCents -= a.contribution;
        // Drop the server-added free line (DB + the in-memory items the emails render).
        if (a.freeSku) {
          await supabase.from("order_lines").delete()
            .eq("order_id", orderRow.id).eq("sku", a.freeSku).eq("unit_price_cents", 0);
          const freeIdx = items.findIndex((i) => i.product.id === `free-${a.freeSku}`);
          if (freeIdx >= 0) items.splice(freeIdx, 1);
        }
      }
    }
    // Re-price the order keeping only the coupons that redeemed successfully.
    if (failedCodes.length > 0) {
      discountCents = Math.max(discountCents, 0);
      totalCents = grossSubtotalCents - discountCents;
      const survivors = appliedList.filter((a) => !failedCodes.includes(a.code));
      redeemedList = survivors;
      const survivorCodes = [
        ...(accountDiscount ? [accountDiscount.code] : []),
        ...survivors.map((a) => a.code),
      ];
      appliedCoupon = survivorCodes.length ? survivorCodes.join(", ") : null;
      const { error: rollbackErr } = await supabase.from("orders")
        .update({ discount_cents: discountCents, coupon_code: appliedCoupon, invoice_amount_cents: totalCents })
        .eq("id", orderRow.id);
      if (rollbackErr) console.error("Coupon rollback update failed:", rollbackErr, orderRow.id);
    }
  }

  // Materialize the SURVIVING code coupons as order_coupons rows too
  // (source='code'), mirroring the account row above. Without these, /track,
  // the portal's get_my_order, and the admin printable itemize nothing for
  // checkout coupon orders — and an admin line-edit (save_order_lines →
  // recompute_order_totals) would silently wipe the code discount because the
  // recompute reads only order_coupons. discount_cents snapshots this
  // checkout's per-code result; recompute may re-derive it (±1¢ on percent
  // rows, by design). Non-fatal on error: the order and email stay truthful.
  if (redeemedList.length > 0) {
    const { error: codeRowsErr } = await supabase.from("order_coupons").insert(
      redeemedList.map((a) => ({
        order_id: orderRow.id,
        code: a.code,
        kind: a.kind,
        percent: a.percent,
        amount_cents: a.amountCents,
        free_sku: a.srcFreeSku,
        free_dose: a.freeDose,
        free_label: a.freeLabel,
        discount_cents: a.contribution,
        source: "code",
      })),
    );
    if (codeRowsErr) console.error("Code-coupon order_coupons insert failed:", codeRowsErr, orderRow.id);
  }

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
                 discount_cents, coupon_code,
                 payment_method, status, notes,
                 ship_street, ship_city, ship_state, ship_zip, ship_country, created_at, lookup_token`)
        .eq("id", orderRow.id)
        .single();
      if (invOrder) {
        // Build the invoice lines from the in-memory payload (not a DB re-read)
        // so the per-line FAST/standard ship badge is included — order_lines
        // doesn't snapshot ship speed.
        const invLines: OrderLine[] = items.map((i) => ({
          sku: i.product.sku ?? i.product.id,
          product_name: i.product.name,
          quantity: clampQty(i.quantity),
          unit_price_cents: clampCents(i.unitPriceCents),
          item_note: i.note ?? null,
          fast_ship: typeof i.fast === "boolean" ? i.fast : null,
        }));
        // Itemized discount rows — surviving code rows + the account row, the
        // same shape send-order-invoice reads back from order_coupons. Without
        // this the checkout invoice showed only a lumped discount (drift fix).
        const invCoupons: CouponLine[] = [
          ...(accountDiscount ? [{
            code: accountDiscount.code,
            kind: "percent",
            free_label: accountDiscount.label,
            percent: accountDiscount.percent,
            amount_cents: null,
            discount_cents: accountCents,
          }] : []),
          ...(rewardVoucher && rewardReduction > 0 ? [{
            code: REWARD_CODE,
            kind: "fixed",
            free_label: `${rewardVoucher.percent}% off one item`,
            percent: null,
            amount_cents: rewardReduction,
            discount_cents: rewardReduction,
          }] : []),
          ...redeemedList.map((a) => ({
            code: a.code,
            kind: a.kind,
            free_label: a.freeLabel,
            percent: a.percent,
            amount_cents: a.amountCents,
            discount_cents: a.contribution,
          })),
        ];
        const invRes = await sendResendEmail({
          to: contact,
          subject: invoiceSubject(invOrder),
          html: buildInvoiceHtml({ order: invOrder as OrderRow, lines: invLines, coupons: invCoupons, memberFreeShipping }),
          text: buildInvoiceText({ order: invOrder as OrderRow, lines: invLines, coupons: invCoupons, memberFreeShipping }),
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
  const bizText = [
    `New order ${orderNumber} — ${name} (${usd(totalCents)})`,
    `Contact: ${contact}`,
    ``,
    ...items.map((i) => `  - ${i.product.name}${i.fast === true ? " [24 HR]" : i.fast === false ? " [STANDARD]" : ""} · qty ${clampQty(i.quantity)} · ${usd(clampCents(i.unitPriceCents))} ea`),
    ``,
    ...(appliedCoupon ? [
      `Subtotal: ${usd(grossSubtotalCents)}`,
      `Code ${appliedCoupon}: ${discountCents > 0 ? "-" + usd(discountCents) : "free item added"}`,
    ] : []),
    `Total: ${usd(totalCents)}`,
    ...(priceMismatches.length > 0 ? [
      ``,
      `!! PRICE MISMATCH — verify before marking paid:`,
      ...priceMismatches.map((m) => `  ${m.sku}: billed ${usd(m.clientCents)}, catalog ${usd(m.serverCents)}`),
    ] : []),
    `Watch ${ZELLE_HANDLE} for a payment with note ${paymentCode(orderNumber)}.`,
    `Mark paid in Admin → Orders once confirmed.`,
  ].join("\n");
  const biz = await sendResendEmail({
    to: BUSINESS_EMAIL,
    subject: `${priceMismatches.length > 0 ? "⚠ " : ""}New order ${orderNumber} — ${name} (${usd(totalCents)})`,
    html: buildBusinessEmailHtml(
      cleanPayload, orderNumber, referenceId, totalCents,
      appliedCoupon ? { code: appliedCoupon, discountCents } : undefined,
      priceMismatches,
    ),
    text: bizText,
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
