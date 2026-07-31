// supabase/functions/send-prepared-cart/handler.ts
// Branded "we built you a cart" email — the whole orchestration, Deno-free.
//
// Same shim/handler split as send-invite and place-order: index.ts reads env
// once at cold start, wires the real requireAdmin + fetch + the service-role
// database seam, and mounts the handler this factory returns under Deno.serve.
// NOTHING in this file may reference Deno globals or jsr:/npm: imports — that
// is the whole point of the split, and it is what lets vitest drive every
// decision path directly (tests/unit/sendPreparedCartHandler.test.ts).
//
// Admin-only: requires a valid session JWT for an active admin, exactly like
// send-invite (../_shared/adminGate.ts).
//
// ── WHY THE PLAINTEXT TOKEN IS IN THE REQUEST BODY ──────────────────────────
// 081 stores only sha256(token). The plaintext exists once, in the return value
// of admin_create_prepared_cart, in the admin's browser. It cannot be read back
// from anywhere, so the mail can only be composed from a request that carries
// it — there is no server-side path that could look it up. The function does
// NOT trust it: prepared_cart_email_payload (082) re-digests it and returns
// `token_ok`, and a mismatch is refused rather than mailed. A link that does
// not open is worse than no link, because the member spends a trip on a dead
// page — this whole workstream exists because one already did.
//
// ── CONSENT ─────────────────────────────────────────────────────────────────
// A prepared cart is an unsolicited commercial offer, the same category as
// 075's `winback` — the one automation kind gated on
// customer_profiles.marketing_opt_out. So it gates on the same column, and it
// SAYS SO (200 + status:"opted_out") rather than silently reporting success:
// the admin needs to know the member was not contacted so they can use a
// channel the member did agree to.
//
// ── IDEMPOTENCY, AND WHY THE CLAIM IS RELEASED ON FAILURE ───────────────────
// Insert-then-send, like member-automations: the email_log row (kind
// 'prepared_cart', period_key 'pc-<cart id>') is claimed BEFORE the send, and
// its UNIQUE (recipient, kind, period_key) is what stops a double-click from
// mailing twice.
//
// It DEPARTS from member-automations in one place, deliberately. That function
// runs on a cron with nobody watching, so a claimed-but-unsent row is correctly
// left behind as an audit trail. This one runs because a human pressed a
// button and is looking at the result: if Resend rejects the send, leaving the
// claim would make every retry answer "already sent" for a mail that never
// existed. So a failed send RELEASES its claim (best effort) and reports the
// failure. The claim still does its real job — it is held for the whole
// duration of the send, which is the window a double-click lives in.

import { EMAIL_BRAND, RESEARCH_USE_DISCLAIMER } from "../_shared/emailBrand.ts";

const EMAIL_KIND = "prepared_cart";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Two concatenated dash-stripped UUIDv4s — 081's token shape. */
const TOKEN_REGEX = /^[0-9a-f]{64}$/i;

interface SendPayload {
  cart_id: string;
  token: string;
}

export interface PreparedCartLine {
  sku: string;
  dose: string;
  quantity: number;
}

