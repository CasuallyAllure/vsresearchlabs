# White-Label Framework Guide

This repo is both the **VS Research Labs production site** and a **reusable
white-label framework** for premium inquiry/order business sites. A new client
site is created by **copying this repo and configuring it** — not by rebuilding.

The active brand is decided in exactly one place:
[`src/config/index.ts`](../src/config/index.ts) exports `siteConfig`, a typed
[`SiteConfig`](../src/config/types.ts) profile. VS Research Labs' profile lives
at [`src/config/clients/vsresearchlabs.ts`](../src/config/clients/vsresearchlabs.ts);
a commented starter is at [`templates/client-config.example.ts`](../templates/client-config.example.ts).

## What the framework gives you

| Layer | Where it's configured |
|---|---|
| Brand name, wordmark, tagline, legal entity | `src/config/clients/<client>.ts` |
| Compliance/disclaimer lines (footer, nav, stamp, gate, documents) | `src/config/clients/<client>.ts` |
| Public inquiry email (display), order intake codes, tracking placeholder | `src/config/clients/<client>.ts` |
| localStorage namespacing | `src/config/clients/<client>.ts` |
| Colors (light + dark) | `src/theme/theme.css` (CSS variables; Tailwind binds to them — never hardcode hex) |
| Typography | `tailwind.config.js` font families + `index.html` font links |
| Logo / marks / favicon / OG image | `public/brand/*`, `public/favicon.svg`, `src/components/brand/*` |
| Catalog | `src/data/products.json` (+ optional generator `scripts/buildInventory.mjs`), Supabase overrides |
| Payment handles (Zelle/PayPal) | Env: `VITE_ZELLE_HANDLE` / `VITE_PAYPAL_HANDLE` (frontend) + `ZELLE_HANDLE` / `PAYPAL_HANDLE` (Supabase secrets) — keep them matching |
| Email sending (sender, inbox, API key) | Supabase secrets: `RESEND_FROM_EMAIL`, `INQUIRY_TO_EMAIL`, `RESEND_API_KEY`, optional `BRAND_STAMP_URL` |
| Backend | A **separate Supabase project per client**; replay `supabase/migrations/` in order, deploy `supabase/functions/` |
| SEO / social head tags | `index.html` (title, meta, OG, JSON-LD), `public/sitemap.xml`, `public/robots.txt`, `public/site.webmanifest` |
| Legal pages | `src/pages/legal/*` (prose — reviewed per client) |
| Homepage copy | `src/pages/Landing.tsx` + landing components |

## Creating a new client site

Follow [CLIENT_BOOTSTRAP_CHECKLIST.md](./CLIENT_BOOTSTRAP_CHECKLIST.md) — the
short version:

1. **Copy the repo** to a new repository (`git clone` → new remote). Never
   rebrand the VS Research Labs repo in place.
2. **Create the config profile**: copy `templates/client-config.example.ts`
   to `src/config/clients/<client>.ts`, fill it in, and point
   `src/config/index.ts` at it.
3. **Replace assets** in `public/brand/`, `public/favicon.svg`,
   `public/brand-stamp.svg`, and the OG image. Keeping the existing
   *filenames* means zero code changes (the names still say `vs-dna-*`; if you
   rename, grep for the old paths in `index.html`, `src/`, and
   `public/site.webmanifest`).
4. **Edit the non-TypeScript surfaces** (they cannot read `siteConfig`):
   `index.html` (title, meta description, OG/Twitter tags, JSON-LD, the
   `localStorage` theme key in the boot script), `public/sitemap.xml`,
   `public/robots.txt`, `public/site.webmanifest`.
5. **Reskin**: edit the CSS variables in `src/theme/theme.css` (`:root` =
   light, `html[data-theme="dark"]` = dark). Do not touch `tailwind.config.js`
   color bindings.
6. **Catalog**: replace `src/data/products.json` (and
   `src/data/documents.json`). If the client doesn't need the biopeptide
   generator, leave `biopeptideCompounds.generated.json` out of the seed merge
   in `src/stores/productStore.ts`.
7. **Legal + homepage prose**: rewrite `src/pages/legal/*` and
   `src/pages/Landing.tsx` copy. **Legal copy must be reviewed by the
   client/owner — never ship VS Research Labs' terms to another business.**
8. **New Supabase project**: run migrations in order, deploy edge functions,
   set the secrets listed in [`.env.example`](../.env.example).
9. **Env vars**: fill `.env` locally; set the `VITE_*` vars in the host
   (Cloudflare Pages) and the server vars in Supabase secrets.
10. **Verify** with the checklist's smoke tests, then deploy.

## Environment & secrets

`​.env.example` is the canonical, commented list. Summary:

- **Frontend (public, baked into the bundle)**: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_ZELLE_HANDLE`,
  `VITE_PAYPAL_HANDLE`.
- **Supabase secrets (server-only, never commit, never put in Cloudflare)**:
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `INQUIRY_TO_EMAIL`, `ZELLE_HANDLE`,
  `PAYPAL_HANDLE`, `BRAND_STAMP_URL` (optional), `TURNSTILE_SECRET`,
  `ALLOWED_ORIGIN` (set to the client's live origin before launch),
  `PUBLIC_SITE_URL`.

## What must never be hardcoded or committed

- **Never hardcode**: brand display strings (use `siteConfig`), hex colors
  (use theme variables), payment handles, email addresses used for sending,
  domains in edge functions.
- **Never commit**: `.env`, API keys, service-role keys, payment handles,
  customer data exports.

## Known limitations (intentionally deferred)

- **Edge-function fallbacks are still VSR-branded.** Every function reads
  `RESEND_FROM_EMAIL` etc. from env first, so a correctly configured client
  project sends correctly — but the *hardcoded fallbacks* and the invoice
  email template headings in `supabase/functions/_shared/invoiceEmail.ts`
  ("Northern California Biopeptide Sciences", Zelle recipient constant) still
  say VS Research Labs. Extracting those touches the live order-email path
  and needs owner approval + email round-trip testing.
- **SKU prefixes (`VSR-…`) live in catalog data**, not code. A new client's
  catalog simply uses their own prefixes; regenerating the VSR biopeptide
  data is not required.
- **`index.html` / sitemap / manifest are per-client files**, not templated —
  Vite would need an HTML-templating step for marginal benefit.
- **Brand asset filenames** still contain `vs-dna-*`; swapping file *contents*
  is the supported path.
- **RouteMeta section titles** ("Biopeptide Research Supplies", …) mirror the
  VSR category structure; a client with different categories edits
  `src/components/RouteMeta.tsx` and the category pages/routes together.
