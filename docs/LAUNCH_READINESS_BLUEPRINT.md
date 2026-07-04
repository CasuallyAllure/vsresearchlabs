# VS Research Labs — Launch-Readiness Execution Blueprint

_Audit date: 2026-07-02. Branch: `feature/accounts-and-design-refresh`. Produced from a five-track code audit (information architecture, catalog/order flow, admin/auth, backend security, design/mobile/a11y). Every claim below was verified against the repo; items that depend on live Supabase/Cloudflare state are marked **Needs verification**._

---

## 1. Executive Diagnosis

- **The core buyer journey works end-to-end.** Browse → product detail → cart (both drawer and `/cart`) → `place-order` edge function → buyer invoice email + business notification → token-gated `/track` invoice. Validation, rate limiting, Turnstile, loading/empty/error states are all implemented. This is not a demo; it is a functioning store.
- **The single biggest credibility gap is missing trust/legal pages.** There is no Privacy Policy, Terms, Shipping Policy, Returns Policy, About, or FAQ — no routes, no footer links. For a B2B research-supply company this is what makes serious buyers (and payment processors) walk away. The footer is beautiful but link-empty.
- **Admin backend security is genuinely strong** — every mutation is a `SECURITY DEFINER` RPC gated by `is_admin()`, no service-role key in the frontend, append-only audit log, atomic stock ops, route-level code splitting so admin JS never ships to visitors.
- **A small number of concrete security holes must be closed before launch:** the `mark_payment_claimed(uuid)` RPC is executable by `anon` with no token check (020:206); Turnstile verification **fails open** when `TURNSTILE_SECRET` is unset; edge-function CORS falls back to `*`; `place-order` trusts client-supplied line prices; `resolve-video` and `send-order-invoice` edge functions lack auth gates.
- **Order-number enumeration is already fixed** (migration 027, random `VSR-XXXXXX`), and the anon `lookup_order()` correctly returns status/tracking only — the remaining email+ZIP lookup is an accepted-risk residual, not a blocker.
- **Admin on iPhone has a known operational landmine:** `window.confirm`/`window.prompt` in `AdminEdit`, `AdminStatModules`, and `AdminInventory` silently no-op after iOS "Block Alerts" — actions appear to do nothing. `OrderView` already has the in-app `ConfirmModal` pattern to copy.
- **The design system is ~72/100 compliant with DESIGN.md.** Main violations: 27 hardcoded hex colors (26 of them in the 3D hologram palette + `BottomNav` constants, which break dark mode), 6 raw `<button>`s bypassing the Button primitive, 9 images with empty `alt`, and 1–3 icon-only buttons missing `aria-label`.
- **Two orphan pages undermine polish:** `/account` (the new customer portal) and `/catalog` are unreachable from any nav. `/documentation` sends mixed "coming soon" signals.
- **Deployment/config debt is the wildcard.** Whether migrations (esp. 028), `TURNSTILE_SECRET`, `ALLOWED_ORIGIN`, Resend domain, and Supabase email-confirm are applied/set on the live project **needs verification** — the code can be perfect and the deploy still unsafe.
- **Do not redesign.** The cream-editorial strict-flatten system (repo-root `DESIGN.md`) is locked, distinctive, and appropriate for a research-supply brand. What's needed is completion and enforcement, not a new direction.

---

## 2. Launch Priority Order

### Must fix before launch
1. **Security 5-pack** (see §5): revoke anon grant on `mark_payment_claimed`; Turnstile fail-closed + secret set; CORS locked to production origin; explicit write-revokes on `inquiries`/`contact_messages`; auth gates on `resolve-video` + `send-order-invoice`.
2. **Trust/legal pages + footer links:** `/privacy`, `/terms`, `/shipping`, `/about` (returns can fold into terms for an RUO business), linked from `GlobalFooter`.
3. **Admin iOS dialogs:** replace `window.confirm`/`prompt` in `AdminEdit.tsx`, `AdminStatModules.tsx`, `AdminInventory.tsx` with the in-app modal pattern from `OrderView.tsx`.
4. **Accessibility floor:** meaningful `alt` on product/cart/logo images (9 instances), `aria-label` on icon-only buttons (header menu/cart, cart remove ×).
5. **Orphan-page resolution:** add `/account` entry point to header/drawer (or hide the route until accounts ship); decide `/catalog` — link it or remove the route.
6. **Deploy/config verification:** all 28 migrations applied to production; `TURNSTILE_SECRET`, `ALLOWED_ORIGIN`, `RESEND_API_KEY` set; Supabase email-confirm enabled for customer signups; commit `supabase/auth-emails/confirm-signup.html` (currently untracked).

