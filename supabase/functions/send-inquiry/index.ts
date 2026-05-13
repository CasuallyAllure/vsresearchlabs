// supabase/functions/send-inquiry/index.ts
// Phase 5 — VS Research Labs
//
// Receives an inquiry payload from the frontend and sends two emails
// via Resend:
//   1) Business notification (full details)
//   2) User confirmation copy (only if `contact` is a valid email)
//
// Required env vars:
//   - RESEND_API_KEY        (Resend API key)
//   - INQUIRY_TO_EMAIL      (business inbox; fallback hardcoded below)
//   - RESEND_FROM_EMAIL     (verified Resend sender; fallback below)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InquiryItemPayload {
  product: {
    id: string;
    name: string;
    category: string | null;
  };
  quantity: number;
}

interface InquiryPayload {
  name: string;
  contact: string;
  notes?: string;
  items: InquiryItemPayload[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const BUSINESS_EMAIL =
  Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquiries@vsresearchlabs.com";
const FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") ??
  "VS Research Labs <inquiries@vsresearchlabs.com>";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function buildItemRowsHtml(items: InquiryItemPayload[]): string {
  return items
    .map((item) => {
      const name = escapeHtml(item.product?.name ?? "Unknown item");
      const category = item.product?.category
        ? escapeHtml(item.product.category.replace(/-/g, " "))
        : "—";
      const qty = Number.isFinite(item.quantity) ? item.quantity : 1;
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${category}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${qty}</td>
        </tr>
      `;
    })
    .join("");
}

function buildBusinessEmailHtml(payload: InquiryPayload): string {
  const itemRows = buildItemRowsHtml(payload.items);
  const notes = payload.notes
    ? `<p><strong>Notes:</strong><br/>${escapeHtml(payload.notes).replace(
        /\n/g,
        "<br/>"
      )}</p>`
    : "";

  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;">
      <h2 style="font-weight:300;letter-spacing:0.05em;margin:0 0 16px;">New Inquiry — VS Research Labs</h2>
      <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(payload.contact)}</p>
      ${notes}
      <h3 style="margin-top:24px;font-weight:400;">Requested items</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;">Category</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;text-align:right;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        For Research Purposes Only — Not for Human Use
      </p>
    </div>
  `;
}

function buildUserEmailHtml(payload: InquiryPayload): string {
  const itemRows = buildItemRowsHtml(payload.items);

  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;">
      <h2 style="font-weight:300;letter-spacing:0.05em;margin:0 0 16px;">Thank you, ${escapeHtml(
        payload.name
      )}.</h2>
      <p>We have received your inquiry. A member of our team will reach out shortly.</p>
      <h3 style="margin-top:24px;font-weight:400;">Your requested items</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#666;">
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;">Category</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ccc;text-align:right;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        VS Research Labs — For Research Purposes Only.
      </p>
    </div>
  `;
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
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "Email service not configured." }, 500);
  }

  // Parse body
  let payload: InquiryPayload;
  try {
    payload = (await req.json()) as InquiryPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  // Validate
  const name = (payload.name ?? "").trim();
  const contact = (payload.contact ?? "").trim();
  const notes = (payload.notes ?? "").trim();
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!name) return jsonResponse({ error: "Name is required." }, 400);
  if (!contact) {
    return jsonResponse({ error: "Email or phone is required." }, 400);
  }
  if (items.length === 0) {
    return jsonResponse({ error: "Inquiry must contain at least one item." }, 400);
  }

  const cleanPayload: InquiryPayload = { name, contact, notes, items };
  const contactIsEmail = EMAIL_REGEX.test(contact);

  // Send business email (must succeed)
  const businessResult = await sendResendEmail({
    to: BUSINESS_EMAIL,
    subject: `New Inquiry — ${name}`,
    html: buildBusinessEmailHtml(cleanPayload),
    replyTo: contactIsEmail ? contact : undefined,
  });

  if (!businessResult.ok) {
    console.error("Business email failed:", businessResult);
    return jsonResponse(
      {
        error: "Failed to send inquiry. Please try again or contact us directly.",
      },
      502
    );
  }

  // Send user copy (best-effort; only if contact is an email)
  let userCopySent = false;
  if (contactIsEmail) {
    const userResult = await sendResendEmail({
      to: contact,
      subject: "We received your inquiry — VS Research Labs",
      html: buildUserEmailHtml(cleanPayload),
    });
    userCopySent = userResult.ok;
    if (!userResult.ok) {
      console.error("User confirmation email failed:", userResult);
    }
  }

  return jsonResponse({
    success: true,
    userCopySent,
    contactIsEmail,
  });
});
