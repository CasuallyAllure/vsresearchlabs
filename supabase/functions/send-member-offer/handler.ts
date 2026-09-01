// supabase/functions/send-member-offer/handler.ts
// Branded admin "member offer" email — the whole orchestration, Deno-free.
//
// Same shim/handler split as send-invite and send-prepared-cart: index.ts
// reads env once at cold start, wires the real requireAdmin + fetch + the
// service-role seams, and mounts the handler this factory returns under
// Deno.serve. NOTHING in this file may reference Deno globals or jsr:/npm:
// imports — that is what lets vitest drive every decision path directly
// (tests/unit/sendMemberOfferHandler.test.ts).
//
// ONE RECIPIENT PER CALL, deliberately. The admin panel loops with a throttle
// exactly as bulk invites already do (useInvites.bulkInvite), so a 300-member
// campaign is 300 short requests that can each be retried, rather than one
// long request that can time out halfway through with no record of where it
// stopped.
//
// CONSENT — this is marketing, the same category as 075's `winback` and the
// prepared-cart offer, so it gates on customer_profiles.marketing_opt_out and
// SAYS SO (200 + status:"opted_out") instead of reporting a success that never
// happened. The gate lives in admin_campaign_recipients (088) next to the
// column; this function reads its verdict and refuses.
//
// IDEMPOTENCY — insert-then-send against email_log (075), kind 'campaign',
// period_key = the admin's campaign key. UNIQUE (recipient, kind, period_key)
// is what stops a double-click, a re-run over the same list, or a member who
// appears twice in a filtered list from being mailed twice. A failed send
// RELEASES its claim (best effort) so a retry is possible — the send-prepared-
// cart rule: a human is watching this one.
//
// The offer itself is NOT created here. Discount codes are coupons (031/058)
// with their own admin surface, their own expiry and their own once-per-
// contact enforcement; this function only quotes the code in the email.

import { EMAIL_BRAND, RESEARCH_USE_DISCLAIMER } from "../_shared/emailBrand.ts";

const EMAIL_KIND = "campaign";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPAIGN_KEY_REGEX = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const CODE_REGEX = /^[A-Z0-9][A-Z0-9._-]{2,39}$/;
const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

/** The portal-profile opt-out pointer every MARKETING send must carry
 *  (mirrors member-automations/templates.ts's MANAGE_PREFERENCES_LINE). */
const MANAGE_PREFERENCES_LINE = "Manage email preferences in your account profile.";

interface OfferPayload {
  code?: unknown;
  percent?: unknown;
  expires_on?: unknown;
}

interface SendPayload {
  contact?: unknown;
  subject?: unknown;
  body?: unknown;
  campaign_key?: unknown;
  offer?: OfferPayload | null;
}

/** A validated offer line — a coupon that already exists (031/058). */
export interface OfferDetail {
  code: string;
  percent: number;
  expiresOn: string | null;
}