### Should fix soon (first 2 weeks after launch)
7. Hardcoded hex cleanup: `CompoundHologram3D.tsx` element palette + `BottomNav.tsx` constants → CSS-var-derived tokens (dark-mode correctness).
8. Migrate raw `<button>`s to the shared `<Button>` primitive (6 instances).
9. Server-side price verification in `place-order` (echo + mismatch flag now; authoritative server pricing when real pricing lands).
10. Font preload hints for Cormorant Garamond/Inter (LCP on landing).
11. Admin data-table mobile ergonomics (scroll affordance or card collapse for `AdminStockHistory`, `AdminAuditLog`, `AdminImport`).
12. `/track` UX: lead with token link path; keep email+ZIP as status-only fallback.
13. Sitemap: add `/account` (if public) and legal pages.

### Later / do not build yet
- Admin 2FA/MFA, idle-timeout, audit-log alerting.
- Documentation archive (keep sealed until real certificates exist — the current honest "Archive in preparation" treatment is correct).
- Customer accounts phase 2+ (perks, waitlist, paid tiers), save-for-later, discount codes, balance-due.
- Reports/analytics polish, customer CRM depth, bulk import UX.
- Expanded product catalog content (CAS/MW verification debt) — quality over quantity at launch.

---

## 3. Professional Redesign Direction

**Direction: keep and complete the locked system.** Cream-editorial, strict-flatten, 2-radius surfaces, shared Button primitive, gold/teal accents keyed to the DNA-mark category colors, mono-as-voice for operational copy, serif for mastheads. It already reads as a credible instrument-catalog aesthetic — rare and appropriate. The work is enforcement (kill hex stragglers, unify buttons) and completion (footer, legal pages, account entry), not reinvention.

Page-level:

- **Homepage (`Landing.tsx`):** Structure is strong (hero → procurement/records/sequence → catalog rows → S1–S4 → standards → CTA → disclaimer). Changes: (a) disabled TikTok/Instagram links look unfinished — remove until live, keep WhatsApp; (b) the blurred documentation gallery is honest but give the seal a one-line expected date or "available on request with order" so it reads as policy, not absence; (c) footer gains a compact legal-link row.
- **Product listing (biopeptide/nootropics/skincare/equipment):** Functionally solid. Add an explicit empty-state message ("No compounds match — clear filters") on the three research-supplies pages; keep filter behavior as is.
- **Product detail (`ProductPage.tsx`):** Best page on the site. Only fixes: real `alt` text on gallery images, and ensure the tier strip is obviously interactive on mobile (tap target ≥ 40px).
- **Inquiry page (`/cart`):** Keep the "Inquiry List / Procurement Intake" framing — it fits the business model. Migrate quantity/remove raw buttons to the Button primitive, add `aria-label` to the remove control, replace hardcoded status-badge hex with tokens.
- **Contact page:** Works. Convert the topic-selector raw buttons into a governed segmented-control usage of the Button primitive (ghost variant, `aria-pressed` kept).
- **Admin area:** No visual redesign. Fix the three dialog files, add empty-state rows to tables ("No orders yet"), and leave tables horizontally scrollable on phone with a visible scroll affordance.
- **New pages (privacy/terms/shipping/about):** One shared `LegalPage` layout — serif masthead, 64ch prose column, mono eyebrow, same footer. About = short: who (Velari Systems LLC, Northern California), what (research-grade supply, inquiry-led procurement), operating standards (reuse S1–S4 + documentation/traceability copy), contact block. No stock photos, no fake team grid.

---

## 4. Functionality Fix Plan

Verified working (no action): catalog filters/search, `effectiveTierPriceCents` everywhere, `variantProduct()` dose preservation, both carts → `place-order`, dual emails, token-gated `/track`, contact flow with reference IDs, admin order lifecycle RPCs.

Fixes with acceptance criteria:

