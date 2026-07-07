// supabase/functions/_shared/emailBrand.ts
//
// Central brand identity for every email/HTML surface the edge functions
// render. Each value reads a Supabase secret first and falls back to the
// EXACT string the templates shipped with, so an unconfigured project sends
// byte-for-byte identical output to before this file existed.
//
// White-label client projects MUST set these secrets (see
// docs/WHITE_LABEL_GUIDE.md → Environment & secrets):
//   EMAIL_BRAND_NAME       display name in email bodies/subjects
//   EMAIL_BRAND_TAGLINE    region/positioning line under the name
//   EMAIL_BRAND_SIGNATURE  signature entity in email footers
//   EMAIL_LOGO_URL         hosted logo <img> used in email headers
//   EMAIL_OPS_EMAIL        operations mailbox referenced in terms copy
//   PUBLIC_SITE_URL        canonical site URL (host is derived for footers)
//
// Compliance/terms PROSE (research-use wording, purity guarantee, warehouse
// line) intentionally stays in the templates — it is per-client legal copy,
// reviewed and edited per deployment, not configuration.

function env(key: string, fallback: string): string {
  const v = Deno.env.get(key);
  return v && v.trim() ? v.trim() : fallback;
}

const SITE_URL_RAW = env("PUBLIC_SITE_URL", "https://vsresearchlabs.com").replace(/\/+$/, "");

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

export const EMAIL_BRAND = {
  /** Display name in email bodies, subjects, alt text, and HTML pages. */
  name: env("EMAIL_BRAND_NAME", "VS Research Labs"),
  /** Region/positioning line rendered under the brand name. */
  tagline: env("EMAIL_BRAND_TAGLINE", "Northern California Biopeptide Sciences"),
  /** Signature entity in notification footers. */
  signature: env("EMAIL_BRAND_SIGNATURE", "Velari Systems Research Labs"),
  /** Hosted logo PNG for email headers (email clients strip SVG). */
  logoUrl: env("EMAIL_LOGO_URL", "https://vsresearchlabs.pages.dev/brand/vs-dna-s-full-colour.png"),
  /** Operations mailbox referenced inside terms/guarantee copy. */
  opsEmail: env("EMAIL_OPS_EMAIL", "ops@vsresearchlabs.com"),
  /** Canonical site URL (no trailing slash) and its bare host for footers. */
  siteUrl: SITE_URL_RAW,
  siteHost: hostOf(SITE_URL_RAW),
};
