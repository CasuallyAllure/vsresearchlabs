# VS Research Labs — Launch Execution Blueprint

**Date:** 2026-07-06 · **Scope:** full repo + production-config audit (3 parallel auditors: security, functionality, trust/a11y/perf) synthesized with the current design-system state.
**Branch context:** `feature/accounts-and-design-refresh` ([PR #7](https://github.com/CasuallyAllure/vsresearchlabs/pull/7)) carries the strict design refresh + customer accounts. This blueprint assumes that PR merges.

---

## 1. Executive Diagnosis

- **The core business loop works end-to-end.** Browse → product detail → add-to-inquiry (dose-safe via `variantProduct`) → place order → invoice email → `/track` → admin mark-paid → fulfill with stock decrement. No dead routes, no lorem, 404 handled, loading/error/empty states covered on every major surface.
- **Security architecture is genuinely sound.** RLS is enabled with tight policies on *every* table; admin gating is server-enforced (`is_admin()` SECURITY DEFINER), the order-enumeration leak was fixed in migration 022, inputs are validated and clamped server-side, HTML in emails is escaped, no `dangerouslySetInnerHTML`/`eval`.
- **The launch blockers are almost all configuration, not code:** `TURNSTILE_SECRET` unset (bot protection is currently a no-op), `VITE_ZELLE_HANDLE`/`VITE_PAYPAL_HANDLE` unset (buyers would see `[Set VITE_ZELLE_HANDLE]` on invoices), `.env` committed to git history, and a prod-DB check that `lookup_order_lines()` is really dropped.
- **The single biggest credibility gap is legal/trust pages:** `/privacy`, `/terms`, `/shipping` do not exist and the footer links to nothing. For a commercial research-supplies vendor this is the #1 "is this site real?" tell.
- **Design is now mostly coherent** after the strict refresh (governed `<Button>`/`<Field>`, gradient gold, muted teal, tamed motion, thin typography) — remaining debt: Contact still uses a local input style, and micro-text contrast (8–9px at ink/20–30) fails WCAG AA in spots.
- **Accessibility is 80% there:** labels, aria, reduced-motion, and scroll-lock are strong; modals lack focus traps and some meaningful text is too small/low-contrast.
- **One real UX inconsistency in checkout:** CartDrawer *requires* a full shipping address; CartPage doesn't. Same backend, two different bars.
- **Admin is comprehensive** (orders, inquiries, customers, inventory, stock log, audit, health, reports) — but still uses `window.confirm/prompt` in places, which silently no-op on iOS (a bug class that has bitten before).
- **Performance is in good shape:** route-level code splitting everywhere, three.js correctly lazy-loaded, SVG specimen art. Low-hanging fruit: hero JPG → WebP, lazy-import `CompoundVisualizerFrame`, trim font weights.
- **Do not change the business model.** The inquiry/invoice flow with manual payment verification is coherent, implemented, and appropriate — resist adding card checkout, subscriptions, or SaaS surface pre-launch.

---

## 2. Launch Priority Order

### 🔴 Must fix before launch
| # | Item | Type |
|---|------|------|
| B1 | Set `VITE_ZELLE_HANDLE` + `VITE_PAYPAL_HANDLE` (build env) and matching `ZELLE_HANDLE` secret in Supabase | Config |
| B2 | Set `TURNSTILE_SECRET` in Supabase Edge Function secrets (turns on bot protection that already exists in code) | Config |
| B3 | Verify in prod DB that `lookup_order_lines()` is dropped (migration 022) | Config check |
| B4 | Remove `.env` from git tracking/history | Hygiene |
| B5 | Create `/privacy`, `/terms`, `/shipping` pages + footer links | Code |
| B6 | Fix WCAG contrast failures: no meaningful text below 10px or below ~ink/45 | Code |
| B7 | Align CartDrawer ↔ CartPage checkout requirements | Code |
| B8 | End-to-end smoke test on prod: order → invoice email → track → mark paid → fulfill | QA |

### 🟠 Should fix soon (week 1–2 post-launch)
- Focus traps on CartDrawer / NavDrawer / IntroModal / overlays.
- Origin/Referer validation + IP-based rate limiting in the three public edge functions.
- Replace remaining admin `window.confirm/prompt` with the in-app modal (pattern already exists in `OrderView.tsx`).
- Propagate the premium `<Field>` input to the Contact form (still uses a local copy).
- `/about` page (company story, warehouses, compliance stance).
- Hero JPG → WebP; lazy-import `CompoundVisualizerFrame`; trim Google Fonts weights.
- Audit-log DELETE-block trigger; admin "revoke invoice link" (regenerate `lookup_token`).

### ⚪ Later / do not build yet
See §7.

---

## 3. Professional Redesign Direction

**Direction is already locked** (repo-root `DESIGN.md`): cream-editorial, gold-gradient primary actions, muted teal secondary, serif display + Inter body + mono identifiers, two radii (4px modules / 24px editorial), color-only hovers, motion limited to one-time intros. The remaining work is *applying* it to the last stragglers, not inventing anything new.

- **Homepage:** keep the real 3D molecule + compound-intelligence modules (they are the differentiator and now calm). No new sections. Ensure the two disabled social buttons either link somewhere real or are removed for launch.
- **Product listing (catalog + category pages):** already consistent post-refresh (4px cards, solid stock pips, breathing mobile filter). Only remaining task: bump sub-10px meaningful text (family labels, tier chips) to ≥10px where it carries information.
- **Product detail:** structure is good (sticky reference column + module stack). Keep. Verify tier picker and Add button read correctly in dark mode.
- **Inquiry (cart page + drawer):** one form standard (B7): name + contact + address block, address optional-but-encouraged on both, saved to localStorage, auto-filled for logged-in customers from `customer_profiles`.
- **Contact:** swap local `Field` for the shared premium `<Field>`; keep warehouse/em­ail trust block.
- **Policy pages (new):** one shared `PolicyPage` layout — eyebrow, serif title, prose at `max-w-[64ch]`, `text-[14px] leading-relaxed`, mono section numbers. Quiet, institutional, zero decoration. Footer gets a second row: Privacy · Terms · Shipping · Contact · About.
- **Admin:** no visual work for launch beyond replacing native dialogs (function over form here).

---

## 4. Functionality Fix Plan

### F1 — Checkout parity (B7)
Make CartPage and CartDrawer collect the same fields with the same validation. Recommended bar: name + contact required; address block present on both, required only when the cart contains physical goods (i.e., always, in practice — but keep the server accepting partial for admin-created orders). Persist buyer info to localStorage; prefill from `customer_profiles` when signed in.
**Files:** `src/pages/CartPage.tsx`, `src/layout/CartDrawer.tsx` (extract a shared `CheckoutFields` component + `useCheckoutForm` hook).
**Accept:** both paths render identical fields; submitting from either produces an order with an address; refresh restores typed values; signed-in user sees address prefilled.

### F2 — Policy pages (B5)
`src/pages/policies/Privacy.tsx`, `Terms.tsx`, `Shipping.tsx` + shared `PolicyLayout`. Routes in `App.tsx`; links in `GlobalFooter`. Content: plain-English, honest (research-use-only terms, no-medical-claims, shipping expectations, refund/replacement policy for damaged goods, privacy = what's collected [contact, order, account data via Supabase], no sale of data). Mark drafts for owner review — do not invent legal guarantees.
**Accept:** all three routes render, footer links work, sitemap includes them, RouteMeta titles set.

### F3 — Contrast pass (B6)
Sweep for `text-[8px]`–`text-[9.5px]` and opacities ≤ ink/40 on *meaningful* content (footer RUO line, stock pip labels, tier chips, table cells). Floor: 10px and ~ink/50 for anything a buyer must read; decorative eyebrows may stay lighter.
**Accept:** RUO footer line ≥10px @ ≥ink/50; tier chips ≥9px only if pure duplicates of adjacent text, else 10px; spot-check passes at AA with a contrast checker.

### F4 — Admin native dialogs
Replace `window.confirm/prompt` in `AdminInventory.tsx`, `AdminEdit.tsx`, `AdminStatModules.tsx`, `OrderView.tsx` (2 remaining) with the existing in-app ConfirmModal pattern (`OrderView.tsx:984–1050`).
**Accept:** grep for `window.confirm|window.prompt` under `src/` returns 0; cancel/delete/import flows work on iPhone.

### F5 — Focus traps
Add a small `useFocusTrap` hook (or `focus-trap-react`) to CartDrawer, NavDrawer, IntroModal, CompoundIntelligenceOverlay, BiopeptideInventoryModal.
**Accept:** Tab cycles inside an open modal; Shift+Tab wraps; ESC still closes; focus returns to the trigger on close.

### F6 — Perf quick wins
WebP the hero JPG (+`<picture>` fallback), `lazy()` the `CompoundVisualizerFrame` import in Landing, cut Google Fonts to used weights.
**Accept:** Landing transfers measurably less on first paint; molecule still renders; no FOUT regressions.

---

## 5. Security Hardening Plan

**Verdict from audit: architecture sound; risks are config + abuse-hardening.** Full RLS table matrix confirmed clean (all tables RLS-enabled, admin-gated writes, service-role inserts only).

| # | Risk | Task | Acceptance |
|---|------|------|------------|
| S1 | Bot spam — Turnstile is a no-op without secret | Set `TURNSTILE_SECRET` (Supabase → Edge Functions → secrets). Frontend already sends tokens. | Submitting any public form without a valid token is rejected; forms work normally in browser |
| S2 | `.env` in git history with anon key | `git rm --cached .env`; confirm `.gitignore` covers it; rotate nothing (anon key is public-by-design) but keep history awareness | `git ls-files | grep .env` empty; fresh clone builds from `.env.example` |
| S3 | Order enumeration | Run in prod SQL: `select proname from pg_proc where proname='lookup_order_lines';` → 0 rows | Verified + screenshot in ops notes |
| S4 | Cross-site form posts | Add Origin/Referer check against `ALLOWED_ORIGIN` in `place-order`, `send-inquiry`, `send-contact` (reject 403 on mismatch, allow missing header for non-browser clients only if Turnstile passes) | curl with foreign Origin → 403; site forms unaffected |
| S5 | Per-contact rate limit bypass via many emails | IP-based limiter (Deno KV counter, e.g. 10/hr/IP) in the same three functions | 11th request from one IP in an hour → 429 |
| S6 | Client-supplied prices | Post-launch: server recomputes each line from `public_variant_overrides`; >10% drift → order flagged `pending_review` + admin note | Tampered price order arrives flagged, not invoiced |
| S7 | Leaked invoice token | Admin "Revoke & re-issue link" action (regenerate `lookup_token`, re-send email) | Old token 404s after revoke; new token works |
| S8 | Audit log deletable via direct DB | Migration: BEFORE DELETE trigger raising exception on `audit_log` | `delete from audit_log …` errors even as postgres role |

Already-safe (no action): RLS coverage, admin gating, HTML escaping in emails, generic client error messages, CORS headers, `rel="noopener"`, no secrets in source, robots.txt hygiene.

---

## 6. Implementation Tasks (scoped prompts for Claude Code / Sonnet)

Ordered; each is one session-sized, independently testable.

**T1 — Ops config (human + assistant together, 30 min):**
Set Cloudflare Pages build env: `VITE_ZELLE_HANDLE`, `VITE_PAYPAL_HANDLE`. Set Supabase function secrets: `TURNSTILE_SECRET`, confirm `ZELLE_HANDLE`, `RESEND_API_KEY`, `ALLOWED_ORIGIN`. Run S3 SQL check. Do `git rm --cached .env` + commit.
*Verify:* place a test order → invoice email shows real payment handles; form post without Turnstile token rejected.

**T2 — Policy pages:**
"Create `src/pages/policies/{Privacy,Terms,Shipping}.tsx` + shared `PolicyLayout.tsx` using the DESIGN.md editorial register (eyebrow / serif title / 64ch prose). Add lazy routes in `src/App.tsx`, footer links in `src/layout/GlobalFooter.tsx`, entries in `public/sitemap.xml`, titles in `RouteMeta`. Content drafts flagged `<!-- OWNER REVIEW -->`."
*Verify:* preview all three routes light+dark+mobile; footer links navigate.

**T3 — Checkout parity:**
"Extract shared `CheckoutFields` + `useCheckoutForm` (name, contact, address block, localStorage persistence) and use in both `CartPage.tsx` and `CartDrawer.tsx`; prefill from `customer_profiles` when authed. Do not change the `place-order` payload shape."
*Verify:* order from each path lands with address in admin; refresh restores form.

**T4 — Contrast + micro-type floor:**
"Raise meaningful sub-10px/low-opacity text to ≥10px & ≥ink/50 across GlobalFooter, ProductCard, CompactProductTile, ClassificationFilter, Landing tables. Leave decorative eyebrows. List every change."
*Verify:* screenshot pass; contrast spot-checks AA.

**T5 — Admin dialog replacement:**
"Replace all `window.confirm/prompt` under `src/pages/admin/` with the ConfirmModal pattern from `OrderView.tsx:984`. Grep must return zero after."
*Verify:* soft-delete + cancel-order flows in preview.

**T6 — Edge-function hardening (S4+S5):**
"In `place-order`, `send-inquiry`, `send-contact`: add Origin allow-list check + Deno KV IP rate limit (10/hr). Shared helper in `_shared/abuse.ts`. Keep responses generic."
*Verify:* curl matrix (good origin / bad origin / 11th request).

**T7 — Focus traps:**
"Add `useFocusTrap` hook; apply to CartDrawer, NavDrawer, IntroModal, CompoundIntelligenceOverlay, BiopeptideInventoryModal. Preserve existing ESC + scroll-lock."
*Verify:* keyboard-only walk in preview.

**T8 — Perf quick wins:**
"Convert `public/media/mots-c.jpg` → WebP w/ `<picture>`; lazy-import `CompoundVisualizerFrame` in `Landing.tsx` with a sized fallback (no CLS); trim `index.css` font import to used weights."
*Verify:* network panel before/after; molecule renders; `npm run build` clean.

**T9 — About page (fast follow):**
"Create `/about` in the same editorial register: what the company does, Sacramento/Vallejo operations, research-use-only stance, contact. No invented claims."

**T10 — Post-launch security (S6–S8):** server price validation, token revocation UI, audit-log immutability migration.

---

## 7. What NOT To Build Yet

- **Card/crypto checkout, Stripe** — manual verification is the model; revisit only with volume.
- **Paid memberships / subscription gating** — accounts Phase 1 just landed; let it bed in (waitlist flag already exists in schema).
- **Discount codes, balance-due, save-for-later** — tracked for the B2B rehearsal (~2026-06-17 notes), not launch.
- **Reviews/ratings, wishlists, comparison tools** — inquiry model doesn't need them.
- **Multi-warehouse/ERP inventory, barcode scanning** — current stock ops suffice.
- **Live chat, chatbots** — contact form + 1-day SLA is the promise; keep it keepable.
- **Blog/CMS** — `/documentation` + compound dossiers already carry content credibility.
- **Native app / PWA install prompts.**
- **Any new visual system** — DESIGN.md is locked; apply it, don't reinvent it.

---

## 8. Final Launch Checklist

**Config & data**
- [x] Payment handles — **Zelle-only launch** (2026-07-06): `ZELLE_HANDLE` secret = `info@velariss.co`; `PAYPAL_HANDLE` unset (PayPal renders only when configured); `VITE_ZELLE_HANDLE` in local `.env` (deploys are local builds — takes effect next build+deploy) (B1)
- [x] `TURNSTILE_SECRET` set (verified 2026-07-06; was set 2026-07-04) (B2/S1)
- [x] Prod probe confirms `lookup_order_lines` absent; `lookup_order` intact (2026-07-06) (S3)
- [x] `.env` never committed — verified against full git history (S2)
- [ ] Migrations applied through **028**; email-confirm ON; auth SMTP → Resend; redirect URLs include `/account`
- [ ] Pre-launch DB reset script run (wipe test data / zero inventory) — then real inventory seeded

**Product**
- [ ] `/privacy`, `/terms`, `/shipping` live + footer-linked (B5)
- [ ] Checkout parity shipped (B7)
- [ ] Contrast floor shipped (B6)
- [ ] PR #7 merged; `npm run build` green; deploy previews checked light+dark+mobile

**End-to-end proof (prod, real dollar-zero test)**
- [ ] Place order → buyer invoice + business notification arrive, branded, correct handles
- [ ] `/track` works via ZIP mode **and** token link; "I've sent payment" advances status
- [ ] Admin (on iPhone): review order → mark paid → fulfill w/ tracking → shipment email arrives; stock decremented
- [ ] Contact form → inbox + confirmation email
- [ ] Sign up → confirmation email → confirm → `/account` shows profile; guest order claimed by email
- [ ] 404, empty cart, wrong-ZIP lookup all show branded states

**Ops**
- [ ] `/admin/system-health` green; know where edge-function logs live
- [ ] `.env.example` current (it is — includes all the above)
- [ ] Owner has reviewed policy-page drafts

---

*When every box in Config, Product, and End-to-end proof is checked, VS Research Labs is ready to go live.*
