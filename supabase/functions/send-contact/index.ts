// supabase/functions/send-contact/index.ts
// Public /contact form intake. Persists the message to contact_messages,
// sends a notification to INQUIRY_TO_EMAIL, and sends a branded
// confirmation back to the sender.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   INQUIRY_TO_EMAIL
//   ALLOWED_ORIGIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTurnstile, clientIp } from "../_shared/turnstile.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { EMAIL_BRAND } from "../_shared/emailBrand.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const BUSINESS_EMAIL       = Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquire@vsresearchlabs.com";
const FROM_EMAIL           = Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>";

const CORS_HEADERS = buildCorsHeaders();

const INTAKE_CHANNEL = "VSR-WEB-PORTAL";

interface ContactPayload {
  name:         string;
  email:        string;
  phone?:       string;
  organization?: string;
  role_title?:  string;
  topic?:       string;
  message:      string;
  referrer?:    string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOPIC_LABEL: Record<string, string> = {
  general:       'General Inquiry',
  procurement:   'Procurement / Catalog',
  documentation: 'Documentation Request',
  partnership:   'Partnership / Distribution',
  media:         'Media / Press',
  other:         'Other',
};

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

function generateReferenceId(): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const seq = String(Math.floor(now.getTime() / 100) % 1000).padStart(3, "0");
  return `VSR-MSG-${yy}${mm}${dd}-${seq}`;
}