| # | Flow | Fix | Acceptance criteria |
|---|------|-----|---------------------|
| F1 | Admin actions on iPhone | Replace `window.confirm`/`prompt` in `AdminEdit.tsx`, `AdminStatModules.tsx`, `AdminInventory.tsx` with in-app `ConfirmModal` (pattern at `OrderView.tsx:183–187`) | Zero `window.confirm|prompt|alert` matches under `src/pages/admin/`; delete/cancel/import actions show an in-app modal and complete on iOS Safari |
| F2 | Account discoverability | Add account entry point (header icon or NavDrawer "Account" row) OR gate `/account` behind a feature flag until launch decision | `/account` reachable in ≤2 taps from any page, or route hidden; no orphan |
| F3 | `/catalog` orphan | Link from NavDrawer ("Full Catalog") or delete the route | Route is either navigable or gone; sitemap matches |
| F4 | Legal pages | `/privacy`, `/terms`, `/shipping`, `/about` routed, lazy-loaded, linked in `GlobalFooter` and NavDrawer | All four render real content, footer links present on every page, routes in `sitemap.xml` |
| F5 | Empty states | Add empty-state message to the three research-supplies pages; empty-row states in admin tables | Emptying filters shows guidance text, not a blank region |
| F6 | Social links | Remove disabled TikTok/Instagram anchors from hero | No `aria-disabled` dead links in hero |
| F7 | Signup email template | Commit `supabase/auth-emails/confirm-signup.html`; wire into Supabase Auth email template (**needs verification** in dashboard) | Template in git; test signup delivers branded confirm email |
| F8 | Customer accounts phase 1 | Apply migration 028 to prod, enable email-confirm | New signup → confirm → profile row exists → own orders visible; guest checkout unaffected |

---

## 5. Security Hardening Plan

Risks found (verified against code; severities adjusted after checking migrations 020–028):

| # | Risk | Severity | Evidence |
|---|------|----------|----------|
| S1 | `mark_payment_claimed(uuid)` granted to `anon` with no token check — anyone with an order UUID can flip any order to `payment_claimed` | **CRITICAL** | `020_order_flow_rewrite.sql:206` |
| S2 | Turnstile fails **open** when `TURNSTILE_SECRET` unset → contact/inquiry/order endpoints become a spam cannon via Resend | **CRITICAL (config-dependent)** | `_shared/turnstile.ts:19–21` |
| S3 | Edge-function CORS falls back to `*` when `ALLOWED_ORIGIN` unset | HIGH | shared CORS helper; **needs verification** of prod env |
| S4 | `place-order` trusts client `unitPriceCents` (clamped, not verified) — a tampered request can create a 1-cent invoice | HIGH (mitigated by manual payment verification) | `place-order/index.ts:527` |
| S5 | No explicit write-deny on `inquiries`/`contact_messages` (relies on absent-policy default) | MEDIUM (defense-in-depth) | `002_inquiries.sql`, `006_contact_messages.sql` |
| S6 | `resolve-video` fetches attacker-supplied URLs (SSRF/quota abuse), no auth, no size cap/timeout | MEDIUM–HIGH | `resolve-video/index.ts:110–149` |
| S7 | `send-order-invoice` has no admin check — any caller can re-trigger invoice emails for arbitrary order IDs | MEDIUM | `send-order-invoice/index.ts:67–112` |
| S8 | Email+ZIP `lookup_order()` lets someone who knows a buyer's email+ZIP see status/tracking (fields correctly limited; order numbers already random per 027) | LOW–MEDIUM (accepted residual) | `021:16–60` |
| S9 | Validation errors echo schema details | LOW | `place-order`, `send-inquiry` |

Hardening tasks + acceptance criteria:

