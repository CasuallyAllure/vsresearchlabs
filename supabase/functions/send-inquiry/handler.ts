// supabase/functions/send-inquiry/handler.ts
// S1 — Inquiry Persistence: the whole orchestration, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (mirrors place-order/handler.ts). index.ts is now a
// thin Deno shim: it reads env, wires the real deps (supabase-js createClient,
// fetch, turnstile), and mounts the handler this factory returns under
// Deno.serve. NOTHING in this file may reference Deno globals or jsr:/npm:
// imports — that is the whole point of the split.
//
// Receives an inquiry payload, persists to the database, then sends email.
// Database write occurs BEFORE email delivery. Email failure does not
// destroy the persisted inquiry record.
//
// Flow:
//   1. Validate payload
//   2. Rate-limit check (≤ 5 submissions per contact per hour)
//   3. Generate authoritative reference_id (server-side only)
//   4. Insert inquiries row
//   5. Insert inquiry_items rows
//   6. Send business notification email (includes reference_id)
//   7. Send buyer confirmation email (best-effort; email contacts only)
//   8. Return server-authoritative intake metadata to client

import { EMAIL_BRAND } from "../_shared/emailBrand.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InquiryItemPayload {
  product: {
    id: string;
    name: string;
    category: string | null;
    sku?: string;
  };
  quantity: number;
  note?: string;
}

export interface InquiryPayload {
  name: string;
  contact: string;
  organization?: string;
  notes?: string;
  ship_street?: string;
  ship_city?: string;
  ship_state?: string;
  ship_zip?: string;
  ship_country?: string;
  items: InquiryItemPayload[];
}

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

/** Env-derived configuration — index.ts reads Deno.env once at cold start and
 *  passes the resolved values here, preserving the old module-load semantics. */
export interface InquiryHandlerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  resendApiKey: string;
  businessEmail: string;
  fromEmail: string;
  corsHeaders: Record<string, string>;
}

/** The structural slice of a supabase-js client this handler actually uses.
 *  Query-builder chains are typed loose (the real client's generics don't
 *  survive injection); every result is narrowed at the use site exactly as
 *  the pre-extraction code did. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InquiryQueryBuilder = any;

export interface InquirySupabaseClient {
  from(table: string): InquiryQueryBuilder;
}

/** Runtime seams. Destructured below under the exact names the orchestration
 *  body has always used (`fetch` deliberately shadows the global inside the
 *  factory). */
export interface InquiryHandlerDeps {
  createClient: (url: string, key: string) => InquirySupabaseClient;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  verifyTurnstile: typeof import("../_shared/turnstile.ts")["verifyTurnstile"];
  clientIp: typeof import("../_shared/turnstile.ts")["clientIp"];
}

