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
import { alertOperator, logEvent, withTelemetry } from "../_shared/telemetry.ts";
import {
  isQueryableSku,
  priceFailureMessage,
  verifyLinePrices,
  type UnverifiedLine,
} from "./priceCheck.ts";
import {
  B2G1_GROUP,
  buildPromoPlans,
  type B2G1PlanEntry,
  type WholesalePlanEntry,
} from "./promoPlan.ts";
import { buildBundlePlan, bundleLineKey } from "./bundlePlan.ts";
import { claimRewardVoucher, rollbackRewardPricing } from "./rewardVoucher.ts";
import { UUID_REGEX, escapeHtml, clampQty, clampCents, usd } from "./orderFormat.ts";
import { generateReferenceId, generateOrderNumber } from "./orderIdentifiers.ts";
import {
  validateOrderPayload,
  type OrderItemPayload,
  type OrderPayload,
} from "./orderPayload.ts";
import { shippingCentsFor } from "./orderShipping.ts";
import {
  buildAppliedCouponLabel,
  computeOrderTotals,
  flatContribution,
  normalizeCouponCodes,
  repriceAfterFailedRedemptions,
  sanitizeFixedDiscountCents,
} from "./orderTotals.ts";

const TELEMETRY_FN = "place-order";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// OrderItemPayload / OrderPayload live in orderPayload.ts (imported above)
// alongside validateOrderPayload, the boundary that produces them.

/** The standing bundle offer: any Retatrutide + any GHK-Cu, 20% off each
 *  complete pair, applied automatically. FINAL price — nothing stacks on it
 *  (owner rule), and wholesale outranks it. This is the authoritative copy;
 *  keep it in sync with BUNDLE_PROMO in src/lib/bundle.ts (display mirror). */
const BUNDLE_PROMO = {
  code: "BUNDLE",
  label: "Retatrutide + GHK-Cu bundle",
  skuA: "VSR-RS-RTT-005",
  skuB: "VSR-RS-GHK",
  percent: 20,
} as const;

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
const BRAND_STAMP_URL      = Deno.env.get("BRAND_STAMP_URL") ?? "";

const CORS_HEADERS = buildCorsHeaders();

const INTAKE_CHANNEL  = "VSR-WEB-PORTAL";
const PROCESSING_NODE = "VSR-HQ-INTAKE";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
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

/** Mismatching prices no longer reach an invoice — they refuse the order
 *  (priceCheck.ts, P0-1). What survives is the one case the server genuinely
 *  cannot verify: a real catalog dose carrying no admin price, which the client
 *  formula-prices. Those still ship, so the operator is told which lines were
 *  taken on trust. Import a price for the dose and this notice disappears. */
function unverifiedPriceNoticeHtml(unverified: UnverifiedLine[]): string {
  if (unverified.length === 0) return "";
  const rows = unverified.map((u) =>
    `<div style="font-family:monospace;font-size:12px;margin-top:4px;">${escapeHtml(u.sku)} — billed <strong>${usd(u.clientCents)}</strong>, catalog has <strong>no admin price for this dose</strong></div>`,
  ).join("");
  return `<div style="border:1px solid rgba(196,64,64,0.5);background:rgba(196,64,64,0.08);border-radius:8px;padding:12px 16px;margin:14px 0;color:#1A1714;font-size:13px;">
    <strong style="display:block;margin-bottom:3px;color:#A03232;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">⚠ Unverified price — confirm before marking paid</strong>
    Every other line matched the catalog exactly. These doses have no admin-set price, so the price came from the cart and could not be checked. Set a price for the dose to close this.${rows}
  </div>`;
}