/** One row of admin_campaign_recipients(p_contact => …) (088). */
export interface CampaignRecipient {
  userId: string | null;
  name: string | null;
  contact: string;
  optOut: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "12 October 2026" — long form, because the deadline is the one thing in
 *  the mail that must not be misread across the Atlantic. */
export function formatOfferDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function buildOfferText(args: { body: string; offer: OfferDetail | null; catalogUrl: string }): string {
  const { body, offer, catalogUrl } = args;
  const parts = [body];
  if (offer) {
    const expires = formatOfferDate(offer.expiresOn);
    parts.push(
      [
        `Code: ${offer.code} — ${offer.percent}% off`,
        expires ? `Valid through ${expires}.` : null,
        "One use per account, entered at checkout.",
      ].filter(Boolean).join("\n"),
    );
  }
  parts.push(catalogUrl, MANAGE_PREFERENCES_LINE, RESEARCH_USE_DISCLAIMER);
  return parts.join("\n\n");
}

export function buildOfferHtml(args: {
  subject: string;
  body: string;
  offer: OfferDetail | null;
  catalogUrl: string;
}): string {
  const { subject, body, offer, catalogUrl } = args;
  const expires = offer ? formatOfferDate(offer.expiresOn) : "";
  const offerBlock = offer
    ? `
      <div style="margin-top:22px;border:1px solid #B5904B;border-radius:10px;padding:18px;text-align:center;background:#FFFDF8;">
        <div style="font-size:9.5px;letter-spacing:0.26em;text-transform:uppercase;color:#A0937E;font-weight:600;margin-bottom:8px;">${escapeHtml(String(offer.percent))}% off — one use per account</div>
        <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:22px;letter-spacing:0.14em;color:#1A1714;">${escapeHtml(offer.code)}</div>
        ${expires ? `<div style="font-size:11px;color:#6F665C;margin-top:8px;">Valid through ${escapeHtml(expires)}. Enter the code at checkout.</div>` : `<div style="font-size:11px;color:#6F665C;margin-top:8px;">Enter the code at checkout.</div>`}
      </div>`
    : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:640px;margin:0 auto;padding:28px 14px;">

    <div style="height:3px;background:#B5904B;width:180px;margin:0 auto 22px;font-size:0;line-height:0;">&nbsp;</div>
    <div style="text-align:center;margin:0 0 28px;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${escapeHtml(EMAIL_BRAND.name)}" width="68" height="68" style="display:inline-block;width:68px;height:68px;margin-bottom:14px;border:0;" />
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;letter-spacing:0.02em;color:#1A1714;margin-bottom:5px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A0937E;font-weight:600;">${escapeHtml(EMAIL_BRAND.tagline)}</div>
    </div>

    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">
      <div style="font-size:14px;color:#1A1714;line-height:1.65;white-space:pre-wrap;">${escapeHtml(body)}</div>
      ${offerBlock}
      <div style="text-align:center;margin-top:26px;">
        <a href="${catalogUrl}" style="display:inline-block;background:#1A1714;color:#FBF9F4;text-decoration:none;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:14px 30px;border-radius:999px;font-weight:600;">Review the catalog</a>
      </div>
    </div>

    <p style="margin:20px 4px 8px;font-size:12px;color:#6F665C;line-height:1.6;">${MANAGE_PREFERENCES_LINE}</p>

    <div style="padding-top:22px;margin-top:24px;text-align:center;">
      <div style="height:1px;background:#B5904B;width:120px;margin:0 auto 18px;font-size:0;line-height:0;">&nbsp;</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:0.02em;color:#1A1714;margin-bottom:6px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A0937E;font-weight:600;margin-bottom:8px;">${escapeHtml(EMAIL_BRAND.tagline)} · ${escapeHtml(EMAIL_BRAND.siteHost)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A09689;">${RESEARCH_USE_DISCLAIMER}</div>
    </div>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

export interface SendMemberOfferConfig {
  resendApiKey: string;
  fromEmail: string;
  corsHeaders: Record<string, string>;
}

/** Structural mirror of ../_shared/adminGate.ts's AdminGateResult (that module
 *  imports supabase-js from jsr:, so it can only be referenced from the shim). */
export interface AdminGateResult {
  ok: boolean;
  status: number;
  body?: { error: string };
}

export interface SendMemberOfferDeps {
  requireAdmin: (req: Request) => Promise<AdminGateResult>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** admin_campaign_recipients(p_contact => …) (088), as the calling admin. */
  loadRecipient: (req: Request, contact: string) => Promise<CampaignRecipient | null>;
  /** Insert the email_log claim. `false` = UNIQUE conflict = already sent. */
  claimSend: (args: { userId: string | null; recipient: string; periodKey: string; metadata: Record<string, unknown> }) => Promise<boolean>;
  /** Undo a claim whose send then failed. Best effort — never throws upward. */
  releaseSend: (args: { recipient: string; periodKey: string }) => Promise<void>;
}

/** Validated request, or the message explaining why it is not one. */
function parseOffer(raw: OfferPayload | null | undefined): { offer: OfferDetail | null; error?: string } {
  if (raw === null || raw === undefined) return { offer: null };
  const code = String(raw.code ?? "").trim().toUpperCase();
  if (!CODE_REGEX.test(code)) return { offer: null, error: "Offer code must be 3–40 characters (letters, digits, . _ -)." };
  const percent = Number(raw.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    return { offer: null, error: "Offer percent must be a whole number between 1 and 100." };
  }
  const expiresRaw = String(raw.expires_on ?? "").trim();
  if (expiresRaw && !/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw)) {
    return { offer: null, error: "Offer expiry must be a YYYY-MM-DD date." };
  }
  return { offer: { code, percent, expiresOn: expiresRaw || null } };
}

export function createSendMemberOfferHandler(
  cfg: SendMemberOfferConfig,
  deps: SendMemberOfferDeps,
): (req: Request) => Promise<Response> {
  const { requireAdmin, fetch, loadRecipient, claimSend, releaseSend } = deps;
  const CORS_HEADERS = cfg.corsHeaders;

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  async function sendResendEmail(args: { to: string; subject: string; html: string; text: string }):
    Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.fromEmail, to: args.to, subject: args.subject, html: args.html, text: args.text,
        reply_to: EMAIL_BRAND.opsEmail,
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
    if (!cfg.resendApiKey)     return jsonResponse({ error: "Email service not configured." }, 500);

    let payload: SendPayload;
    try { payload = (await req.json()) as SendPayload; }
    catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

    const contact     = String(payload?.contact ?? "").trim().toLowerCase();
    const subject     = String(payload?.subject ?? "").trim();
    const body        = String(payload?.body ?? "").trim();
    const campaignKey = String(payload?.campaign_key ?? "").trim().toLowerCase();

    if (!EMAIL_REGEX.test(contact))          return jsonResponse({ error: "A valid contact email is required." }, 400);
    if (!subject)                            return jsonResponse({ error: "Subject is required." }, 400);
    if (subject.length > SUBJECT_MAX)        return jsonResponse({ error: `Subject must be ${SUBJECT_MAX} characters or fewer.` }, 400);
    if (!body)                               return jsonResponse({ error: "Message body is required." }, 400);
    if (body.length > BODY_MAX)              return jsonResponse({ error: `Message must be ${BODY_MAX} characters or fewer.` }, 400);
    // The campaign key IS the idempotency period. No key, no send — an
    // unkeyed campaign would re-mail everyone on the next click.
    if (!CAMPAIGN_KEY_REGEX.test(campaignKey)) {
      return jsonResponse({ error: "A campaign key of 3–64 characters (lowercase letters, digits, . _ -) is required." }, 400);
    }

    const { offer, error: offerError } = parseOffer(payload?.offer);
    if (offerError) return jsonResponse({ error: offerError }, 400);

    let recipient: CampaignRecipient | null;
    try { recipient = await loadRecipient(req, contact); }
    catch (e) {
      console.error("Campaign recipient lookup failed:", e);
      return jsonResponse({ error: "Could not read that member." }, 502);
    }

    // Members only: this list is the member roster, and a campaign to someone
    // who never signed up belongs in the invite flow, not here.
    if (!recipient) return jsonResponse({ error: "That address is not a member." }, 404);

    // CONSENT. 200, not an error: nothing went wrong, we chose not to send.
    if (recipient.optOut) {
      return jsonResponse({ ok: false, status: "opted_out", recipient: contact }, 200);
    }

    const metadata = {
      campaign_key: campaignKey,
      subject,
      offer_code: offer?.code ?? null,
      offer_percent: offer?.percent ?? null,
    };

    let claimed: boolean;
    try {
      claimed = await claimSend({ userId: recipient.userId ?? null, recipient: contact, periodKey: campaignKey, metadata });
    } catch (e) {
      console.error("Campaign email claim failed:", e);
      return jsonResponse({ error: "Could not record the send." }, 502);
    }
    if (!claimed) return jsonResponse({ ok: false, status: "already_sent", recipient: contact }, 200);

    const catalogUrl = `${EMAIL_BRAND.siteUrl}/catalog`;
    const result = await sendResendEmail({
      to: contact,
      subject,
      html: buildOfferHtml({ subject, body, offer, catalogUrl }),
      text: buildOfferText({ body, offer, catalogUrl }),
    });

    if (!result.ok) {
      console.error("Campaign email failed:", result);
      try { await releaseSend({ recipient: contact, periodKey: campaignKey }); }
      catch (e) { console.error("Campaign claim release failed (non-fatal):", e); }
      return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
    }

    return jsonResponse({ ok: true, status: "sent", recipient: contact, kind: EMAIL_KIND, campaignKey }, 200);
  };
}