| Task | Acceptance criteria |
|------|---------------------|
| **H1.** Migration 029: `revoke execute on function mark_payment_claimed(uuid) from anon, authenticated;` (edge function uses service role and already token-gates) | Direct `supabase.rpc('mark_payment_claimed', …)` with anon key returns permission error; "I've sent payment" button on `/track` still works via the edge function |
| **H2.** Turnstile fail-closed: unset secret ⇒ `{ ok:false }` + 403; set `TURNSTILE_SECRET` in Supabase secrets | With secret removed in a test env, form posts are rejected; with secret set, normal submissions pass |
| **H3.** Set `ALLOWED_ORIGIN=https://vsresearchlabs.com`; remove `*` fallback in prod path | Cross-origin POST from another domain is rejected; site forms work |
| **H4.** Migration 029 (same file): explicit `revoke insert, update, delete on inquiries, inquiry_items, contact_messages from anon, authenticated;` | Direct PostgREST insert with anon key fails; edge-function inserts (service role) still succeed |
| **H5.** `resolve-video`: require admin JWT (verify caller in `admin_users`), whitelist `tiktok.com`/`vm.tiktok.com` redirect hosts, 5 MB thumbnail cap, `AbortSignal.timeout(10000)` | Anon call → 401; non-TikTok URL → 400; oversized/slow fetch aborts cleanly |
| **H6.** `send-order-invoice`: verify caller is admin before sending | Non-admin call → 401; admin re-send from OrderView still works |
| **H7.** `place-order` price echo: include each line's client price in the business notification with a "verify before invoicing" banner; log clamped/suspicious values | Business email shows per-line prices; an order with absurd prices is visibly flagged |
| **H8.** Generic validation errors client-facing; details to server logs only | Malformed payload → "Invalid request format."; details visible in function logs |

---

## 6. Implementation Tasks for Sonnet / Claude Code

Execute in order. Each is one small, testable change — one commit each.

**T1 — Migration 029: RPC + write-permission hardening** _(security, ~30 min)_
> Create `supabase/migrations/029_harden_public_surface.sql`: (1) `revoke execute on function mark_payment_claimed(uuid) from anon, authenticated;` (2) explicit `revoke insert, update, delete on inquiries, inquiry_items, contact_messages from anon, authenticated;`. Do not touch the edge function `mark-payment-claimed` (it uses the service role and token-gates at `index.ts` `.eq("lookup_token", token)`). Verify: apply locally; anon `supabase.rpc('mark_payment_claimed', {p_order_id})` fails; `/track` "payment sent" flow still works through the edge function.

**T2 — Turnstile fail-closed** _(security, ~20 min)_
> Edit `supabase/functions/_shared/turnstile.ts`: when `TURNSTILE_SECRET` is unset, return `{ ok:false, reason:'captcha_unconfigured' }` instead of `{ ok:true }`; callers should return 403 with a generic message. Keep a `TURNSTILE_ALLOW_UNSET=true` env escape hatch for local dev only. Verify: unit-test both branches; with secret set in a deployed test, contact form still submits.

**T3 — Lock CORS** _(security/config, ~15 min)_
> In the shared CORS helper under `supabase/functions/_shared/`, require `ALLOWED_ORIGIN`; if unset, default to `https://vsresearchlabs.com` (never `*`). Grep all functions for their own CORS headers and route through the shared helper. Verify: `curl -H "Origin: https://evil.example"` gets no permissive ACAO header.

**T4 — Auth-gate `resolve-video` and `send-order-invoice`** _(security, ~45 min)_
> In both edge functions: read the caller's JWT via `createClient(...).auth.getUser()` (anon-key client with the incoming Authorization header), then check membership in `admin_users` (service-role query or `is_admin` RPC as the user). Return 401 otherwise. In `resolve-video` also: restrict `expandUrl` final host to `*.tiktok.com`, cap thumbnail download at 5 MB, add `AbortSignal.timeout(10000)` to all fetches. Verify: unauthenticated invoke → 401; admin flows in AdminInventory (video) and OrderView (re-send invoice) still work.

**T5 — Replace native dialogs in three admin files** _(functionality, ~2–3 h)_
> In `src/pages/admin/AdminEdit.tsx`, `AdminStatModules.tsx`, `AdminInventory.tsx`, replace every `window.confirm`/`window.prompt` with the in-app modal pattern from `OrderView.tsx:183–187` (`confirmReq` state + promise resolver; for prompt cases add a text input to the modal). Extract the modal into `src/components/admin/ConfirmModal.tsx` and reuse it in OrderView too (DRY). Verify: `grep -rn "window.confirm\|window.prompt\|window.alert" src/` returns nothing; exercise delete-product, cancel-order, import-reset in the browser preview.

