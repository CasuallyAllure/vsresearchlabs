// supabase/functions/member-automations/templates.ts
// Email composition for the five automation kinds — pure functions, Deno-free
// (EMAIL_BRAND reads Deno.env at module load, shimmed under vitest exactly as
// send-invite/handler.ts's import is).
//
// Copy register: factual, quiet, research-supply. No consumer-retail
// enthusiasm, no health claims, no urgency, no discount bait. The winback
// template is the ONLY marketing kind and therefore always carries the
// "Manage email preferences in your account profile" line — the portal
// profile owns customer_profiles.marketing_opt_out (075).
//
// URLs are always built from EMAIL_BRAND.siteUrl (PUBLIC_SITE_URL secret,
// canonical-domain fallback) — never a runtime origin, so a dev/staging run
// can never leak localhost into a customer email (same rule as composeInvite).

import { EMAIL_BRAND, RESEARCH_USE_DISCLAIMER } from "../_shared/emailBrand.ts";

export type AutomationKind =
  | "reward_ready"
  | "invite_followup"
  | "winback"
  | "discount_expiry"
  | "welcome"
  | "review_request"
  | "referral_bonus";

/** Evaluation order is fixed so run reports are stable and diffable. */
export const AUTOMATION_KINDS: AutomationKind[] = [
  "reward_ready",
  "invite_followup",
  "winback",
  "discount_expiry",
  "welcome",
  "review_request",
  "referral_bonus",
];

export function isAutomationKind(value: string): value is AutomationKind {
  return (AUTOMATION_KINDS as string[]).includes(value);
}

/** One candidate as automation_candidates(p_kind) returns it (flat jsonb). */
export interface AutomationCandidate {
  userId: string | null;
  recipient: string;
  periodKey: string;
  points?: number;         // reward_ready
  pointsPromised?: number; // invite_followup
  label?: string;          // discount_expiry
  percent?: number;        // discount_expiry, referral_bonus
  expiresOn?: string;      // discount_expiry, referral_bonus (YYYY-MM-DD)
  orderNumber?: string;    // review_request
  name?: string;           // review_request (display name, never the email)
  /** review_request: the order's lookup_token. A BEARER SECRET — the runner
   *  strips it before writing email_log.metadata. */
  token?: string;
  code?: string;           // referral_bonus
}

export interface AutomationEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Shared branded chrome — the send-invite masthead/footer register, reduced
 *  to what an automated notice needs. Paragraphs are pre-escaped here. */
