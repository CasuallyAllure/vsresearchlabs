# Client Bootstrap Checklist

Step-by-step to stand up a new client site from this framework. Companion to
[WHITE_LABEL_GUIDE.md](./WHITE_LABEL_GUIDE.md). Work top to bottom; don't skip
the verification block.

## 1. Repo

- [ ] Clone this repo into a **new repository** for the client (new remote).
- [ ] Do NOT rebrand the VS Research Labs repo in place.
- [ ] Delete `.env` if it came along (it shouldn't — it's gitignored).

## 2. Brand config (TypeScript)

- [ ] Copy `templates/client-config.example.ts` → `src/config/clients/<client>.ts`.
- [ ] Fill in every field (brand, seo, contact, compliance, order, storage).
- [ ] Point `src/config/index.ts` at the new profile.
- [ ] `npm run build` — must pass before continuing.

## 3. Assets

- [ ] Replace contents of `public/brand/` (logo SVGs/PNG) — keep filenames.
- [ ] Replace `public/favicon.svg` and `public/brand-stamp.svg`.
- [ ] Replace the OG image referenced in `index.html`.
- [ ] Replace or rework `src/components/brand/DnaVMark.tsx` (the animated
      mark is VSR's DNA identity — a new client needs their own mark component
      or a static logo here).
- [ ] Replace product/specimen art in `public/specimens/` and `public/media/`
      as needed.

## 4. Static head & SEO files (cannot read siteConfig)

- [ ] `index.html`: `<title>`, meta description, OG/Twitter tags, JSON-LD
      Organization block, canonical domain, **theme key in the boot script**
      (must equal `storage.themeKey` in the config profile).
- [ ] `public/sitemap.xml`: new domain + routes.
- [ ] `public/robots.txt`: new sitemap URL.
- [ ] `public/site.webmanifest`: name/short_name/icons.

## 5. Theme

- [ ] Edit CSS variables in `src/theme/theme.css` (`:root` light block and
      `html[data-theme="dark"]` dark block). Never hardcode hex in components
      or `tailwind.config.js`.
- [ ] Fonts: update families in `tailwind.config.js` + font `<link>`s in
      `index.html` if the client's typography differs.

## 6. Catalog & content

- [ ] Replace `src/data/products.json` with the client's catalog (keep the
      `Product` shape — see `src/types/product.ts`).
- [ ] Replace `src/data/documents.json` (certificates/docs) or empty it.
- [ ] If the biopeptide generator doesn't apply: remove the
      `biopeptideCompounds.generated.json` merge in `src/stores/productStore.ts`.
- [ ] Rewrite homepage copy: `src/pages/Landing.tsx` + landing components.
- [ ] Rewrite legal prose: `src/pages/legal/{About,Terms,Privacy,Shipping}.tsx`.
      **Owner/client must review all legal + compliance copy. Remove
      research-use-only language if it doesn't apply to this business.**
- [ ] Review category routes (`/research-supplies/*`) and `RouteMeta.tsx`
      titles if the client's categories differ.

## 7. Backend (new Supabase project per client)

- [ ] Create a fresh Supabase project.
- [ ] Apply `supabase/migrations/*.sql` in numeric order.
- [ ] Deploy all functions in `supabase/functions/`.
- [ ] Set Supabase secrets (see `.env.example`): `RESEND_API_KEY`,
      `RESEND_FROM_EMAIL`, `INQUIRY_TO_EMAIL`, `ZELLE_HANDLE`, `PAYPAL_HANDLE`,
      `TURNSTILE_SECRET`, `ALLOWED_ORIGIN`, `PUBLIC_SITE_URL`,
      optional `BRAND_STAMP_URL`.
- [ ] Configure Supabase Auth email template
      (`supabase/auth-emails/confirm-signup.html`) with client branding.
- [ ] Create the first admin: Supabase user + row in `admin_users`.
- [ ] Resend: verify the client's sending domain before launch.

## 8. Environment (frontend)

- [ ] `.env` locally from `.env.example`.
- [ ] Host (e.g. Cloudflare Pages): set `VITE_SUPABASE_URL`,
      `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`,
      `VITE_ZELLE_HANDLE`, `VITE_PAYPAL_HANDLE`.
- [ ] Payment handles: frontend `VITE_*` values must match the Supabase
      secrets so on-screen and emailed instructions agree.

## 9. Verification (before announcing)

- [ ] `npm run build` and `npm run lint` pass.
- [ ] `grep -ri "vs research\|vsresearchlabs\|velari" src index.html public`
      returns nothing unintentional.
- [ ] Landing, catalog, product detail, cart, contact, track, legal pages render.
- [ ] Place a test order end-to-end: cart → checkout → buyer invoice email →
      business notification email → admin order view → mark paid → receipt.
- [ ] Contact form round-trip (Turnstile + email received).
- [ ] `/track` finds the test order; printable doc shows client branding.
- [ ] Admin login works; old VSR admin creds do NOT.
- [ ] Dark mode toggle works and persists.
- [ ] `ALLOWED_ORIGIN` locked to the live domain (not `*`).
- [ ] No secrets in the repo: `git log -p | grep -i "re_\|sk_\|service_role"`
      (or use a secret scanner).

## 10. Deploy

- [ ] Connect repo to the host (Cloudflare Pages: `npm run build`, output `dist`).
- [ ] Point DNS at the host; confirm HTTPS.
- [ ] Re-run the smoke tests in production.