function buildBusinessEmailHtml(p: ContactPayload, refId: string): string {
  const topicLabel = TOPIC_LABEL[p.topic ?? "general"] ?? p.topic ?? "General Inquiry";
  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;line-height:1.55;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(refId)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">
        Contact Inquiry — ${escapeHtml(topicLabel)}
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
          <tr><td style="padding:6px 0;color:#666;width:140px;">Name</td><td style="padding:6px 0;"><strong>${escapeHtml(p.name)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#666;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></td></tr>
          ${p.phone        ? `<tr><td style="padding:6px 0;color:#666;">Phone</td><td style="padding:6px 0;">${escapeHtml(p.phone)}</td></tr>` : ""}
          ${p.organization ? `<tr><td style="padding:6px 0;color:#666;">Organization</td><td style="padding:6px 0;">${escapeHtml(p.organization)}</td></tr>` : ""}
          ${p.role_title   ? `<tr><td style="padding:6px 0;color:#666;">Role</td><td style="padding:6px 0;">${escapeHtml(p.role_title)}</td></tr>` : ""}
          ${p.referrer     ? `<tr><td style="padding:6px 0;color:#666;">How they found us</td><td style="padding:6px 0;">${escapeHtml(p.referrer)}</td></tr>` : ""}
        </tbody>
      </table>
      <h3 style="margin-top:20px;font-weight:400;letter-spacing:0.03em;">Message</h3>
      <div style="padding:14px 16px;background:#f6f6f6;border-radius:6px;font-size:14px;color:#333;white-space:pre-wrap;">${escapeHtml(p.message)}</div>
      <p style="margin-top:24px;color:#888;font-size:12px;">
        ${escapeHtml(EMAIL_BRAND.name)} · ${escapeHtml(EMAIL_BRAND.tagline)}<br/>
        For Research Purposes Only — Not for Human or Veterinary Use.
      </p>
    </div>`;
}

function buildBuyerEmailHtml(p: ContactPayload, refId: string): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;color:#111;max-width:640px;margin:0 auto;line-height:1.55;">
      <p style="font-family:monospace;font-size:12px;color:#888;letter-spacing:0.08em;margin:0 0 20px;">
        ${escapeHtml(refId)}
      </p>
      <h2 style="font-weight:300;letter-spacing:0.04em;margin:0 0 16px;">
        Message received, ${escapeHtml(p.name)}.
      </h2>
      <p>Thank you for reaching out to <strong>${escapeHtml(EMAIL_BRAND.name)}</strong>.</p>
      <p>
        Your message has been filed under reference
        <span style="font-family:monospace;font-weight:500;">${escapeHtml(refId)}</span>.
        A member of our team will respond within one to two business days.
      </p>
      <h3 style="margin-top:24px;font-weight:400;letter-spacing:0.03em;">Your message</h3>
      <div style="padding:14px 16px;background:#f6f6f6;border-radius:6px;font-size:14px;color:#333;white-space:pre-wrap;">${escapeHtml(p.message)}</div>
      <p style="margin-top:24px;">
        If you have additional details to share in the meantime, simply reply
        to this email — your message will reach our intake desk on the same
        reference thread.
      </p>
      <p style="margin-top:28px;color:#666;font-size:13px;">
        Operations<br/>
        <strong>${escapeHtml(EMAIL_BRAND.name)}</strong><br/>
        ${escapeHtml(EMAIL_BRAND.tagline)}<br/>
        Warehouses: Sacramento, CA · Vallejo, CA
      </p>
      <p style="margin-top:18px;color:#888;font-size:11px;">
        For Research Purposes Only — Not for Human or Veterinary Use.
      </p>
    </div>`;
}

async function sendResendEmail(args: { to: string; subject: string; html: string; replyTo?: string }):
  Promise<{ ok: boolean; status: number; body: unknown }> {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")  return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")     return jsonResponse({ error: "Method not allowed." }, 405);
  if (!RESEND_API_KEY)           return jsonResponse({ error: "Email service not configured." }, 500);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return jsonResponse({ error: "Database service not configured." }, 500);

  let payload: ContactPayload;
  try {
    payload = (await req.json()) as ContactPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  // Bot check (no-op until TURNSTILE_SECRET is set).
  const ts = await verifyTurnstile(
    (payload as { turnstile_token?: string }).turnstile_token,
    clientIp(req),
  );
  if (!ts.ok) return jsonResponse({ error: ts.reason ?? "Verification failed." }, 403);

  const name  = (payload.name  ?? "").trim();
  const email = (payload.email ?? "").trim();
  const phone = (payload.phone ?? "").trim();
  const organization = (payload.organization ?? "").trim();
  const role_title   = (payload.role_title   ?? "").trim();
  const message      = (payload.message      ?? "").trim();
  const referrer     = (payload.referrer     ?? "").trim();
  const topic        = (payload.topic        ?? "general").trim();

  if (!name)                     return jsonResponse({ error: "Name is required." }, 400);
  if (name.length > 120)         return jsonResponse({ error: "Name too long." }, 400);
  if (!EMAIL_REGEX.test(email))  return jsonResponse({ error: "Valid email is required." }, 400);
  if (email.length > 200)        return jsonResponse({ error: "Email too long." }, 400);
  if (phone.length > 50)         return jsonResponse({ error: "Phone too long." }, 400);
  if (organization.length > 200) return jsonResponse({ error: "Organization too long." }, 400);
  if (role_title.length > 120)   return jsonResponse({ error: "Role too long." }, 400);
  if (referrer.length > 500)     return jsonResponse({ error: "Referrer too long." }, 400);
  if (!message || message.length < 8) return jsonResponse({ error: "Please share a few sentences about your inquiry." }, 400);
  if (message.length > 6000)     return jsonResponse({ error: "Message too long." }, 400);
  if (!['general','procurement','documentation','partnership','media','other'].includes(topic)) {
    return jsonResponse({ error: "Invalid topic." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Rate-limit: max 5 per email per hour.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("contact_messages")
    .select("*", { count: "exact", head: true })
    .ilike("email", email)
    .gte("created_at", oneHourAgo);

  if ((recentCount ?? 0) >= 5) {
    return jsonResponse({ error: "Too many messages from this email. Please wait before sending again." }, 429);
  }

  const referenceId = generateReferenceId();

  const { data: insertedRow, error: insertError } = await supabase
    .from("contact_messages")
    .insert({
      reference_id:   referenceId,
      name, email,
      phone:        phone || null,
      organization: organization || null,
      role_title:   role_title   || null,
      topic,
      message,
      referrer:     referrer || null,
      status:       "OPEN",
      intake_channel: INTAKE_CHANNEL,
    })
    .select("id, reference_id, created_at")
    .single();

  if (insertError || !insertedRow) {
    console.error("contact_messages insert failed:", insertError);
    return jsonResponse({ error: "Failed to record message. Please try again." }, 502);
  }

  const clean: ContactPayload = { name, email, phone, organization, role_title, topic, message, referrer };

  // Business notification — block on this; if it fails we still return
  // success because the row is persisted.
  const businessResult = await sendResendEmail({
    to:      BUSINESS_EMAIL,
    subject: `Contact ${referenceId} — ${name}`,
    html:    buildBusinessEmailHtml(clean, referenceId),
    replyTo: email,
  });
  if (!businessResult.ok) console.error("Business contact email failed:", businessResult);

  // Buyer confirmation — best-effort.
  const buyerResult = await sendResendEmail({
    to:      email,
    subject: `Message received — ${referenceId}`,
    html:    buildBuyerEmailHtml(clean, referenceId),
  });
  if (!buyerResult.ok) console.error("Buyer contact email failed:", buyerResult);

  return jsonResponse({
    success:      true,
    referenceId:  insertedRow.reference_id,
    submittedAt:  insertedRow.created_at,
    userCopySent: buyerResult.ok,
    notificationSent: businessResult.ok,
  });
});