export function createInquiryHandler(
  cfg: InquiryHandlerConfig,
  deps: InquiryHandlerDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL         = cfg.supabaseUrl;
  const SUPABASE_SERVICE_KEY = cfg.supabaseServiceKey;
  const RESEND_API_KEY       = cfg.resendApiKey;
  const BUSINESS_EMAIL       = cfg.businessEmail;
  const FROM_EMAIL           = cfg.fromEmail;

  const CORS_HEADERS = cfg.corsHeaders;

  const { createClient, fetch, verifyTurnstile, clientIp } = deps;

const INTAKE_CHANNEL  = "VSR-WEB-PORTAL";
const PROCESSING_NODE = "VSR-HQ-INTAKE";

// ---------------------------------------------------------------------------
// Reference ID — server-authoritative
//
// Format: VSR-REQ-YYMMDD-NNN
// NNN is centisecond-resolution wall clock mod 1000.
// The unique constraint on reference_id provides the final uniqueness guarantee.
// ---------------------------------------------------------------------------

function generateReferenceId(): string {
  const now = new Date();
  const yy  = String(now.getUTCFullYear()).slice(2);
  const mm  = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd  = String(now.getUTCDate()).padStart(2, "0");
  const seq = String(Math.floor(now.getTime() / 100) % 1000).padStart(3, "0");
  return `VSR-REQ-${yy}${mm}${dd}-${seq}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function clampQty(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(999, Math.max(1, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// Email builders
// ---------------------------------------------------------------------------

function buildItemRowsHtml(items: InquiryItemPayload[]): string {
  return items
    .map((item) => {
      const name     = escapeHtml(item.product?.name ?? "Unknown item");
      const sku      = item.product?.sku ? escapeHtml(item.product.sku) : "—";
      const category = item.product?.category
        ? escapeHtml(item.product.category.replace(/-/g, " "))
        : "—";
      const qty      = clampQty(item.quantity);
      const note     = item.note?.trim();
      const border   = `border-bottom:${note ? "none" : "1px solid #eee"}`;
      const noteRow  = note
        ? `<tr><td colspan="4" style="padding:0 12px 12px;color:#444;font-size:13px;border-bottom:1px solid #eee;"><em>Note:</em> ${escapeHtml(note).replace(/\n/g, "<br/>")}</td></tr>`
        : "";
      return `
        <tr>
          <td style="padding:8px 12px;${border};font-family:monospace;font-size:12px;color:#555;">${sku}</td>
          <td style="padding:8px 12px;${border};">${name}</td>
          <td style="padding:8px 12px;${border};color:#666;">${category}</td>
          <td style="padding:8px 12px;${border};text-align:right;">${qty}</td>
        </tr>${noteRow}`;
    })
    .join("");
}

function buildBusinessEmailHtml(
  payload: InquiryPayload,
  referenceId: string,
): string {
  const itemRows      = buildItemRowsHtml(payload.items);
  const orgLine       = payload.organization
    ? `<p><strong>Organization:</strong> ${escapeHtml(payload.organization)}</p>`
    : "";
  const notesSection  = payload.notes
    ? `<p style="margin-top:16px;"><strong>Notes:</strong><br/>${escapeHtml(payload.notes).replace(/\n/g, "<br/>")}</p>`
    : "";
  const addrParts = [
    payload.ship_street,
    [payload.ship_city, payload.ship_state].filter(Boolean).join(", "),
    payload.ship_zip,
    payload.ship_country,
  ].filter((p) => p && p.trim());
  const shipSection = addrParts.length
    ? `<p style="margin-top:16px;"><strong>Ship to:</strong><br/>${addrParts.map((p) => escapeHtml(p as string)).join("<br/>")}</p>`
    : "";

  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(referenceId)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.05em;margin:0 0 16px;">
        Procurement Inquiry — ${escapeHtml(EMAIL_BRAND.name)}
      </h2>
      <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(payload.contact)}</p>
      ${orgLine}
      ${shipSection}
      ${notesSection}
      <h3 style="margin-top:24px;font-weight:400;letter-spacing:0.03em;">Requested Inventory</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">SKU</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Category</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        For Research Purposes Only — Not for Human Use
      </p>
    </div>`;
}

function buildUserEmailHtml(
  payload: InquiryPayload,
  referenceId: string,
): string {
  const itemRows = buildItemRowsHtml(payload.items);

  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(referenceId)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.05em;margin:0 0 16px;">
        Inquiry received, ${escapeHtml(payload.name)}.
      </h2>
      <p style="color:#444;">
        Your inquiry has been filed under reference
        <span style="font-family:monospace;font-weight:500;">${escapeHtml(referenceId)}</span>.
        A member of our team will respond within one to two business days.
        Retain this reference for any follow-up correspondence.
      </p>
      <h3 style="margin-top:24px;font-weight:400;letter-spacing:0.03em;">Requested Inventory</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">SKU</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;">Category</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;font-weight:400;text-align:right;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        ${escapeHtml(EMAIL_BRAND.name)} — For Research Purposes Only
      </p>
    </div>`;
}

async function sendResendEmail(args: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to:   args.to,
      subject: args.subject,
      html:    args.html,
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

const handleInquiry = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "Email service not configured." }, 500);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: "Database service not configured." }, 500);
  }

  // Parse body
  let payload: InquiryPayload;
  try {
    payload = (await req.json()) as InquiryPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  // Bot check (no-op until TURNSTILE_SECRET is set).
  const ts = await verifyTurnstile(
    (payload as { turnstile_token?: string }).turnstile_token,
    clientIp(req),
  );
  if (!ts.ok) return jsonResponse({ error: ts.reason ?? "Verification failed." }, 403);

  // Validate top-level fields
  const name         = (payload.name         ?? "").trim();
  const contact      = (payload.contact      ?? "").trim();
  const organization = (payload.organization ?? "").trim();
  const notes        = (payload.notes        ?? "").trim();
  const shipStreet   = (payload.ship_street  ?? "").trim().slice(0, 200);
  const shipCity     = (payload.ship_city    ?? "").trim().slice(0, 120);
  const shipState    = (payload.ship_state   ?? "").trim().slice(0,  60);
  const shipZip      = (payload.ship_zip     ?? "").trim().slice(0,  20);
  const shipCountry  = (payload.ship_country ?? "").trim().slice(0,  60);
  const rawItems: unknown[] = Array.isArray(payload.items)
    ? (payload.items as unknown[])
    : [];

  if (!name)                  return jsonResponse({ error: "Name is required." }, 400);
  if (name.length > 120)      return jsonResponse({ error: "Name too long." }, 400);
  if (!contact)               return jsonResponse({ error: "Contact is required." }, 400);
  if (contact.length > 200)   return jsonResponse({ error: "Contact too long." }, 400);
  if (organization.length > 200) return jsonResponse({ error: "Organization too long." }, 400);
  if (notes.length > 4000)    return jsonResponse({ error: "Notes too long." }, 400);
  if (rawItems.length === 0)  return jsonResponse({ error: "Inquiry must contain at least one item." }, 400);
  if (rawItems.length > 100)  return jsonResponse({ error: "Too many items in inquiry." }, 400);

  // Normalize and validate each item
  const items: InquiryItemPayload[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") {
      return jsonResponse({ error: "Malformed item in inquiry." }, 400);
    }
    const r       = raw as Record<string, unknown>;
    const product = (r.product ?? null) as Record<string, unknown> | null;
    if (!product || typeof product !== "object") {
      return jsonResponse({ error: "Item missing product details." }, 400);
    }
    const productId   = typeof product.id   === "string" ? product.id   : "";
    const productName = typeof product.name === "string" ? product.name.trim() : "";
    if (!productId || !productName) {
      return jsonResponse({ error: "Item product must include id and name." }, 400);
    }
    const category = typeof product.category === "string" ? product.category : null;
    const sku      = typeof product.sku      === "string" ? product.sku.trim() : "";
    const noteRaw  = typeof r.note           === "string" ? r.note.trim() : "";
    const note     = noteRaw.length > 0 ? noteRaw.slice(0, 1000) : undefined;

    items.push({
      product: { id: productId, name: productName, category, sku: sku || undefined },
      quantity: clampQty(r.quantity),
      note,
    });
  }

  const itemCount    = items.reduce((sum, i) => sum + clampQty(i.quantity), 0);
  const cleanPayload: InquiryPayload = {
    name,
    contact,
    organization: organization || undefined,
    notes:        notes || undefined,
    items,
  };
  const contactIsEmail = EMAIL_REGEX.test(contact);

  // Initialize Supabase client (service role key bypasses RLS)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Rate limit: max 5 submissions per contact per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("inquiries")
    .select("*", { count: "exact", head: true })
    .eq("contact", contact)
    .gte("created_at", oneHourAgo);

  if ((recentCount ?? 0) >= 5) {
    return jsonResponse(
      { error: "Too many inquiries from this contact. Please wait before submitting again." },
      429,
    );
  }

  // Generate server-authoritative reference ID
  const referenceId = generateReferenceId();

  // Persist inquiry — DB write before email delivery.
  // Failure here returns an error; no email is sent, no partial state exists.
  const { data: inquiryRow, error: insertError } = await supabase
    .from("inquiries")
    .insert({
      reference_id:    referenceId,
      name,
      contact,
      organization:    organization || null,
      notes:           notes || null,
      ship_street:     shipStreet  || null,
      ship_city:       shipCity    || null,
      ship_state:      shipState   || null,
      ship_zip:        shipZip     || null,
      ship_country:    shipCountry || null,
      status:          "OPEN",
      intake_channel:  INTAKE_CHANNEL,
      processing_node: PROCESSING_NODE,
      item_count:      itemCount,
    })
    .select("id, reference_id, created_at")
    .single();

  if (insertError || !inquiryRow) {
    console.error("Inquiry insert failed:", insertError);
    return jsonResponse({ error: "Failed to record inquiry. Please try again." }, 502);
  }

  // Persist line items — best-effort after inquiry row is committed.
  // Items failure is logged but does not roll back the inquiry row; the
  // inquiry is persisted and email delivery continues.
  const { error: itemsError } = await supabase
    .from("inquiry_items")
    .insert(
      items.map((item) => ({
        inquiry_id:   inquiryRow.id,
        sku:          item.product.sku ?? item.product.id,
        product_name: item.product.name,
        quantity:     clampQty(item.quantity),
        category:     item.product.category ?? null,
        item_note:    item.note ?? null,
      })),
    );

  if (itemsError) {
    console.error("Inquiry items insert failed:", itemsError);
  }

  const persistedRef: string = inquiryRow.reference_id;
  const persistedAt: string  = inquiryRow.created_at;

  // Send business notification. If this fails, the inquiry is persisted;
  // return success with an emailDeliveryFailed flag so the client still
  // renders the intake record.
  const businessResult = await sendResendEmail({
    to:      BUSINESS_EMAIL,
    subject: `Procurement Inquiry ${persistedRef} — ${name}`,
    html:    buildBusinessEmailHtml(cleanPayload, persistedRef),
    replyTo: contactIsEmail ? contact : undefined,
  });

  if (!businessResult.ok) {
    console.error("Business email failed:", businessResult);
    return jsonResponse({
      success:              true,
      referenceId:          persistedRef,
      submittedAt:          persistedAt,
      intakeChannel:        INTAKE_CHANNEL,
      processingNode:       PROCESSING_NODE,
      classificationStatus: "OPEN",
      userCopySent:         false,
      emailDeliveryFailed:  true,
    });
  }

  // Send buyer confirmation — best-effort; only when contact is an email.
  let userCopySent = false;
  if (contactIsEmail) {
    const userResult = await sendResendEmail({
      to:      contact,
      subject: `Inquiry ${persistedRef} received — ${EMAIL_BRAND.name}`,
      html:    buildUserEmailHtml(cleanPayload, persistedRef),
    });
    userCopySent = userResult.ok;
    if (!userResult.ok) console.error("User confirmation email failed:", userResult);
  }

  return jsonResponse({
    success:              true,
    referenceId:          persistedRef,
    submittedAt:          persistedAt,
    intakeChannel:        INTAKE_CHANNEL,
    processingNode:       PROCESSING_NODE,
    classificationStatus: "OPEN",
    userCopySent,
    contactIsEmail,
  });
};

  return handleInquiry;
}