**T6 — Legal pages + footer links** _(trust, ~3 h)_
> Add lazy routes `/privacy`, `/terms`, `/shipping`, `/about` in `src/App.tsx` using a shared `src/pages/legal/LegalPage.tsx` layout (serif masthead, mono eyebrow, `max-w-[64ch]` prose, existing footer). Content: research-use-only terms (reuse `LegalDisclaimer.tsx` language, expanded), privacy (what's collected: contact/order data, Supabase/Resend/Cloudflare processors, no ad tracking), shipping (Bay Area same/next-day claim from hero, carrier handoff, RUO packaging note), about (Velari Systems LLC, Northern California, operating standards). Placeholder-free but clearly reviewable — flag for owner's legal review, don't invent jurisdiction-specific clauses. Add a compact link row to `src/layout/GlobalFooter.tsx` and entries to `public/sitemap.xml`. Verify: all four render, footer links visible on every page, no route 404s.

**T7 — Account entry point** _(IA, ~30 min)_
> Add an "Account" row to `src/layout/NavDrawer.tsx` (Operational section) linking `/account`, with signed-in state showing the profile name (read from the existing auth hook). Keep guest checkout untouched. Verify: `/account` reachable from drawer; signed-out users see the AuthCard.

**T8 — `/catalog` decision** _(IA, ~15 min)_
> Add "Full Catalog" link in NavDrawer beneath Research Supplies. (If the owner prefers, delete the route instead — but linking is the cheaper default since the page works.) Verify: reachable, filters function.

**T9 — Alt text + aria-labels** _(a11y, ~1 h)_
> Fix the 9 empty-`alt` images: `CompactProductTile.tsx` (`alt={product.name}`), `ProductPage.tsx:284` gallery, `CartPage.tsx` item thumbs, `Logo.tsx` (`alt="VS Research Labs"`), `DocumentCard/DocumentSlot`, `AdminInventory` thumb; leave genuinely decorative `VideoIntroModule` images as `alt=""` with `aria-hidden`. Add `aria-label` to `GlobalHeader` menu/cart buttons and the CartPage remove-item ×. Verify: `grep -rn 'alt=""' src/` leaves only intentional decorative cases (comment them); VoiceOver announces product images and header controls.

**T10 — Empty states on research-supplies pages** _(UX, ~45 min)_
> In `BiopeptideResearchSupplies.tsx`, `NootropicsResearchSupplies.tsx`, `SkincareResearchSupplies.tsx`, render a styled empty state ("No compounds match the current filters." + a ghost Button clearing filters) when the filtered list is empty. Verify: set an impossible filter combo in preview, see the message; clear restores list.

**T11 — Remove dead social links** _(polish, ~10 min)_
> In `Landing.tsx` hero, delete the disabled TikTok/Instagram anchors (keep WhatsApp). Verify: no `aria-disabled` links in hero.

**T12 — Price echo in business notification** _(security-adjacent, ~45 min)_
> In `supabase/functions/place-order/index.ts`, include each line's `unitPriceCents` and line totals in the business notification email, with a "Client-supplied pricing — verify before invoicing" note. If any line's price is 0 or exceeds `MAX_LINE_CENTS/10`, prefix the subject with `[VERIFY PRICING]`. Verify: place a test order, inspect the notification email content.

**T13 — Hardcoded hex → tokens (BottomNav + badges)** _(design, ~1 h)_
> Replace the `ACCENT`/`GOLD` constants and inline styles in `src/layout/BottomNav.tsx` with CSS-var-driven values (`var(--color-accent-teal)` etc. via className or `style={{ color: 'var(--…)' }}`); replace hardcoded status-badge rgba/hex in `CartDrawer.tsx:228–232`, `CartPage.tsx:632–638`, `OrderView.tsx:342` with tokens from `theme.css` (add `--color-status-success` if missing). Verify: toggle dark mode — BottomNav and badges follow the theme.

**T14 — Hologram palette theme-aware** _(design, ~1.5 h)_
> In `src/components/landing/CompoundHologram3D.tsx`, derive `ELEMENT_STYLE` colors from CSS variables at mount (`getComputedStyle(document.documentElement)`), re-reading on `data-theme` change (MutationObserver or the existing theme hook). Keep the same visual output in light mode. Verify: molecule renders identically in light; dark mode shows theme-consistent materials; no per-frame `getComputedStyle` calls.

**T15 — Raw buttons → Button primitive** _(design, ~1.5 h)_
> Migrate raw `<button>`s to `src/components/ui/Button.tsx`: `Contact.tsx:158–169` topic selector (ghost variant, keep `aria-pressed`), `BiopeptideResearchSupplies.tsx:79–85` link-button, `Catalog.tsx:140` clear-search (icon, add `aria-label`), `CartPage.tsx` quantity/remove controls (sm/icon variants — extend Button with an `icon` size if needed rather than bypassing it). Verify: visual parity in preview, focus rings present, no sheen/lift regressions per DESIGN.md.

**T16 — Font preload + sitemap update** _(perf/SEO, ~30 min)_
> Add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the Cormorant Garamond and Inter weights actually used (check `theme.css` @font-face/import) to `index.html`. Add `/privacy`, `/terms`, `/shipping`, `/about` (and `/account` if public) to `public/sitemap.xml`. Verify: network tab shows fonts preloaded; no FOIT flash on hard reload.

**Deploy checklist task (owner + model together, not code):** apply migrations through 029 to production (`supabase db push` or dashboard), set `TURNSTILE_SECRET`, `ALLOWED_ORIGIN`, confirm `RESEND_API_KEY`/from-domain, enable Supabase email-confirm, upload `supabase/auth-emails/confirm-signup.html` as the confirm-signup template, and commit that file to git. **Needs verification:** current live state of every one of these.

---

## 7. What Not To Build Yet

- **Payments integration / checkout processor** — manual invoice + payment verification is the model; keep it.
- **Discount codes, save-for-later, balance-due** — planned for the B2B test run, not launch.
- **Customer accounts phase 2+** (perks, waitlist, paid tiers, order re-ordering).
- **Documentation archive** — stays sealed until real certificates exist; never ship filler COAs.
- **Admin 2FA, idle timeout, audit alerting** — good post-launch hardening, not blockers for a single-operator admin.
- **Catalog expansion to 50+ SKUs / CAS-MW verification sweep** — content debt, not launch debt.
- **Search infrastructure, wishlists, comparison tools, live chat, blog/SEO content engine.**
- **A redesign.** The system is locked; enforcement only.

---

## 8. Final Launch Checklist

**Security**
- [ ] Migration 029 applied: `mark_payment_claimed` anon grant revoked; explicit write-revokes on inquiry/contact tables
- [ ] `TURNSTILE_SECRET` set in prod; fail-closed verified (form post rejected when secret removed in test env)
- [ ] `ALLOWED_ORIGIN` set to `https://vsresearchlabs.com`; no `*` CORS in any function response
- [ ] `resolve-video` + `send-order-invoice` return 401 unauthenticated
- [ ] `grep -rn "service_role" src/` is clean; no secrets in git (`.env` untracked)

**Functionality (manual pass on production)**
- [ ] Place a real test order from `/cart` AND the cart drawer → both emails arrive branded (buyer invoice + inquire@ notification)
- [ ] `/track` token link from the invoice email shows the invoice; email+ZIP shows status only
- [ ] Admin on iPhone: sign in, mark invoiced → paid → fulfilled (with tracking) → delivered; every confirm uses in-app modal
- [ ] Contact form → reference ID → both emails arrive
- [ ] Customer signup → branded confirm email → profile created → own order visible; guest checkout still works with no account
- [ ] 404 page, empty-cart, empty-filter states all render

**Trust & content**
- [ ] Privacy, Terms, Shipping, About live and linked in footer + drawer
- [ ] Research-use-only language consistent (gate, footer, legal pages)
- [ ] No dead links (social anchors removed), no "coming soon" outside the intentional documentation seal
- [ ] Owner has read the legal pages (model-drafted ≠ legal advice)

**Design / a11y / perf**
- [ ] Dark mode sweep on every public page — no light-mode hex artifacts (BottomNav, badges, hologram)
- [ ] All product/cart/logo images have alt text; icon buttons have aria-labels
- [ ] Keyboard-only pass: drawer, cart, contact, account flip-card all operable; focus rings visible
- [ ] Lighthouse on `/` and a product page: no red LCP; fonts preloaded
- [ ] Mobile (375px) pass: landing, catalog, product, cart, track, account

**Ops**
- [ ] All migrations 001–029 confirmed applied to the production project
- [ ] Resend domain verified; from-addresses correct; inquire@ receives notifications
- [ ] `supabase/auth-emails/confirm-signup.html` committed and installed as the Auth template
- [ ] `sitemap.xml`/`robots.txt` current; canonical `https://vsresearchlabs.com` everywhere
- [ ] Post-launch monitoring habit: check Supabase function logs + Resend dashboard daily for the first week