function buildHtml(args: { subject: string; paragraphs: string[]; ctaLabel: string; ctaUrl: string }): string {
  const { subject, paragraphs, ctaLabel, ctaUrl } = args;
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;color:#1A1714;line-height:1.65;">${escapeHtml(p)}</p>`)
    .join("\n      ");
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
      ${body}
      <div style="text-align:center;margin-top:26px;">
        <a href="${ctaUrl}" style="display:inline-block;background:#1A1714;color:#FBF9F4;text-decoration:none;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;padding:14px 30px;border-radius:999px;font-weight:600;">${escapeHtml(ctaLabel)}</a>
      </div>
    </div>

    <div style="padding-top:22px;margin-top:24px;text-align:center;">
      <div style="height:1px;background:#B5904B;width:120px;margin:0 auto 18px;font-size:0;line-height:0;">&nbsp;</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:0.02em;color:#1A1714;margin-bottom:6px;">${escapeHtml(EMAIL_BRAND.name)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A0937E;font-weight:600;margin-bottom:8px;">${escapeHtml(EMAIL_BRAND.tagline)} · ${escapeHtml(EMAIL_BRAND.siteHost)}</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A09689;">${RESEARCH_USE_DISCLAIMER}</div>
    </div>
  </div>
</body></html>`;
}

function compose(subject: string, paragraphs: string[], ctaLabel: string, ctaUrl: string): AutomationEmail {
  return {
    subject,
    html: buildHtml({ subject, paragraphs, ctaLabel, ctaUrl }),
    text: `${paragraphs.join("\n\n")}\n\n${ctaUrl}\n\n${RESEARCH_USE_DISCLAIMER}`,
  };
}

const ACCOUNT_URL = `${EMAIL_BRAND.siteUrl}/account`;
const CATALOG_URL = `${EMAIL_BRAND.siteUrl}/catalog`;

/** The portal-profile opt-out pointer every MARKETING send must carry. */
export const MANAGE_PREFERENCES_LINE = "Manage email preferences in your account profile.";

export function buildAutomationEmail(kind: AutomationKind, c: AutomationCandidate): AutomationEmail {
  switch (kind) {
    case "reward_ready": {
      const points = c.points ?? 0;
      return compose(
        "Your reward credit is available",
        [
          `Your ${EMAIL_BRAND.name} account holds ${points.toLocaleString()} reward points, which meets the 300-point redemption threshold.`,
          "A reward credit can be redeemed from your account portal whenever you choose. It applies to one catalog item per redemption (laboratory equipment excluded).",
        ],
        "View your account",
        ACCOUNT_URL,
      );
    }
    case "invite_followup": {
      const points = c.pointsPromised ?? 0;
      const signupUrl = `${EMAIL_BRAND.siteUrl}/account?mode=signup&email=${encodeURIComponent(c.recipient)}`;
      return compose(
        `Reminder: your account invitation at ${EMAIL_BRAND.name}`,
        [
          points > 0
            ? `A short reminder from ${EMAIL_BRAND.name}: ${points.toLocaleString()} reward points from your previous orders remain unclaimed.`
            : `A short reminder from ${EMAIL_BRAND.name}: the account invitation we sent you is still open.`,
          "Create your account with this email address and everything is linked automatically. This is the only reminder we will send for this invitation.",
        ],
        "Create your account",
        signupUrl,
      );
    }
    case "winback":
      return compose(
        `Current catalog at ${EMAIL_BRAND.name}`,
        [
          `It has been a while since your last order with ${EMAIL_BRAND.name}. Our current research catalog, including recently cataloged compounds, is available for review.`,
          MANAGE_PREFERENCES_LINE,
        ],
        "Review the catalog",
        CATALOG_URL,
      );
    case "discount_expiry": {
      const label = c.label ?? "account discount";
      const percent = c.percent ?? 0;
      const expiresOn = c.expiresOn ?? "";
      return compose(
        `Your account discount expires ${expiresOn}`,
        [
          `Your ${EMAIL_BRAND.name} account discount "${label}" (${percent}%) is scheduled to expire on ${expiresOn}.`,
          "Orders placed before that date have it applied automatically at checkout.",
        ],
        "View your account",
        ACCOUNT_URL,
      );
    }
    case "review_request": {
      // SERVICE feedback only. The copy names what is being asked about, and
      // deliberately does not invite anything about use of the material —
      // published third-party text describing an effect would be an
      // intended-use claim on a research-supply catalog.
      const orderNumber = c.orderNumber ?? "";
      const greeting = c.name ? `${c.name},` : "Hello,";
      return compose(
        orderNumber ? `How did order ${orderNumber} arrive?` : "How did your order arrive?",
        [
          greeting,
          `Your order${orderNumber ? ` ${orderNumber}` : ""} from ${EMAIL_BRAND.name} has been delivered. If you have a moment, rate how the order itself went — packing, transit time, documentation and communication.`,
          "The form takes about thirty seconds and asks about fulfilment only. Reviews are read before they are published.",
          MANAGE_PREFERENCES_LINE,
        ],
        "Rate this order",
        `${EMAIL_BRAND.siteUrl}/review?t=${encodeURIComponent(c.token ?? "")}`,
      );
    }
    case "referral_bonus": {
      const code = c.code ?? "";
      const percent = c.percent ?? 0;
      const expiresOn = c.expiresOn ?? "";
      return compose(
        "Your referral bonus code",
        [
          `Someone you referred to ${EMAIL_BRAND.name} opened an account and placed their first order — thank you.`,
          `Your bonus code is ${code}: an extra ${percent}% off one order, on top of the rate your account already carries.${expiresOn ? ` It is good through ${expiresOn}.` : ""}`,
          "Enter it at checkout.",
        ],
        "Review the catalog",
        CATALOG_URL,
      );
    }
    case "welcome":
      return compose(
        `Welcome to ${EMAIL_BRAND.name}`,
        [
          `Your ${EMAIL_BRAND.name} account is active. From your account portal you can review orders, invoices and shipment tracking in one place.`,
          "Account pricing is applied automatically at checkout, and every paid order accrues reward points ($1 = 1 point) toward reward credits.",
        ],
        "Open your account",
        ACCOUNT_URL,
      );
  }
}
