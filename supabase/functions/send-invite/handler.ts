// supabase/functions/send-invite/handler.ts
// Branded admin "send invite" email — the whole orchestration, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (OPTIONS preflight, admin gate, method gate,
// missing-key 500, validation failures, points sanitization, Resend
// success/failure, exact response contracts) — same split as
// place-order/handler.ts. index.ts is now a thin Deno shim: it reads env
// once at cold start, wires the real requireAdmin + fetch, and mounts the
// handler this factory returns under Deno.serve. NOTHING in this file may
// reference Deno globals or jsr:/npm: imports — that is the whole point of
// the split. (requireAdmin is injected rather than imported because
// ../_shared/adminGate.ts imports supabase-js from jsr:, which tsc cannot
// resolve; the structural AdminGateResult below mirrors its exported shape.)
//
// Admin-composed subject/body (edited from CustomerInvite.tsx's
// composeInvite() draft) is sent as-is, wrapped in the same branded chrome
// as the invoice email (../_shared/invoiceEmail.ts), with a CTA button that
// deep-links straight to the signup form with the contact's email prefilled.
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts).

import { EMAIL_BRAND, RESEARCH_USE_DISCLAIMER } from "../_shared/emailBrand.ts";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

interface InvitePayload {
  contact: string;
  subject: string;
  body: string;
  points?: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Branded HTML — invoiceEmail.ts's wrapper chrome (masthead + footer),
 *  the admin-supplied body rendered pre-wrap, and a signup CTA. */
function buildInviteHtml(args: { contact: string; subject: string; bodyText: string; signupUrl: string }): string {
  const { contact, subject, bodyText, signupUrl } = args;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:640px;margin:0 auto;padding:28px 14px;">

    <!-- Editorial masthead — tasteful gold accents, serif wordmark -->
    <div style="height:3px;background:#B5904B;width:180px;margin:0 auto 22px;font-size:0;line-height:0;">&nbsp;</div>
    <div style="text-align:center;margin:0 0 28px;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${escapeHtml(EMAIL_BRAND.name)}" width="68" height="68" style="display:inline-block;width:68px;height:68px;margin-bottom:14px;border:0;" />
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;letter-spacing:0.02em;color:#1A1714;margin-bottom:5px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A0937E;font-weight:600;margin-bottom:18px;">${escapeHtml(EMAIL_BRAND.tagline)}</div>
      <span style="display:inline-block;border-top:1px solid #B5904B;border-bottom:1px solid #B5904B;padding:7px 24px;font-size:10px;letter-spacing:0.34em;text-transform:uppercase;color:#1A1714;font-weight:600;">Invitation</span>
    </div>

    <!-- Message card -->
    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">
      <div style="font-size:14px;color:#1A1714;line-height:1.65;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>

      <div style="text-align:center;margin-top:26px;">
        <a href="${signupUrl}" style="display:inline-block;background:#1A1714;color:#FBF9F4;text-decoration:none;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:14px 30px;border-radius:999px;font-weight:600;">Create your account</a>
        <div style="font-size:11px;color:#6F665C;margin-top:10px;line-height:1.5;">Sign up with ${escapeHtml(contact)} and your points are credited automatically.</div>
      </div>
    </div>

    <p style="margin:20px 4px 8px;font-size:13px;color:#1A1714;line-height:1.6;">Questions? Simply reply to this email.</p>

    <div style="padding-top:22px;margin-top:24px;text-align:center;">
      <div style="height:1px;background:#B5904B;width:120px;margin:0 auto 18px;font-size:0;line-height:0;">&nbsp;</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:0.02em;color:#1A1714;margin-bottom:6px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A0937E;font-weight:600;margin-bottom:8px;">${escapeHtml(EMAIL_BRAND.tagline)} · ${escapeHtml(EMAIL_BRAND.siteHost)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A09689;">${RESEARCH_USE_DISCLAIMER}</div>
    </div>
  </div>
</body></html>`;
}

function buildInviteText(args: { bodyText: string; signupUrl: string }): string {
  return `${args.bodyText}\n\n${args.signupUrl}`;
}

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

/** Env-derived configuration — index.ts reads Deno.env once at cold start
 *  and passes the resolved values here, preserving the old module-load
 *  semantics. */
export interface SendInviteHandlerConfig {
  resendApiKey: string;
  fromEmail: string;
  corsHeaders: Record<string, string>;
}

/** Structural mirror of ../_shared/adminGate.ts's AdminGateResult (that
 *  module imports supabase-js from jsr:, so it can only be referenced from
 *  the Deno shim). */
export interface AdminGateResult {
  ok: boolean;
  status: number;
  body?: { error: string };
}

/** Runtime seams. Destructured below under the exact names the body has
 *  always used (`fetch` deliberately shadows the global inside the
 *  factory). */
export interface SendInviteHandlerDeps {
  requireAdmin: (req: Request) => Promise<AdminGateResult>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Best-effort invite-funnel logging (service-role record_member_invite RPC,
   *  migration 070). Optional so unit tests can omit it; a logging failure is
   *  swallowed and NEVER fails the send. */
  recordInvite?: (args: { email: string; points: number }) => Promise<void>;
}

export function createSendInviteHandler(
  cfg: SendInviteHandlerConfig,
  deps: SendInviteHandlerDeps,
): (req: Request) => Promise<Response> {
  const RESEND_API_KEY = cfg.resendApiKey;
  const FROM_EMAIL      = cfg.fromEmail;

  const CORS_HEADERS = cfg.corsHeaders;

  const { requireAdmin, fetch, recordInvite } = deps;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function sendResendEmail(args: { to: string; subject: string; html: string; text?: string; replyTo?: string }):
  Promise<{ ok: boolean; status: number; body: unknown }> {
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

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const gate = await requireAdmin(req);
    if (!gate.ok) return jsonResponse(gate.body, gate.status);

    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
    if (!RESEND_API_KEY)       return jsonResponse({ error: "Email service not configured." }, 500);

    let payload: InvitePayload;
    try { payload = (await req.json()) as InvitePayload; }
    catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

    const contact = (payload.contact ?? "").trim();
    const subject = (payload.subject ?? "").trim();
    const body    = (payload.body ?? "").trim();
    const points  = typeof payload.points === "number" && Number.isFinite(payload.points) ? Math.max(0, Math.floor(payload.points)) : 0;

    if (!EMAIL_REGEX.test(contact)) return jsonResponse({ error: "A valid contact email is required." }, 400);
    if (!subject)                   return jsonResponse({ error: "Subject is required." }, 400);
    if (subject.length > SUBJECT_MAX) return jsonResponse({ error: `Subject must be ${SUBJECT_MAX} characters or fewer.` }, 400);
    if (!body)                      return jsonResponse({ error: "Message body is required." }, 400);
    if (body.length > BODY_MAX)     return jsonResponse({ error: `Message must be ${BODY_MAX} characters or fewer.` }, 400);

    const signupUrl = `${EMAIL_BRAND.siteUrl}/account?mode=signup&email=${encodeURIComponent(contact)}`;

    const html = buildInviteHtml({ contact, subject, bodyText: body, signupUrl });
    const text = buildInviteText({ bodyText: body, signupUrl });

    const result = await sendResendEmail({ to: contact, subject, html, text, replyTo: EMAIL_BRAND.opsEmail });

    if (!result.ok) {
      console.error("Invite email failed:", result);
      return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
    }

    // Record the invite for the funnel (migration 070). Best-effort: a logging
    // failure must never turn a delivered email into an error for the admin.
    if (recordInvite) {
      try {
        await recordInvite({ email: contact, points });
      } catch (e) {
        console.error("Invite logging failed (non-fatal):", e);
      }
    }

    return jsonResponse({ ok: true, contact, points });
  };
}
