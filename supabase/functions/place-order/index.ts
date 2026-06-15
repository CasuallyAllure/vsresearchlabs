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

// ── New brand palette (matches the live site editorial design) ───────────
//
// background  #F4EFE6   warm cream
// surface     #FBF9F4   lighter cream (cards)
// rule        #E4DFD5   hairline
// ink         #1A1714   primary text
// muted       #6F665C   secondary text
// faint       #A09689   tertiary text
// teal        #34727A   accent

function brandHeaderHtml(): string {
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="vertical-align:middle;">
          <div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#34727A;font-weight:600;margin-bottom:4px;">VS Research Labs</div>
          <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;">Northern California Biopeptide Sciences</div>
        </td>
        <td style="vertical-align:middle;text-align:right;">
          <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#FBF9F4;border:0.5px solid rgba(26,23,20,0.18);font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;letter-spacing:0.18em;color:#1A1714;text-transform:uppercase;">Invoice</span>
        </td>
      </tr>
    </table>`;
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
        <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;">${sku}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;color:#1A1714;font-size:13px;">${name}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#1A1714;">${qty}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#6F665C;">${unit ? usd(unit) : "—"}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#1A1714;">${line ? usd(line) : "—"}</td>
      </tr>`;
  }).join("");
}

function paymentBlockHtml(orderNumber: string, totalCents: number): string {
  return `
    <div style="background:#FBF9F4;border:1px solid rgba(52,114,122,0.35);border-radius:12px;padding:22px 24px;margin-top:16px;">
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:10px;">Payment Instructions</div>
      <p style="margin:0 0 12px;font-size:14px;color:#1A1714;line-height:1.6;">Please send <strong>${usd(totalCents)}</strong> via <strong>Zelle</strong> to:</p>
      <div style="background:#F4EFE6;border:0.5px solid rgba(26,23,20,0.14);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:15px;color:#1A1714;letter-spacing:0.04em;word-break:break-all;"><strong>${escapeHtml(ZELLE_HANDLE)}</strong></div>
      <p style="margin:0 0 8px;font-size:13.5px;color:#1A1714;line-height:1.6;"><strong>Include your order number in the memo / note field:</strong></p>
      <div style="background:#F4EFE6;border:0.5px solid rgba(26,23,20,0.14);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:14px;color:#1A1714;letter-spacing:0.04em;word-break:break-all;"><strong>${escapeHtml(orderNumber)}</strong></div>
      <p style="margin:0 0 10px;font-size:12.5px;color:#6F665C;line-height:1.6;background:#F4EFE6;padding:10px 14px;border-radius:6px;border-left:2px solid #34727A;">
        Send as <strong>family &amp; friends</strong> if Zelle prompts you to choose. Payments without the order number in the memo, or sent as Goods &amp; Services, may be rejected — please double-check before sending.
      </p>
      <p style="margin:0;font-size:12px;color:#6F665C;">PayPal alternative (Friends &amp; Family only): <span style="font-family:'JetBrains Mono','SF Mono',monospace;color:#1A1714;">${escapeHtml(PAYPAL_HANDLE)}</span></p>
    </div>`;
}