function buildBusinessEmailHtml(
  payload: OrderPayload, orderNumber: string, referenceId: string, totalCents: number,
  promo?: { code: string; discountCents: number },
  unverified: UnverifiedLine[] = [],
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
      ${unverifiedPriceNoticeHtml(unverified)}
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

const handleOrder = async (req: Request): Promise<Response> => {
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

  // Boundary validation + normalization — the whole trim/guard/item loop lives
  // in orderPayload.ts (pure, unit-tested); an { ok: false } result carries the
  // exact error message + status the inline checks always returned.
  const validated = validateOrderPayload(payload);
  if (!validated.ok) return jsonResponse({ error: validated.error }, validated.status);
  const {
    name, contact, organization, notes,
    shipStreet, shipCity, shipState, shipZip, shipCountry,
    attestation, items, grossSubtotalCents, contactIsEmail, cleanPayload,
  } = validated.value;
  let itemCount = validated.value.itemCount;

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

  // Server price authority (P0-1) — every client-sent line price is verified
  // against the admin-set price and the order is REFUSED on any discrepancy.
  //
  // FAIL CLOSED, not flag-only. Payment is manual (Zelle) and settles against
  // the invoice this function creates, so a flag is only as good as an operator
  // noticing a number before releasing goods. Refusing to create the order is
  // the only control that actually holds. See priceCheck.ts for the resolution
  // rules and the one documented gap (formula-priced doses, allowed + recorded).
  //
  // Runs on the raw client lines — server-generated free promo lines are
  // appended later, after this gate.
  const unverifiedLines: UnverifiedLine[] = [];
  {
    const checkLines = items.map((i) => ({
      sku: i.product.sku,
      name: i.product.name,
      unitPriceCents: clampCents(i.unitPriceCents),
    }));
    // Only well-formed SKUs go into the .in() filter (see priceCheck.SKU_RE).
    // A malformed one is not dropped from the CHECK — verifyLinePrices rejects
    // it — it's just kept out of the query it could malform.
    const checkSkus = [...new Set(
      items.map((i) => i.product.sku).filter(isQueryableSku),
    )];
    const [variantRes, overrideRes] = checkSkus.length > 0
      ? await Promise.all([
        supabase.from("product_variant_stock")
          .select("sku, dose, price_cents").in("sku", checkSkus),
        supabase.from("product_stock")
          .select("sku, price_cents_override").in("sku", checkSkus),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];

    // A read failure means the catalog price is UNKNOWN, not "matched". Under
    // fail-closed that must refuse the order: the old fail-open kept checkout up
    // at the cost of billing whatever the client claimed, and a partial failure
    // (variants error, overrides fine) is the worst case — every priced line
    // would silently resolve to "no rows → unknown". Refuse and let the buyer
    // retry; the same database has to be up to create the order anyway.
    if (variantRes.error || overrideRes.error) {
      console.error(
        `Price check read failed — order refused. variants=${variantRes.error?.message ?? "ok"} overrides=${overrideRes.error?.message ?? "ok"}`,
      );
      return jsonResponse({
        error: "We couldn't verify catalog prices just now. Please try again in a moment.",
      }, 503);
    }

    const verdict = verifyLinePrices(checkLines, variantRes.data ?? [], overrideRes.data ?? []);
    if (!verdict.ok) {
      console.error(
        `Price verification FAILED — order refused (${verdict.failures.length} line(s)): ` +
        verdict.failures.map((f) =>
          `${f.sku || "(no sku)"} [${f.reason}] billed ${f.clientCents}¢ vs catalog ${f.serverCents == null ? "n/a" : f.serverCents + "¢"}`,
        ).join("; "),
      );
      return jsonResponse({ error: priceFailureMessage(verdict.failures) }, 409);
    }
    unverifiedLines.push(...verdict.unverified);
    if (unverifiedLines.length > 0) {
      console.warn(
        `Price check could not verify ${unverifiedLines.length} formula-priced line(s): ` +
        unverifiedLines.map((u) => `${u.sku} at ${u.clientCents}¢`).join("; "),
      );
    }
  }
  // Server-verified slow-ship (7–10 day) lines — B2G1 promo candidates. A
  // line qualifies only when its matched dose variant has NO shelf or inbound
  // stock and a lead_days SLA (the exact condition that renders the 7–10-day
  // chip),

  // Rate limit (shared with inquiries by contact). Case-insensitive on
  // purpose: an exact .eq() let Foo@x.com / foo@x.com / FOO@x.com each open a
  // fresh bucket, so the throttle could be bypassed by re-casing the contact.
  // ilike with LIKE-metacharacters escaped is a case-folded equality match.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const contactBucket = contact.replace(/([\\%_])/g, "\\$1");
  const { count: recentCount } = await supabase
    .from("inquiries").select("*", { count: "exact", head: true })
    .ilike("contact", contactBucket).gte("created_at", oneHourAgo);
  if ((recentCount ?? 0) >= 5) {
    return jsonResponse({ error: "Too many orders from this contact. Please wait before trying again." }, 429);
  }

  // Ownership + membership (P0-5) — resolved from the VERIFIED session alone.
  //
  // This used to additionally require contactIsEmail && authedEmail === contact,
  // so a signed-in member who typed any other address — or a phone number, which
  // the field explicitly invites ("Email or Phone *") — was silently billed as a
  // guest: +$9.99 shipping, no account discount, no reward voucher, and their
  // wholesale plan dropped. On the review's worked example that was +$249.99
  // (+69.4%) over the advertised price, and NO price check can ever catch it:
  // the client sends honest per-unit retail prices, and every one of those perks
  // is a discount or a shipping line, not a unit price. Only the total is wrong.
  //
  // The bearer is a real GoTrue round-trip (auth.getUser), so it proves account
  // identity by itself; `contact` proves nothing — it is a delivery/notification
  // address the buyer types, not an identity claim. Treat it as one.
  //
  // Any failure — guest, anon-key bearer, bogus/expired token — is guest
  // semantics exactly as before.
  let stampedUserId: string | null = null;
  {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearer && SUPABASE_ANON_KEY && bearer !== SUPABASE_ANON_KEY) {
      try {
        const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await authClient.auth.getUser(bearer);
        if (!userErr && userData?.user) {
          stampedUserId = userData.user.id;
          const authedEmail = (userData.user.email ?? "").trim().toLowerCase();
          if (contactIsEmail && authedEmail && authedEmail !== contact.toLowerCase()) {
            // Not an error — the buyer may ship/notify anywhere they like. Worth
            // a line in the log because it used to silently change the price.
            console.log(
              `Checkout contact differs from the account email for user ${stampedUserId} — member pricing still applies.`,
            );
          }
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

  // Shipping (owner's rule) — EVERY signed-in member ships free; guests pay one
  // flat fee. This is the authority: the charge is derived from the VERIFIED
  // session (stampedUserId), never from anything the client sends, so a guest
  // can't waive their own shipping. The rule lives in orderShipping.ts (pure,
  // unit-tested); keep its GUEST_SHIPPING_CENTS in sync with src/lib/shipping.ts.
  //
  // Membership alone is now sufficient — this replaces the old per-customer
  // customer_profiles.free_shipping lookup (migration 049), which required an
  // admin to flip a switch and so never honored the member gate's advertised
  // "ships free, no minimums, no codes". That column still forces $0 inside
  // recompute_order_totals, so it survives as an admin override for guests.
  const memberFreeShipping = !!stampedUserId;
  const shippingCents = shippingCentsFor(memberFreeShipping);

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
  const couponCodes = normalizeCouponCodes(rawCodes);

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

  // Precompute the automatic promos BEFORE validating codes, so the
  // combinability gate can tell whether an automatic promo is active for a
  // code that opts out of promos. Two standing rules share one catalog lookup
  // (one query, no divergence):
  //   • WHOLESALE — pack pricing, always on (the owner's standing business
  //     offer): full cases of 10 at 40% off, plus one half kit of 5 at 27% off
  //     from the remainder (e.g. qty 15 = one case + one half kit). Ship speed
  //     does NOT gate it — a case is sourced whole (mirrors wholesaleDoses).
  //     WHICH doses may be sold by the case is a SERVER fact
  //     (product_variant_stock.wholesale_eligible, migration 063), not the
  //     `category` the payload claims.
  //   • B2G1     — qty ≥ 3 slow-ship → 1 free per 3, when the admin promo is
  //     live.
  // The two must never stack on one line: whichever is worth MORE to the buyer
  // claims it (qty 6 under live B2G1 → 2 free ≈ 33% beats the 27% half kit;
  // qty 10 → 40% case beats 3 free ≈ 30%).
  //
  // The rules themselves live in promoPlan.ts — pure, unit-tested, and sharing
  // the price check's dose resolver so the row that PRICED a line is the row
  // that decides its promos. Reductions are applied in the flat pass below,
  // consuming these plans. idx points into `items` — free_item appends happen
  // later at the tail, so captured indices stay valid.
  let b2g1FreePlan: B2G1PlanEntry[] = [];
  let wholesalePlan: WholesalePlanEntry[] = [];
  {
    const { data: promo } = await supabase
      .from("promo_settings")
      .select("b2g1_enabled, b2g1_ends_at, b2g1_excluded_skus")
      .eq("id", 1)
      .maybeSingle();
    const promoLive = !!promo?.b2g1_enabled &&
      (promo?.b2g1_ends_at == null || Date.parse(promo.b2g1_ends_at) > Date.now());
    const excludedSkus = new Set<string>((promo?.b2g1_excluded_skus ?? []) as string[]);
    // Any line that could reach either promo's floor (B2G1's group of 3 is the
    // lower of the two) needs its catalog row.
    const skus = [...new Set(
      items
        .filter((i) => clampQty(i.quantity) >= B2G1_GROUP)
        .map((i) => i.product.sku)
        .filter(isQueryableSku),
    )];
    if (skus.length > 0) {
      const { data: availRows, error: availErr } = await supabase
        .from("product_variant_stock")
        .select("sku, dose, on_hand, inbound_units, lead_days, price_cents, wholesale_eligible")
        .in("sku", skus);
      // A read failure means no promo data — fail closed to full retail rather
      // than guess. The buyer is never overcharged past the price they were
      // quoted; they just miss an automatic discount, and the log says why.
      if (availErr) {
        console.error(`Promo catalog read failed — order proceeds at retail:`, availErr);
      }
      const plans = buildPromoPlans({
        lines: items.map((i) => ({
          sku: i.product.sku,
          name: i.product.name,
          quantity: clampQty(i.quantity),
          unitPriceCents: clampCents(i.unitPriceCents),
        })),
        variantRows: availRows ?? [],
        promoLive,
        excludedSkus,
        isMember: !!stampedUserId,
      });
      wholesalePlan = plans.wholesalePlan;
      b2g1FreePlan = plans.b2g1FreePlan;
    }
  }
  // Bundle promo — 20% off every complete Retatrutide + GHK-Cu pair (any dose
  // of each). Computed here, BEFORE code validation, so the exclusivity gate
  // below and validate_coupon's combinability context both see it. Pair math
  // lives in bundlePlan.ts (pure, unit-tested); lines the price check only
  // allowed through as UNVERIFIED never form pairs — a near-zero fake line on
  // one bundle SKU must not manufacture 20% off a real line of the other.
  // Keep BUNDLE_PROMO in sync with src/lib/bundle.ts (the client display
  // mirror).
  const bundlePlan = buildBundlePlan({
    lines: items.map((i) => ({
      sku: i.product.sku ?? "",
      name: i.product.name,
      quantity: clampQty(i.quantity),
      unitPriceCents: clampCents(i.unitPriceCents),
    })),
    skuA: BUNDLE_PROMO.skuA,
    skuB: BUNDLE_PROMO.skuB,
    percent: BUNDLE_PROMO.percent,
    unverifiedKeys: new Set(unverifiedLines.map((u) => bundleLineKey(u.sku, u.name))),
  });

  // Wholesale is a FINAL price (owner's rule) — when it applies, nothing else
  // may discount the order: reject user-entered coupon codes and suppress the
  // automatic account discount, reward voucher, and B2G1. "Wholesale price and
  // that's it." B2G1 is already per-line exclusive with wholesale; this also
  // kills it on any other line of a wholesale order.
  //
  // (The ACCOUNT gate — only a verified signed-in owner buys at case pricing —
  // is applied inside buildPromoPlans, which is the only place that knows what
  // a dropped wholesale line should fall back to.)
  const hasWholesale = wholesalePlan.length > 0;
  if (hasWholesale) {
    // Actual wholesale lines are sourced as a case → never 24-hour, regardless
    // of the dose's retail stock or the client-sent flag.
    for (const p of wholesalePlan) {
      if (items[p.idx]) items[p.idx].fast = false;
    }
    if (couponCodes.length > 0) {
      return jsonResponse({
        error:
          "Wholesale pricing is final and can't be combined with promo codes. Remove the code (or the wholesale items) to check out.",
      }, 400);
    }
    accountDiscount = null;
    rewardVoucher = null;
    b2g1FreePlan.length = 0;
    // Wholesale outranks the bundle: it's the deeper standing offer (40% a
    // case) and its "nothing else applies" rule is absolute.
    bundlePlan.pairs = 0;
    bundlePlan.value = 0;
  }

  // The bundle is likewise a FINAL price (owner-confirmed): when it applies,
  // nothing else may discount the order — reject user-entered codes and
  // suppress the automatic account discount, reward voucher, and B2G1. Same
  // shape as the wholesale gate above, and unreachable when wholesale won.
  const hasBundle = bundlePlan.pairs > 0;
  if (hasBundle) {
    if (couponCodes.length > 0) {
      return jsonResponse({
        error:
          "Bundle pricing is final and can't be combined with promo codes. Remove the code (or one of the bundle items) to check out.",
      }, 400);
    }
    accountDiscount = null;
    rewardVoucher = null;
    b2g1FreePlan.length = 0;
  }

  // Combinability context — fixed BEFORE any code is admitted (order-independent).
  const willB2G1Apply = b2g1FreePlan.length > 0;
  const willWholesaleApply = wholesalePlan.length > 0;
  const hasReward = !!rewardVoucher;
  const hasAccount = !!accountDiscount;
  const admittedCodes: string[] = [];

  // Pass 1 — validate every code; apply the flat reductions now.
  for (const code of couponCodes) {
    const { data: checkData, error: checkErr } = await supabase.rpc("validate_coupon", {
      p_code: code,
      p_subtotal_cents: grossSubtotalCents,
      p_contact: contact,
      p_applied_codes: admittedCodes,
      p_has_reward: hasReward,
      p_has_promo: willB2G1Apply || willWholesaleApply,
      p_has_account: hasAccount,
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
    // Admitted → later codes are combinability-checked against it.
    admittedCodes.push(appliedCode);

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
        const contribution = flatContribution(unit, grossSubtotalCents, flatCents);
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
      const safe = sanitizeFixedDiscountCents(coupon.discount_cents);
      const contribution = flatContribution(safe, grossSubtotalCents, flatCents);
      flatCents += contribution;
      appliedList.push({
        code: appliedCode, kind: "fixed", contribution, freeSku: null, fullDiscount: 0,
        percent: null, amountCents: coupon.amount_cents ?? null, freeLabel: null,
        srcFreeSku: null, freeDose: null,
      });
    }
  }

  // The whole reduction engine — wholesale → bundle → B2G1 → reward (fenced)
  // → account percent (2a) → code percents (2b) → cap, then shipping on top —
  // lives in orderTotals.ts (pure, unit-tested). Pass 1's flat code cents go
  // in; the per-code percent contributions come back and are written onto
  // appliedList (redemption + the invoice email read .contribution).
  const totals = computeOrderTotals({
    grossSubtotalCents,
    shippingCents,
    flatCentsFromCodes: flatCents,
    itemUnitPricesCents: items.map((i) => clampCents(i.unitPriceCents)),
    wholesalePlan,
    bundleValue: bundlePlan.value,
    b2g1FreePlan,
    rewardPercent: rewardVoucher ? rewardVoucher.percent : null,
    accountPercent: accountDiscount ? accountDiscount.percent : null,
    percentEntries: appliedList.filter((a) => a.kind === "percent"),
  });
  const {
    wholesaleReduction, wholesaleUnits,
    bundleReduction,
    b2g1Reduction, b2g1FreeUnits,
    accountCents,
  } = totals;
  let rewardReduction = totals.rewardReduction;
  {
    let pctIdx = 0;
    for (const a of appliedList) {
      if (a.kind !== "percent") continue;
      a.contribution = totals.percentContributions[pctIdx++];
    }
  }
  let discountCents = totals.discountCents;
  const REWARD_CODE = "REWARD";
  const B2G1_CODE = "B2G1";
  const WHOLESALE_CODE = "WHOLESALE";
  const BUNDLE_CODE = BUNDLE_PROMO.code;
  // Comma-joined label for the order row, invoice, and emails (all read this).
  // The synthetic account/reward/promo codes lead, matching the order_coupons rows.
  let appliedCoupon: string | null = buildAppliedCouponLabel({
    accountCode: accountDiscount ? accountDiscount.code : null,
    rewardApplied: rewardReduction > 0,
    wholesaleApplied: wholesaleReduction > 0,
    bundleApplied: bundleReduction > 0,
    b2g1Applied: b2g1Reduction > 0,
    codes: appliedList.map((a) => a.code),
    rewardCode: REWARD_CODE,
    wholesaleCode: WHOLESALE_CODE,
    bundleCode: BUNDLE_CODE,
    b2g1Code: B2G1_CODE,
  });
  let totalCents = totals.totalCents;

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
    await alertOperator({
      fn: TELEMETRY_FN,
      stage: "inquiry_insert",
      summary: "Checkout dropped — inquiry row could not be written, nothing was recorded",
      error: inqErr,
      ctx: { referenceId, contact, itemCount },
    });
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
      shipping_cents:       shippingCents,
      discount_cents:       discountCents,
      coupon_code:          appliedCoupon,
      invoice_amount_cents: totalCents,
      payment_method:       `Zelle (${ZELLE_HANDLE})`,
      invoiced_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      // Compliance trail — the buyer's research-use disclaimer acceptance
      // (21+/research-only/industry). NULL when the client had none on file.
      research_attestation: attestation,
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
    await alertOperator({
      fn: TELEMETRY_FN,
      stage: "order_insert",
      summary: "Order row could not be created — buyer was told the team will follow up",
      error: ordErr,
      ctx: { referenceId, orderNumber, contact, amountCents: totalCents },
    });
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
  if (linesErr) {
    console.error("Order lines insert failed:", linesErr);
    // The order exists but has no line items — the invoice and admin views
    // will render an empty order. Silent until now.
    await alertOperator({
      fn: TELEMETRY_FN,
      stage: "order_lines_insert",
      summary: "Order created WITHOUT line items — invoice will be empty, fix before taking payment",
      error: linesErr,
      ctx: { orderNumber, referenceId, orderId: orderRow.id, contact, amountCents: totalCents },
    });
  }

  // Durable record of the lines the price check could NOT verify — lands on the
  // admin order timeline (order_events is admin-read-only, so the buyer never
  // sees it). A mismatching price can no longer reach this point: it refuses the
  // order outright (P0-1). What remains is a real catalog dose with no admin
  // price, which the client formula-prices — an unverified line must never be
  // indistinguishable from a verified one.
  if (unverifiedLines.length > 0) {
    const note = unverifiedLines
      .map((u) => `${u.sku}: billed ${usd(u.clientCents)}, no admin price for this dose`)
      .join("; ");
    const { error: evErr } = await supabase.from("order_events").insert({
      order_id: orderRow.id,
      stage: null,
      kind: "system",
      note: `⚠ Unverified line price on checkout — ${note}. Every other line matched the catalog. Confirm the invoice amount before marking paid, and set a price for the dose to close this.`,
    });
    if (evErr) console.error(`Unverified-price event insert failed for ${orderNumber}:`, evErr);
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

  // Reward voucher — CLAIM FIRST, atomically (migration 064). The RPC is one
  // guarded UPDATE … WHERE status='active' RETURNING, so of two racing
  // checkouts exactly one wins the active→used flip; the loser's claim comes
  // back empty and the reward is rolled OFF this order (discount removed,
  // totals re-persisted) before any email renders — the same fail-closed
  // shape as the redeem_coupon rollback below. This replaces the old filtered
  // update whose result was checked for a DB error but never for zero rows
  // matched, which let one voucher be spent twice (TOCTOU double-spend).
  if (rewardVoucher && rewardReduction > 0) {
    const claim = await claimRewardVoucher(supabase, rewardVoucher.id, orderRow.id);
    if (claim.claimed) {
      // Materialize the reward as a synthetic 'fixed' order_coupons row
      // (migration 050, source='reward').
      const { error: rewardRowErr } = await supabase.from("order_coupons").insert({
        order_id: orderRow.id,
        code: REWARD_CODE,
        kind: "fixed",
        // percent is informational on a fixed row, but recompute_order_totals
        // (052) uses it to re-derive the fenced remainder of the reward item:
        // remainder = discount × (100−pct)/pct.
        percent: rewardVoucher.percent,
        amount_cents: rewardReduction,
        free_label: `${rewardVoucher.percent}% off one item`,
        discount_cents: rewardReduction,
        source: "reward",
      });
      if (rewardRowErr) {
        console.error("Reward order_coupons insert failed:", rewardRowErr);
        // The voucher is already consumed and the order carries the discount
        // in discount_cents, but recompute_order_totals reads ONLY
        // order_coupons — without this row the next admin line edit silently
        // re-prices the order WITHOUT the reward. Alert with the exact row
        // payload so the operator can reconcile (re-insert) before that.
        await alertOperator({
          fn: TELEMETRY_FN,
          stage: "reward_row_insert",
          summary:
            "Voucher consumed but its order_coupons row did NOT persist — an admin line edit would silently drop the reward discount",
          error: rewardRowErr,
          ctx: {
            orderNumber, referenceId, orderId: orderRow.id, contact,
            voucherId: rewardVoucher.id,
            rewardPercent: rewardVoucher.percent,
            rewardDiscountCents: rewardReduction,
          },
        });
      }
    } else {
      console.error(
        `Reward voucher claim failed (${claim.reason}) — rolling the reward off ${orderNumber}:`,
        rewardVoucher.id,
      );
      const rolled = rollbackRewardPricing({
        grossSubtotalCents,
        shippingCents,
        discountCents,
        rewardReduction,
        appliedCoupon,
        rewardCode: REWARD_CODE,
      });
      discountCents = rolled.discountCents;
      totalCents = rolled.totalCents;
      appliedCoupon = rolled.appliedCoupon;
      rewardReduction = 0;
      rewardVoucher = null;
      const { error: rewardRollbackErr } = await supabase.from("orders")
        .update({
          discount_cents: discountCents,
          coupon_code: appliedCoupon,
          invoice_amount_cents: totalCents,
        })
        .eq("id", orderRow.id);
      if (rewardRollbackErr) {
        console.error("Reward rollback update failed:", rewardRollbackErr, orderRow.id);
        // The persisted order still carries a discount whose voucher was never
        // consumed — the invoice would under-bill. Same alert shape as the
        // coupon rollback below.
        await alertOperator({
          fn: TELEMETRY_FN,
          stage: "reward_rollback",
          summary:
            "Reward voucher lost its claim race but the rollback did NOT persist — stored order total may under-bill",
          error: rewardRollbackErr,
          ctx: { orderNumber, referenceId, orderId: orderRow.id, contact, intendedTotalCents: totalCents },
        });
      }
    }
  }

  // Materialize the wholesale case discount as a synthetic 'fixed'
  // order_coupons row (source='promo', like B2G1). recompute_order_totals
  // reads it as a flat reduction, so admin edits keep the totals consistent,
  // and every invoice surface itemizes it under "Discounts applied".
  if (wholesaleReduction > 0) {
    const { error: wholesaleRowErr } = await supabase.from("order_coupons").insert({
      order_id: orderRow.id,
      code: WHOLESALE_CODE,
      kind: "fixed",
      amount_cents: wholesaleReduction,
      free_label:
        `Wholesale pack pricing — ${wholesaleUnits} vial${wholesaleUnits === 1 ? "" : "s"} at case rates`,
      discount_cents: wholesaleReduction,
      source: "promo",
    });
    if (wholesaleRowErr) console.error("Wholesale order_coupons insert failed:", wholesaleRowErr);
  }

  // Materialize the bundle promo as a synthetic 'fixed' order_coupons row
  // (source='promo', like wholesale/B2G1 — no schema change needed).
  // recompute_order_totals reads it as a flat pre-percent reduction, so admin
  // edits keep the totals consistent and every invoice surface itemizes it.
  if (bundleReduction > 0) {
    const { error: bundleRowErr } = await supabase.from("order_coupons").insert({
      order_id: orderRow.id,
      code: BUNDLE_CODE,
      kind: "fixed",
      amount_cents: bundleReduction,
      free_label:
        `${BUNDLE_PROMO.label} — ${BUNDLE_PROMO.percent}% off ${bundlePlan.pairs} pair${bundlePlan.pairs === 1 ? "" : "s"}`,
      discount_cents: bundleReduction,
      source: "promo",
    });
    if (bundleRowErr) console.error("Bundle order_coupons insert failed:", bundleRowErr);
  }

  // Materialize the Buy-2-Get-1-Free promo as a synthetic 'fixed' order_coupons
  // row (migration 053, source='promo'). recompute_order_totals reads it as a
  // flat reduction, so admin edits keep the totals consistent.
  if (b2g1Reduction > 0) {
    const { error: b2g1RowErr } = await supabase.from("order_coupons").insert({
      order_id: orderRow.id,
      code: B2G1_CODE,
      kind: "fixed",
      amount_cents: b2g1Reduction,
      free_label: `Buy 2 Get 1 Free — ${b2g1FreeUnits} unit${b2g1FreeUnits === 1 ? "" : "s"} free`,
      discount_cents: b2g1Reduction,
      source: "promo",
    });
    if (b2g1RowErr) console.error("B2G1 order_coupons insert failed:", b2g1RowErr);
  }

  // Record the redemption + commission ledger row (service-role-only RPC;
  // atomically re-checks limits and bumps used_count). If it fails — e.g. two
  // concurrent checkouts raced for the last use of a capped code — ROLL THE
  // COUPON BACK off the order before any email goes out, so the invoice and
  // billed amount stay truthful and a raced-out code can't leak revenue.
  let redeemedList = appliedList; // codes that survive redemption (email itemization)
  if (appliedList.length > 0) {
    const failedCodes: string[] = [];
    const failedContributions: number[] = [];
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
        failedContributions.push(a.contribution);
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
    // The pure math (remove exactly the failed contributions, floor at 0,
    // shipping on top) lives in orderTotals.ts.
    if (failedCodes.length > 0) {
      ({ discountCents, totalCents } = repriceAfterFailedRedemptions({
        discountCents,
        failedContributions,
        grossSubtotalCents,
        shippingCents,
      }));
      const survivors = appliedList.filter((a) => !failedCodes.includes(a.code));
      redeemedList = survivors;
      // Mirror the original label build above: the synthetic reward/promo
      // codes keep their cents in discount_cents and their order_coupons rows
      // even when a CODE coupon loses its redemption race, so they must stay
      // in the label too — dropping them here left admin seeing a discount
      // larger than the labeled codes explain.
      appliedCoupon = buildAppliedCouponLabel({
        accountCode: accountDiscount ? accountDiscount.code : null,
        rewardApplied: rewardReduction > 0,
        wholesaleApplied: wholesaleReduction > 0,
        bundleApplied: bundleReduction > 0,
        b2g1Applied: b2g1Reduction > 0,
        codes: survivors.map((a) => a.code),
        rewardCode: REWARD_CODE,
        wholesaleCode: WHOLESALE_CODE,
        bundleCode: BUNDLE_CODE,
        b2g1Code: B2G1_CODE,
      });
      const { error: rollbackErr } = await supabase.from("orders")
        .update({ discount_cents: discountCents, coupon_code: appliedCoupon, invoice_amount_cents: totalCents })
        .eq("id", orderRow.id);
      if (rollbackErr) {
        console.error("Coupon rollback update failed:", rollbackErr, orderRow.id);
        // The in-memory total no longer matches the persisted order: the
        // buyer's invoice and the DB row disagree about what is owed.
        await alertOperator({
          fn: TELEMETRY_FN,
          stage: "coupon_rollback",
          summary: "Coupon rollback did NOT persist — stored order total may disagree with the invoice sent",
          error: rollbackErr,
          ctx: {
            orderNumber, referenceId, orderId: orderRow.id, contact,
            failedCodes: failedCodes.join(", "),
            intendedTotalCents: totalCents,
          },
        });
      }
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
          ...(b2g1Reduction > 0 ? [{
            code: B2G1_CODE,
            kind: "fixed",
            free_label: `Buy 2 Get 1 Free — ${b2g1FreeUnits} unit${b2g1FreeUnits === 1 ? "" : "s"} free`,
            percent: null,
            amount_cents: b2g1Reduction,
            discount_cents: b2g1Reduction,
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
        if (!invRes.ok) {
          console.error("Buyer invoice email failed:", invRes.status, invRes.body);
          await alertOperator({
            fn: TELEMETRY_FN,
            stage: "buyer_invoice_email",
            summary: "Buyer never received their invoice — send it manually from Admin → Orders",
            ctx: {
              orderNumber, referenceId, orderId: orderRow.id, contact,
              resendStatus: invRes.status,
            },
          });
        }
      } else {
        console.error("Buyer invoice: could not re-read order", orderRow.id);
        await alertOperator({
          fn: TELEMETRY_FN,
          stage: "buyer_invoice_reread",
          summary: "Order could not be re-read for the invoice — buyer received no invoice",
          ctx: { orderNumber, referenceId, orderId: orderRow.id, contact },
        });
      }
    } catch (err) {
      console.error("Buyer invoice email threw:", err);
      await alertOperator({
        fn: TELEMETRY_FN,
        stage: "buyer_invoice_email",
        summary: "Buyer invoice threw — buyer received no invoice",
        error: err,
        ctx: { orderNumber, referenceId, orderId: orderRow.id, contact },
      });
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
    ...(unverifiedLines.length > 0 ? [
      ``,
      `!! UNVERIFIED PRICE — confirm before marking paid (no admin price for this dose):`,
      ...unverifiedLines.map((u) => `  ${u.sku}: billed ${usd(u.clientCents)}`),
    ] : []),
    `Watch ${ZELLE_HANDLE} for a payment with note ${paymentCode(orderNumber)}.`,
    `Mark paid in Admin → Orders once confirmed.`,
  ].join("\n");
  const biz = await sendResendEmail({
    to: BUSINESS_EMAIL,
    subject: `${unverifiedLines.length > 0 ? "⚠ " : ""}New order ${orderNumber} — ${name} (${usd(totalCents)})`,
    html: buildBusinessEmailHtml(
      cleanPayload, orderNumber, referenceId, totalCents,
      appliedCoupon ? { code: appliedCoupon, discountCents } : undefined,
      unverifiedLines,
    ),
    text: bizText,
    replyTo: contactIsEmail ? contact : undefined,
  });
  if (!biz.ok) {
    console.error("Business email failed:", biz);
    // Worst silent case: a real, paid-for order that the operator is never
    // told about. The alert goes through the same Resend account that just
    // failed, so the structured log line above is the fallback of record.
    await alertOperator({
      fn: TELEMETRY_FN,
      stage: "business_notification_email",
      summary: "Order placed but the business notification failed — order is in Admin → Orders only",
      ctx: {
        orderNumber, referenceId, orderId: orderRow.id, contact,
        amountCents: totalCents, resendStatus: biz.status,
      },
    });
  } else {
    logEvent("info", TELEMETRY_FN, "Order placed", {
      orderNumber, referenceId, orderId: orderRow.id,
      amountCents: totalCents, invoiceEmailSent,
      unverifiedLineCount: unverifiedLines.length,
    });
  }

  return jsonResponse({
    success: true,
    orderNumber: orderRow.order_number,
    referenceId,
    createdAt: orderRow.created_at,
    amountCents: totalCents,
    invoiceEmailSent,
    contactIsEmail,
  });
};

// Instrumentation only: an unhandled throw is logged + alerted, then
// rethrown so the response the caller sees is exactly what it is today.
Deno.serve(withTelemetry(TELEMETRY_FN, handleOrder));