/** What prepared_cart_email_payload (082) returns. */
export interface PreparedCartEmailPayload {
  ok: boolean;
  reason?: string;
  user_id?: string | null;
  recipient?: string;
  display_name?: string | null;
  marketing_opt_out?: boolean;
  coupon_code?: string | null;
  note?: string | null;
  expires_at?: string;
  revoked?: boolean;
  expired?: boolean;
  token_ok?: boolean;
  lines?: PreparedCartLine[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "12 October 2026" — long form, because "10/12" is ambiguous across the
 *  Atlantic and this date is the one thing in the mail with a deadline. */
export function formatExpiry(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** "BPC-157 (10mg) × 2" — the SKU and dose exactly as stored, so what the
 *  member reads is what the claim will add. No prices: there are none to
 *  quote (081), and inventing one here would be the exact mistake the schema
 *  was shaped to prevent. */
export function describeLine(line: PreparedCartLine): string {
  const dose = line.dose ? ` (${line.dose})` : "";
  return `${line.sku}${dose} × ${line.quantity}`;
}

export function buildPreparedCartText(args: {
  greeting: string;
  lines: PreparedCartLine[];
  note: string | null;
  couponCode: string | null;
  expiresLabel: string;
  claimUrl: string;
}): string {
  const { greeting, lines, note, couponCode, expiresLabel, claimUrl } = args;
  const parts = [
    greeting,
    "",
    `We put a cart together for you at ${EMAIL_BRAND.name}.`,
    "",
    ...lines.map((l) => `  · ${describeLine(l)}`),
  ];
  if (note) parts.push("", note);
  if (couponCode) parts.push("", `Your code ${couponCode} is applied when you open the cart.`);
  parts.push(
    "",
    "Prices are worked out when you open the cart and again at checkout — nothing is locked in here, " +
      "and your account discount applies automatically.",
    "",
    `Open your cart: ${claimUrl}`,
    "",
    expiresLabel
      ? `This link works until ${expiresLabel}, and only for the account it was sent to.`
      : "This link works only for the account it was sent to.",
    "",
    `${EMAIL_BRAND.name} · ${EMAIL_BRAND.siteHost}`,
    RESEARCH_USE_DISCLAIMER,
  );
  return parts.join("\n");
}

/** Branded HTML — the same masthead/footer chrome as the invoice and invite
 *  mails (../_shared/invoiceEmail.ts, send-invite/handler.ts). */
export function buildPreparedCartHtml(args: {
  greeting: string;
  lines: PreparedCartLine[];
  note: string | null;
  couponCode: string | null;
  expiresLabel: string;
  claimUrl: string;
  subject: string;
}): string {
  const { greeting, lines, note, couponCode, expiresLabel, claimUrl, subject } = args;

  const lineRows = lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(26,23,20,0.07);font-size:13.5px;color:#1A1714;">${escapeHtml(
          `${l.sku}${l.dose ? ` · ${l.dose}` : ""}`,
        )}</td><td style="padding:8px 0;border-bottom:1px solid rgba(26,23,20,0.07);font-size:13.5px;color:#6F665C;text-align:right;white-space:nowrap;">× ${l.quantity}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:640px;margin:0 auto;padding:28px 14px;">

    <div style="height:3px;background:#B5904B;width:180px;margin:0 auto 22px;font-size:0;line-height:0;">&nbsp;</div>
    <div style="text-align:center;margin:0 0 28px;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${escapeHtml(EMAIL_BRAND.name)}" width="68" height="68" style="display:inline-block;width:68px;height:68px;margin-bottom:14px;border:0;" />
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;letter-spacing:0.02em;color:#1A1714;margin-bottom:5px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A0937E;font-weight:600;margin-bottom:18px;">${escapeHtml(EMAIL_BRAND.tagline)}</div>
      <span style="display:inline-block;border-top:1px solid #B5904B;border-bottom:1px solid #B5904B;padding:7px 24px;font-size:10px;letter-spacing:0.34em;text-transform:uppercase;color:#1A1714;font-weight:600;">Prepared Cart</span>
    </div>

    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">
      <p style="margin:0 0 14px;font-size:14px;color:#1A1714;line-height:1.65;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 18px;font-size:14px;color:#1A1714;line-height:1.65;">We put a cart together for you — here is what is in it:</p>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:18px;">${lineRows}</table>

      ${note ? `<p style="margin:0 0 18px;font-size:13.5px;color:#1A1714;line-height:1.65;white-space:pre-wrap;">${escapeHtml(note)}</p>` : ""}
      ${couponCode ? `<p style="margin:0 0 18px;font-size:13.5px;color:#1A1714;line-height:1.65;">Your code <strong style="font-family:ui-monospace,Menlo,monospace;letter-spacing:0.06em;">${escapeHtml(couponCode)}</strong> is applied when you open the cart.</p>` : ""}

      <p style="margin:0 0 20px;font-size:12.5px;color:#6F665C;line-height:1.6;">Prices are worked out when you open the cart and again at checkout — nothing is locked in here, and your account discount applies automatically.</p>

      <div style="text-align:center;margin-top:24px;">
        <a href="${claimUrl}" style="display:inline-block;background:#1A1714;color:#FBF9F4;text-decoration:none;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:14px 30px;border-radius:999px;font-weight:600;">Open your cart</a>
        <div style="font-size:11px;color:#6F665C;margin-top:10px;line-height:1.5;">${
          expiresLabel
            ? `This link works until ${escapeHtml(expiresLabel)}, and only for the account it was sent to.`
            : "This link works only for the account it was sent to."
        }</div>
      </div>
    </div>

    <p style="margin:20px 4px 8px;font-size:13px;color:#1A1714;line-height:1.6;">Questions, or want something changed? Simply reply to this email.</p>

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

export interface SendPreparedCartConfig {
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

export interface SendPreparedCartDeps {
  requireAdmin: (req: Request) => Promise<AdminGateResult>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** prepared_cart_email_payload (082), through the service-role client. */
  loadCart: (cartId: string, token: string) => Promise<PreparedCartEmailPayload | null>;
  /** Insert the email_log claim. `false` = UNIQUE conflict = already sent. */
  claimSend: (args: { userId: string | null; recipient: string; periodKey: string; metadata: Record<string, unknown> }) => Promise<boolean>;
  /** Undo a claim whose send then failed. Best effort — never throws upward. */
  releaseSend: (args: { recipient: string; periodKey: string }) => Promise<void>;
}

export function createSendPreparedCartHandler(
  cfg: SendPreparedCartConfig,
  deps: SendPreparedCartDeps,
): (req: Request) => Promise<Response> {
  const { requireAdmin, fetch, loadCart, claimSend, releaseSend } = deps;
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

    if (req.method !== "POST")   return jsonResponse({ error: "Method not allowed." }, 405);
    if (!cfg.resendApiKey)       return jsonResponse({ error: "Email service not configured." }, 500);

    let payload: SendPayload;
    try { payload = (await req.json()) as SendPayload; }
    catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

    const cartId = (payload?.cart_id ?? "").trim();
    const token  = (payload?.token ?? "").trim();
    if (!UUID_REGEX.test(cartId))  return jsonResponse({ error: "A cart id is required." }, 400);
    if (!TOKEN_REGEX.test(token))  return jsonResponse({ error: "A cart token is required." }, 400);

    let cart: PreparedCartEmailPayload | null;
    try { cart = await loadCart(cartId, token); }
    catch (e) {
      console.error("Prepared-cart lookup failed:", e);
      return jsonResponse({ error: "Could not read that cart." }, 502);
    }

    if (!cart || !cart.ok || !cart.recipient) {
      return jsonResponse({ error: "That cart could not be found." }, 404);
    }
    // The token is verified, not assumed: a mail carrying a link that does not
    // open costs the member a wasted trip to a dead page.
    if (cart.token_ok !== true) return jsonResponse({ error: "That token does not open this cart." }, 400);
    if (cart.revoked)           return jsonResponse({ error: "That cart has been revoked." }, 409);
    if (cart.expired)           return jsonResponse({ error: "That cart has already expired." }, 409);

    const lines = Array.isArray(cart.lines) ? cart.lines : [];
    if (lines.length === 0)     return jsonResponse({ error: "That cart has no lines to send." }, 409);

    // CONSENT. 200, not an error: nothing went wrong, we chose not to send. The
    // admin panel renders this distinctly and keeps the copyable link.
    if (cart.marketing_opt_out === true) {
      return jsonResponse({ ok: false, status: "opted_out", recipient: cart.recipient }, 200);
    }

    const recipient = cart.recipient;
    const periodKey = `pc-${cartId}`;
    const metadata  = { cart_id: cartId, lines: lines.length, coupon_code: cart.coupon_code ?? null };

    // Insert-then-send. The claim is the fence a double-click hits.
    let claimed: boolean;
    try {
      claimed = await claimSend({ userId: cart.user_id ?? null, recipient, periodKey, metadata });
    } catch (e) {
      console.error("Prepared-cart email claim failed:", e);
      return jsonResponse({ error: "Could not record the send." }, 502);
    }
    if (!claimed) {
      return jsonResponse({ ok: false, status: "already_sent", recipient }, 200);
    }

    const firstName = (cart.display_name ?? "").trim().split(/\s+/)[0] ?? "";
    const greeting = firstName ? `Hi ${firstName},` : "Hello,";
    const expiresLabel = formatExpiry(cart.expires_at);
    const claimUrl = `${EMAIL_BRAND.siteUrl}/account/prepared#t=${token}`;
    const subject = `Your prepared cart from ${EMAIL_BRAND.name}`;
    const note = (cart.note ?? "").trim() || null;
    const couponCode = (cart.coupon_code ?? "").trim() || null;

    const result = await sendResendEmail({
      to: recipient,
      subject,
      html: buildPreparedCartHtml({ greeting, lines, note, couponCode, expiresLabel, claimUrl, subject }),
      text: buildPreparedCartText({ greeting, lines, note, couponCode, expiresLabel, claimUrl }),
    });

    if (!result.ok) {
      console.error("Prepared-cart email failed:", result);
      // Release the claim so a retry is possible. Best effort: if THIS fails the
      // admin still gets the truth ("delivery failed") and the copyable link —
      // they are simply told to rebuild rather than retry.
      try { await releaseSend({ recipient, periodKey }); }
      catch (e) { console.error("Prepared-cart claim release failed (non-fatal):", e); }
      return jsonResponse({ error: "Email delivery failed.", detail: result.body }, 502);
    }

    return jsonResponse({ ok: true, status: "sent", recipient, kind: EMAIL_KIND, lines: lines.length });
  };
}