function buildInvoiceEmailHtml(
  payload: OrderPayload, orderNumber: string, totalCents: number, createdAt: string,
): string {
  const shipBlock = [
    payload.ship_street,
    [payload.ship_city, payload.ship_state, payload.ship_zip].filter(Boolean).join(", "),
    payload.ship_country,
  ].filter(Boolean).map((s) => escapeHtml(String(s))).join("<br/>");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Invoice ${escapeHtml(orderNumber)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:680px;margin:0 auto;padding:28px 14px;">

    ${brandHeaderHtml()}

    <!-- Order card -->
    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">

      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Order Reference</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:24px;letter-spacing:0.03em;color:#1A1714;font-weight:600;margin-bottom:4px;word-break:break-all;">${escapeHtml(orderNumber)}</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;letter-spacing:0.08em;margin-bottom:20px;">${escapeHtml(createdAt.slice(0, 10))} · ${escapeHtml(createdAt.slice(11, 19))} UTC</div>

      <!-- Bill / Ship -->
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:22px;">
        <tr>
          <td style="vertical-align:top;padding-right:16px;width:50%;">
            <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Bill To</div>
            <div style="font-size:13px;color:#1A1714;line-height:1.55;">
              <strong>${escapeHtml(payload.name)}</strong><br/>
              ${escapeHtml(payload.contact)}
              ${payload.organization ? `<br/>${escapeHtml(payload.organization)}` : ""}
            </div>
          </td>
          <td style="vertical-align:top;width:50%;">
            <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Ship To</div>
            <div style="font-size:13px;color:#1A1714;line-height:1.55;">${shipBlock || '<span style="color:#A09689;">— to be provided —</span>'}</div>
          </td>
        </tr>
      </table>

      <!-- Items -->
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:8px;">Items</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #E4DFD5;border-radius:6px;margin-bottom:14px;">
        <thead><tr style="background:#F4EFE6;">
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;">SKU</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;">Item</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:50px;">Qty</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:80px;">Unit</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:90px;">Line</th>
        </tr></thead>
        <tbody>${lineRowsHtml(payload.items)}</tbody>
      </table>

      <!-- Totals -->
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Subtotal</td>
            <td style="padding:5px 14px;text-align:right;width:120px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${usd(totalCents)}</td></tr>
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Shipping</td>
            <td style="padding:5px 14px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#A09689;">Confirmed at fulfillment</td></tr>
        <tr style="border-top:1px solid #E4DFD5;">
          <td style="padding:14px 14px 6px;text-align:right;font-size:11px;color:#6F665C;letter-spacing:0.2em;text-transform:uppercase;">Total Due</td>
          <td style="padding:14px 14px 6px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:20px;color:#1A1714;font-weight:700;">${usd(totalCents)}</td>
        </tr>
      </table>
    </div>

    ${paymentBlockHtml(orderNumber, totalCents)}

    <p style="margin:20px 4px 8px;font-size:13px;color:#1A1714;line-height:1.6;">
      Once payment is received and verified, your order moves to fulfillment and ships from our nearest warehouse (<strong>Sacramento</strong> or <strong>Vallejo, California</strong>). You'll receive a tracking number by email as soon as it leaves the dock.
    </p>
    <p style="margin:0 4px 16px;font-size:13px;color:#1A1714;line-height:1.6;">Questions? Simply reply to this email — your message lands on the same reference thread.</p>

    <div style="border-top:1px solid rgba(26,23,20,0.10);padding-top:14px;margin-top:20px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#6F665C;margin-bottom:4px;">VS Research Labs · Northern California Biopeptide Sciences</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A09689;">For Research Purposes Only — Not for Human or Veterinary Use</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;color:#A09689;margin-top:10px;letter-spacing:0.08em;">Reference ${escapeHtml(orderNumber)}</div>
    </div>
  </div>
</body></html>`;
}

function buildBusinessEmailHtml(
  payload: OrderPayload, orderNumber: string, referenceId: string, totalCents: number,
): string {
  const org = payload.organization
    ? `<p><strong>Organization:</strong> ${escapeHtml(payload.organization)}</p>` : "";
  const notes = payload.notes
    ? `<p><strong>Notes:</strong><br/>${escapeHtml(payload.notes).replace(/\n/g, "<br/>")}</p>` : "";
  return `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;">
      <p style="font-family:monospace;font-size:12px;color:#888;margin:0 0 6px;">${escapeHtml(orderNumber)} · ref ${escapeHtml(referenceId)}</p>
      <h2 style="font-weight:300;margin:0 0 16px;">New order — invoice auto-sent</h2>
      <p><strong>Buyer:</strong> ${escapeHtml(payload.name)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(payload.contact)}</p>
      ${org}${notes}
      <p><strong>Total:</strong> ${usd(totalCents)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
        <thead><tr style="text-align:left;color:#666;">
          <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">SKU</th>
          <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Item</th>
          <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Qty</th>
          <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Line</th>
        </tr></thead>
        <tbody>${payload.items.map((i) => {
          const q = clampQty(i.quantity); const u = clampCents(i.unitPriceCents);
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#555;">${i.product?.sku ? escapeHtml(i.product.sku) : "—"}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(i.product?.name ?? "Item")}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${q}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;">${u ? usd(u * q) : "—"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
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
  const cleanPayload: OrderPayload = { name, contact, organization: organization || undefined, notes: notes || undefined, items };

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

  // 2) Order row (auto-invoiced)
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
  let invoiceEmailSent = false;
  if (contactIsEmail) {
    const r = await sendResendEmail({
      to: contact,
      subject: `Invoice ${orderNumber} — VS Research Labs`,
      html: buildInvoiceEmailHtml(cleanPayload, orderNumber, totalCents, orderRow.created_at),
    });
    invoiceEmailSent = r.ok;
    if (!r.ok) console.error("Invoice email failed:", r);
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
