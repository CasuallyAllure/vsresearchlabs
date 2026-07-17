# Whole-System Scan — 2026-07-16

**Scope:** all 11 domains, whole repo + live production state.
**Method:** read-only. No fixes, no edits to code, no commits, no deploys. Every finding cites `file:line` or a command output. Live state was queried read-only (`promo_settings` select, `gh api` branch protection, `npm audit`, a build).
**Relationship to `docs/REVIEW_2026-07-16.md`:** that review's 5 P0s were **re-verified from scratch and all 5 still hold**. They are incorporated by reference, not re-derived. This document expands to the whole system.

---

## Overall grade: **D**

**Verdict.** This is a well-engineered codebase in a badly-run release process, and the gap between those two facts *is* the finding. The engineering is genuinely strong — ~50 `SECURITY DEFINER` functions that all pin `search_path`, every admin price-path RPC gated on `is_admin()`, zero `npm audit` vulnerabilities, effectively zero `any`/`@ts-ignore` in 38,661 lines, a real `ErrorBoundary`, correct route-level code-splitting, and a documented history of finding and closing its own privilege-escalation bugs. But **what is deployed is the weakest version of this code that exists in the repository.** The commit that adds server-side price verification and closes an authenticated IDOR (`7860e57`) is not an ancestor of `main`; `main == origin/main == 9e4e3d0` is what's live. Underneath that sits a deeper structural fact the prior review didn't name: **no layer of this stack is a price authority.** `recompute_order_totals` (`052_reward_percent_fence.sql:57`) — the last plausible line of defense — recomputes the subtotal from `order_lines.unit_price_cents`, the number the client sent. It is honest arithmetic over dishonest inputs. Money currently leaks in both directions: a buyer can invoice themselves $0.01, and a signed-in buyer is silently billed $800 under quote. Against a "we can't lose" bar, the deployed system fails; the codebase does not. Closing the two worst findings is a deploy of code that is already written and already unit-tested.

---

## Scorecard

| # | Domain | Grade | One-line justification |
|---|---|---|---|
| 1 | **Pricing & money integrity** | **F** | No layer is a price authority; 5 live P0s leak money in both directions — buyer can invoice $0.01, business silently loses $800/order. |
| 2 | **Security & authz** | **D** | Backend discipline is A-grade (50/50 `search_path` pinned, every admin RPC gated), but a live authenticated IDOR leaks any order's PII and mass-emails buyers. |
| 3 | **Data integrity** | **B-** | Migrations are additive-only, idempotent, well-commented; pulled down by a live admin path writing NULL-priced lines and an unindexed `buyer_contact` used for fraud gating. |
| 4 | **Testing** | **D+** | The 41 tests that exist are excellent; they cover ~10% of the money path — shipping, wholesale, and B2G1 arbitration have zero coverage and coverage isn't measurable. |
| 5 | **CI/CD & release hygiene** | **D** | `ci.yml` is not on `main`, `main` has no branch protection, 98% direct-to-main, and no deploy target has a rollback path. |
| 6 | **Dependencies & supply chain** | **B** | Zero vulnerabilities, deterministic lockfile, zero unused deps; the patch pipeline has never merged once and the deploy tools holding the credentials are unpinned. |
| 7 | **Performance** | **C+** | Code-splitting and admin isolation are correct; a 50KB-gzip Supabase SDK is forced into every page load and checkout costs ~12 sequential round trips. |
| 8 | **Accessibility** | **C+** | Good bones (real skip link, real alt text, correct reference modal); the two highest-traffic surfaces have unenforced modality and 13–22px tap targets. |
| 9 | **Frontend code quality & tech debt** | **C+** | Near-zero `any`, correct list keys, well-built checkout wrapper; three files over 1,400 lines and cart-total logic duplicated across two surfaces that have already drifted twice. |
| 10 | **Observability & error handling** | **D** | No error tracking, no alerting, no uptime monitoring for a store taking real payments; unstructured logs not keyed by order number. |
| 11 | **`video/` Remotion workspace** | **B** | Properly isolated — 185KB of source, never typechecked or bundled, zero build impact; the only real item is a licensing tripwire at 4+ employees. |

### On the security grade, reconciled

The security sub-audit graded the codebase **A-** *excluding* the known P0s, and that grade is earned — see "What's already good." The domain grade here is **D** because a grade must describe **what is deployed**, and what is deployed has an open authenticated IDOR (`send-receipt` and three siblings, `requireAdmin` count **0** on `main`). Any signed-up user can read any order's full PII and mass-email arbitrary buyers. The split matters for morale and for triage: this is not a codebase that doesn't know how to gate a function — `_shared/adminGate.ts` exists on `main` and every one of the ~50 SQL functions uses its equivalent. It is one wiring change sitting on an unmerged branch.

---

## Verified state of the world

| Claim | Verified | Evidence |
|---|---|---|
| `7860e57` (the hardening) is on `main` | **No** | `git merge-base --is-ancestor 7860e57 main` → false |
| Deployed `main` has price verification | **No** | `git show origin/main:…/place-order/index.ts \| grep -c "priceMismatches.push"` → **0** (branch → 1) |
| Deployed notifiers are admin-gated | **No** | `requireAdmin` count on `main` → **0** for all 4 (branch → 2 each) |
| B2G1 promo is live right now | **Yes** | live read → `{"b2g1_enabled":true,"b2g1_ends_at":null,"b2g1_excluded_skus":[]}` |
| Prod DB is at migration 051 | **No — stale** | `promo_settings` (created by `055_promo_settings.sql`) returns `[{"id":1}]` → **≥055 applied** |
| `ci.yml` exists on `main` | **No** | `git ls-tree -r origin/main -- .github/` → only `dependabot.yml` |
| `main` has branch protection | **No** | `gh api …/branches/main/protection` → 404 "Branch not protected" |
| `dist/` committed | **No** (good) | `git ls-files dist` → empty |
| npm vulnerabilities | **0** | `npm audit` → "found 0 vulnerabilities" |

**Correction to project memory:** the note "prod DB at 051; 052–058 unapplied" is **stale and should not be trusted**. Migration 055 is provably applied. 056–058 are very likely applied too (their commit messages claim prod verification, and this repo has a real convention of flagging genuinely-unapplied migrations — e.g. `814f2ad "…DB side in migration 047, not yet applied"` — which none of 052–058 carry). Worth one live confirmation, but do not plan a `db push` on the 051 premise.

---

## Prioritized backlog

Effort: **S** ≤2h · **M** ≤1 day · **L** >1 day.

### P0 — live in production now

| ID | Finding | file:line | Impact | Fix | Size |
|---|---|---|---|---|---|
| **P0-1** | No server-side price verification. `priceMismatches` is declared and read 5× but **never written**. | `place-order/index.ts` (deployed `main@9e4e3d0`) `:696` decl, `:1241`/`:1505`/`:1508`/`:1515`/`:1519` reads | A buyer POSTs `unitPriceCents: 1` on a $600 case → order created at $0.01. No flag, no log, no event. The file header at `:18-26` claims verification happens; **that comment is false in production**. | Deploy `7860e57` (`priceCheck.ts`, already unit-tested). Code is written. | **S** |
| **P0-2** | Four notifier functions ungated — authenticated IDOR. | `send-receipt/index.ts:9-11,32-33`; same in `send-processing-`/`send-delivered-`/`send-shipment-notification` | Sign up (free) → call `send-receipt` with any `order_id` → full PII (name, contact, address, lines, totals). Without `preview`, also **emails the buyer** and stamps `receipt_sent_at` → mass-email any customer. Only protection is `verify_jwt`, which authenticates *any* user. | Deploy `7860e57`. `_shared/adminGate.ts` already exists on `main`; the `requireAdmin(req)` wiring is branch-only. | **S** |
| **P0-3** | Wholesale granted on **any SKU**, priced off the client's own number. | `place-order/index.ts:799` (branch) / `:898-916` (`main`) — **both** | Server eligibility = non-empty `sku` + client-sent `unit > 0` + `qty >= 3`. `slowByKey` — the only thing built from the variant query — gates `isSlow` (B2G1) at `:801`/`:819` and **never** wholesale. Reproduced: signed-in buyer, `laboratory-equipment` @ $200 → **qty 5 quoted $1,000, billed $730**; **qty 10 quoted $2,000, billed $1,200 (−$800)**. Client offers wholesale on biopeptides only (`wholesale.ts:55-64`). Cart quotes retail, so the buyer never knows. *(Money starts leaking at qty ≥ 5, not 3 — pack value is 0 below 5.)* | Gate `wholesalePlan` on the matched priced variant row already loaded into `slowByKey`. Data is in hand and unused. Confirm intent first — `:748` says "every orderable dose", code says any SKU. | **M** |
| **P0-4** | Non-monotonic pricing — guest pays **+$240 for one more vial**. | `place-order/index.ts:914` (arbitration) + `:934` (guest gate) | Arbitration is a hard `else-if`; the guest gate then drops the wholesale plan **with no re-arbitration back to B2G1**. Replayed the deployed logic on a $60 slow-ship vial, guest: **qty 9 → $369.99; qty 10 → $609.99**. Hits every guest. **B2G1 verified live today** (`b2g1_enabled: true`, no end date, no exclusions). | Re-arbitrate after the guest gate: if `wholesalePlan` is dropped, re-evaluate those lines for B2G1 rather than discarding. | **M** |
| **P0-5** | Client and server disagree on "member". | client `CartDrawer.tsx:82`, `CartPage.tsx:72` (`isMember = !!user`) vs server `place-order/index.ts:618-643` (`stampedUserId`) | Server stamps ownership only when a verified JWT resolves **and** `authedEmail === contact`. Neither cart surface reads `user.email` — both are `useState('')`. `CartPage:817` is labelled "Email or Phone *" with no format check, actively inviting a phone number. Member types a different email → tile promises $360, drawer says $600, server bills **$609.99 (+$249.99, +69.4%)**. **No price check can ever catch this** — the client's unit price is honest; only the *total* is wrong, and nothing verifies totals. | Prefill and bind the contact field to `user.email`; resolve membership from the JWT alone and treat contact as a delivery address, not an identity claim. | **M** |

> **P0-3, P0-4, and P0-5 are present on `main` *and* on the branch.** Deploying the branch closes P0-1 and P0-2 only — two of five.

### P1 — should fix before the next deploy

| ID | Finding | file:line | Impact | Fix | Size |
|---|---|---|---|---|---|
| **P1-1** | **The money path is typechecked by nothing.** | `tsconfig.json` (refs only `tsconfig.app.json` `include:["src"]` + `tsconfig.node.json` `include:["vite.config.ts"]`); `.github/workflows/ci.yml` | `npx tsc -b --dry` builds only those two projects. `supabase/functions/**` — including 1,452-line `place-order/index.ts` — is never typechecked. A type error in the money path passes CI clean. ESLint reaches it but with `globals.browser` and no type-aware service: syntax only. | Add a `deno check` CI step or a third tsconfig covering `supabase/functions`. | **S** |
| **P1-2** | **`ci.yml` is not on `main`; `main` has no branch protection.** | `git ls-tree -r origin/main -- .github/` → only `dependabot.yml`; `gh api …/protection` → 404 | CI has **never run on `main`**. Added today by `63d809e` on the unmerged branch. 272 commits / 5 merges → **~98% direct-to-main**. Also the root cause of the stalled dependabot queue (PRs branch from `main`, which has no workflow → zero checks → no signal to merge). | Merge the branch; enable branch protection. | **S** |
| **P1-3** | **No error tracking, alerting, or uptime monitoring of any kind.** | verified absent across `package.json`, `src/`, `supabase/functions/` | If an order's business notification fails, or coupon redemption fails mid-handler, nothing pages anyone and nothing surfaces in admin (`order_events` is written only for price mismatches, `:1154`/`:1162`). For a store taking real payments, a silently-broken notification pipeline can run indefinitely. `ErrorBoundary.tsx:28` has a comment acknowledging "a real telemetry sink can hook in here later". | Wire Sentry (or equivalent) into `ErrorBoundary.componentDidCatch` + every edge function catch. Alert on failed order/email. | **M** |
| **P1-4** | Unprotected `fetch` in `sendResendEmail`; the business notification is the only email call outside a try. | `place-order/index.ts:422` (fetch), `:1430` (call site), vs `:1334` (buyer email correctly wrapped) | `fetch` rejects on network failure. A transient blip to `api.resend.com` throws out of the handler *after* order + lines + coupon + buyer invoice all succeeded → buyer sees "couldn't reach the ordering service" on a **successful** order, retries, gets `duplicate: true` success. Ray's "New order" email is silently dropped; the order is still in the admin list, so this is a dropped notification + confusing UX, not data loss. **Severe variant:** if the function is killed/times out *between* order-insert and the buyer email, `:545`'s hardcoded `invoiceEmailSent: contactIsEmail` ("sent on the original attempt") becomes a lie — buyer told they were invoiced, no invoice sent, no business notification, order unnoticed. Perf finding #1 (~12 sequential round trips + 2 external API calls) makes a timeout plausible. | Wrap `sendResendEmail`'s fetch in try/catch; add a top-level try/catch to the handler; persist `invoice_email_sent` to the DB instead of asserting it. | **S** |
| **P1-5** | Reward voucher double-spend (TOCTOU). | `place-order/index.ts:693-706` (read) → `:1190-1211` (consume) | CAS update is correctly filtered (`.eq("status","active")`) so only one row flips — but **the code never checks whether it matched**. A filtered UPDATE matching nothing returns `error: null`, so the loser silently keeps the discount. Two concurrent checkouts → one voucher, two 40% discounts. The coupon path already solves this (`redeem_coupon`, `SELECT … FOR UPDATE`, rollback at `:1252-1293`). | Atomic consume via RPC returning the row; roll back like the coupon path if it lost. | **M** |
| **P1-6** | B2G1 eligibility spoofable — and one collision exists in live catalog data. | `place-order/index.ts:788`, `:795-826` | `isSlow` is a `.some()` OR across every dose row for the SKU, matched against `squash(product.name + note)` — both client-controlled. Fires on real data today: `VSR-RS-IGF` variants `["0.1mg","1mg"]` → `squash("igf-1lr3—0.1mg").includes("1mg")` is **true**. And `note` is attacker-controlled (`:800`): 3 × "X — 20mg" with `note: "5mg"` → free 20mg vial. `priceCheck.ts` already solved this class (longest-match, regression test at `tests/unit/priceCheck.test.ts:119`); the hardening was never applied to this second matcher. | Export the resolver from `priceCheck.ts`, use it in both; match `product.name` only — `note` must never be an identity signal. | **M** |
| **P1-7** | `create_order_from_inquiry` writes **NULL-priced order lines** from a live admin button. | `027_random_order_numbers.sql:73-76`; called from `AdminStatModules.tsx:339`, `AdminInquiries.tsx` | The insert omits `unit_price_cents` entirely → NULL. `recompute_order_totals`' `sum(unit_price_cents * quantity)` silently treats those as **$0** (SQL `sum()` ignores NULLs — no error). If a token-gated invoice is viewed before the admin re-prices, `InvoiceDocument.tsx:33-40`'s `unitOf()` falls back to raw `tierPriceCents` — the placeholder formula that ignores admin overrides — rendering a fabricated price to a customer. New instance of the known price-path trap. | Insert `unit_price_cents` from the variant, or `raise` if unresolvable. Render `—`, never a formula. | **S** |
| **P1-8** | `$0` order lines still reachable. | `src/lib/cartActions.ts:117` (`?? 0`); `pricing.ts:29` | `tierPriceCents` matches `/([\d.]+)\s*mg/i`, so a non-mg dose → null → `?? 0` → **line billed $0**. Verified 6 live catalog doses are non-mg with no price: `VSR-RS-HCG` (1000/2000/5000/10000iu), `VSR-RS-LMB 10ml`, `VSR-RS-LIPC 10ml`. Tile still renders Add (`isVariantPublic` defaults true, `productOverrides.ts:250`). Server won't catch it — `priceCheck.ts:78` filters to `price_cents != null`, so a SKU with no priced rows is skipped, never flagged. `canQuickAdd` exists and would block it — used at **2 of 11** call sites. | Make `lineUnitCents` return `number \| null`; payload builders refuse null lines; flag `$0` unconditionally in `priceCheck`. | **M** |
| **P1-9** | `buyer_contact` has no index, but is the predicate for fraud gating. | no `create index` anywhere; used at `012:217`, `016:68`, `028:175`, `031:189,262`, `043:258`, `048:74`, `053:69`, `057:157` | Predicates wrap the column (`lower(btrim(buyer_contact)) = …`), so even a plain index wouldn't help — these are functional lookups with **zero index support** → full scan on `orders` for every status lookup, every "once per contact" coupon-abuse check, every account link. Correctness/abuse concern, not just perf: coupon fraud gating degrading to a full scan under load. | `create index on orders ((lower(btrim(buyer_contact))))`. | **S** |
| **P1-10** | Price check skips SKUs with disallowed characters — **no flag at all**. | `place-order/index.ts:566-602`; `priceCheck.ts:116-139` | Lines failing `SKU_RE` are dropped from both the query *and* the report. `"sku": "BPC-157 "` (trailing space) + any price → not even the "unresolved" flag the anti-evasion work exists to produce. Worse than the case it was built to catch. *(Applies once P0-1 ships.)* | Treat `SKU_RE` failure as a mismatch with `serverCents: null`. | **S** |
| **P1-11** | Two cart surfaces show contradictory totals; `/cart` has **no grand total at all**. | `CartDrawer.tsx:627-636`; `PromoCode.tsx:65,200-205`; `CartPage.tsx:681-745` | `breakdown` computes only if `accountDiscount` is truthy → a coupon without an account discount is **omitted from the Total**. `PromoCode` renders its own total without account discount or shipping. Two contradictory "Total" figures 40px apart. On `/cart`, the only labelled figure is "Total after discounts" (`:710-717`) which **excludes shipping**, sitting directly above a Shipping row — a guest can reasonably read it as final and be surprised by the invoice. Drawer total is also blind to wholesale/B2G1/voucher. | One shared total function fed by the same inputs the server uses. | **M** |
| **P1-12** | Modality is declared but not enforced on the highest-traffic surfaces. | `CompoundIntelligenceOverlay.tsx:195-209,319`; `CartDrawer.tsx:236-248`; `NavDrawer.tsx`; `MemberAccessGate.tsx:164` | `aria-modal="true"` with no focus trap: keyboard users tab straight through the scrim into off-screen page chrome. The overlay is what *every* catalog tile opens into. WCAG **2.4.3 (A)**, **4.1.2 (A)**. `DisclaimerGate.tsx:54-81` implements a correct trap — and `useFocusTrap.ts` already exists on `chore/price-increase-15`. | Extract `useFocusTrap(open, ref)`; reuse in all four. | **M** |
| **P1-13** | Zero test coverage on the two newest money features; coverage not measurable. | `tests/unit/`; `.github/workflows/ci.yml` | 41 pass, 21 skip. **None** reference `GUEST_SHIPPING_CENTS`, `shippingCentsFor`, `wholesalePackPricing`, or `wholesaleDoses`. `npx vitest run --coverage` fails — `@vitest/coverage-v8` not installed — so CLAUDE.md's 80% minimum is unenforceable and unverifiable. E2E covers 6 logged-out routes, zero money, and doesn't run in CI. | Extract `computeOrderPricing()` from the handler the way `priceCheck.ts` was extracted, and table-test it. | **M** |
| **P1-14** | No rollback path for any of three deploy targets. | 56 migrations, zero down-scripts; `README.md:34-36` | **DB:** forward-only; a bad migration is recovered by authoring a new one under pressure against prod. **Edge functions:** no version history, no rollback verb; recovery = checkout old + redeploy, which requires the last-good `place-order` to be a clean revert target — with fused commits, it often isn't. **Frontend:** Cloudflare supports `wrangler rollback`, but nothing documents it and `dist/` is gitignored so it's rebuild-from-old-commit. The README documents three forward deploys and zero reverses. | Write down the rollback path for all three, even if the honest DB answer is "forward-fix only". | **M** |
| **P1-15** | `npm run gen:inventory` is a landmine. | `scripts/buildInventory.mjs:241` (`writeFileSync`), `:15-17` | Replaying the generator's mapping: **WOULD DROP `korean-glutathione`** (hand-written into the generated file; no META entry, no manifest row → unreproducible) and **WOULD ADD `10-amino-1mq`** back with no price rows → formula-priced. Downstream the SKU vanishes from the catalog while `product_variant_stock` rows survive → `productBySku.get(l.sku)` undefined at `TrackOrder.tsx:43-48`, `InvoiceDocument.tsx:34-38`. `:15-17` still claims "Deterministic… byte-identical output" — **now false**, with no warning banner. | Reconcile the manifest, or add a fail-loud guard + banner. Do not run it meanwhile. | **S** |
| **P1-16** | The placeholder pricing formula is a live fallback and produces absurd numbers. | `pricing.ts:33-35`; `productOverrides.ts:253-259` vs `:237-242` | `base + mg × perMg` on real data: `korean-glutathione 1200mg` → **$14,420**; `glutathione 1500mg` → $13,520; `nad-plus 1000mg` → $9,020. Reachable: `:259` returns `isVariantPublic = true` for a **tracked but unpriced** dose when there's any supply signal. An admin who receives stock before importing the price publishes at the formula price; `wholesaleDoses` then includes it and the tile offers a $144,200 case at 40% off. Verified **87 of ~130** catalog variants have `priceCents == null` in the generated JSON — prices live in the DB, so the formula is the fallback whenever a DB row is missing. `:237-242` states the opposite policy to `:253-259`. | Pick one policy. If "no price = hide" is real, drop the supply-signal escape hatch at `:259`. | **M** |

### P2

| Finding | file:line | Note |
|---|---|---|
| **`priceCheck` couples to a client-composed *string format*, not a constant** | `cartActions.ts variantProduct` bakes the dose into the line name; `priceCheck.ts:11-13` parses it back out by substring | The nastiest coupling in the repo: a purely cosmetic client-side rename of the line-name format **silently disables server-side price verification**. Not a shared symbol, not typechecked, and tests feed `priceCheck` its own fixtures — nothing would catch it. |
| Two `squash` definitions that must agree, don't | `index.ts:788` (`/\s+/g`) vs `priceCheck.ts:59-60` (`/[\s\p{Cf}\p{Cc}]+/gu`) | Honest severity: the weak copy **fails closed** (a zero-width char makes the match *miss*, withholding B2G1). Not exploitable for gain today. One function, two behaviors. |
| Wholesale threshold asymmetry | client `cartActions.ts:36` `WHOLESALE_MIN_PACK = 5` vs server `index.ts:799` `qty < 3` | Client and server disagree on the floor. |
| `WHOLESALE_PACKS` vs `WHOLESALE_CASE`/`HALF` in sync by comment only | `wholesale.ts:39-40` / `index.ts:758-759` | In sync today. If the case moves to 45% client-side only, the tile advertises $330 and the server bills $360 — and `priceCheck` **cannot catch it** (it compares per-vial prices, never the pack discount). A vitest asserting both agree is the cheap guard. |
| Rate limiters case-sensitive | `place-order/index.ts:609-616`; `send-inquiry/index.ts:364-368` | `.eq()` on a `.trim()`'d-but-not-lowercased contact. `Buyer@x.com` / `buyer+1@x.com` are separate buckets. No IP fallback. `send-contact/index.ts:199-203` already does it right with `.ilike()` — the fix pattern exists in-repo. |
| `lookup_order` has no rate limiting at any layer | `012_order_tracking.sql:180-223` | `grant execute … to anon`, callable directly via PostgREST with the public key. ~100k ZIP brute force against a known order number/email. Bounded (status/carrier/tracking only — line items were closed off in `022`), but a leaked tracking number enables package theft. Order numbers are high-entropy since `027` (32^6), so only the email path is practical. |
| Supabase SDK forced into every page load | `src/main.tsx` (module-scope `.load()` calls before `createRoot`) | `supabase-*.js` = **195.21 kB raw / 49.75 kB gzip**, `modulepreload`'d unconditionally in `dist/index.html` on every route. Shell total ≈ **188.8 kB gzip**, ~212.6 kB before the homepage is interactive. |
| Hero 3D is 255 kB gzip, unconditionally above-the-fold | `HeroHoloCarousel-*.js` 955.79 kB / **255.44 kB gzip**; `Landing.tsx:682` | Correctly code-split and *not* blocking shell TTI — but rendered with no `IntersectionObserver`/idle gating, so every homepage visitor downloads it as part of the hero's first render. **The fix already exists** (`507faac perf: lazy 3D visualizer`), unmerged on `chore/price-increase-15`. |
| Inter on Google CDN, render-blocking, no preconnect | `src/index.css:10` | Two cold origins (`fonts.googleapis.com` → `fonts.gstatic.com`) inserted serially into the CSS-blocking path, for a family whose two siblings are already self-hosted. Arguably redundant now that `fonts-v2.css` self-hosts. |
| ~12 sequential round trips per checkout | `place-order/index.ts` — 33 `await`s, exactly **one** `Promise.all` (`:571`) | Turnstile → dupe check → price check → rate limit → promo → 4 sequential inserts → re-read → 2 email API calls. `validate_coupon`/`redeem_coupon` run one RPC per code in a loop — genuinely sequential (each depends on prior admitted codes), but 2 codes = 2 extra trips each. Conversion-relevant latency. |
| Contrast below AA | nickname badge `CompoundTile.tsx:155-161` (**2.9:1** light / 3.8:1 dark); tile desc `:164-170` (**4.49:1**); cart `text-ink/40`–`/55` at `CartDrawer.tsx:330,345,361,376,641,649,660,666`, `CartPage.tsx:785-786,815-816,850` | WCAG **1.4.3 AA**. |
| Tap targets under 24×24 | `DoseTierChips.tsx:65` (~13-15px), `:128` (~22px); `CompactProductTile.tsx:159-193` (~18px), `:203-218` (~22px); `CartPage.tsx:626-633,640-646,666-673` | WCAG **2.5.8 AA**. `CompoundTile.tsx:286-296` gets it right (`h-[27px]`) — the two tiles are inconsistent. |
| Duplicate `<main>` landmark | `AnimatedPortalShell.tsx:33` + nested `ProductPage.tsx:466` | WCAG **1.3.1 / 4.1.2 (A)**. |
| Shipping-tier dot: `aria-label` on a role-less `<span>` | `CompactProductTile.tsx:109-116` | Not reliably announced. Give it `role="img"`. |
| Form errors not associated to inputs | `Field.tsx:68-94,112-146` | `aria-invalid` + `role="alert"` are right; no `aria-describedby` → a user tabbing back to an invalid field gets no restatement. One shared component, one fix point. |
| No metric-matched font fallbacks | `src/theme/fonts-v2.css:18-69` | 7 faces set `font-display: swap`, none set `size-adjust`/`ascent-override`. Real CLS on `clamp()` headings and tabular-nums price columns. |
| Invoice surfaces use raw `tierPriceCents` | `InvoiceDocument.tsx:37`, `TrackOrder.tsx:50`, `OrderView.tsx:144` | Inside a `unitOf(l)` fallback for `l.unit_price_cents == null`. Now **reachable** via P1-7. Render `—`, not a formula. |
| Unbounded item fields | `place-order/index.ts:478-497` | `product.id/name/sku/category` have no length cap while siblings do (`note` ≤1000, `notes` ≤4000). ×100 items. |
| Unsanitized SKU in the second `.in()` | `place-order/index.ts:773-793` | Fails closed, but one poison SKU silently breaks promo detection for unrelated lines. |
| `formatPerVial(NaN)` → `"$NaN"` | `wholesale.ts:89-94` | Not currently reachable via `wholesalePackPricing`, but exported and used across `WholesaleTile.tsx:364-391`. |
| Dependabot configured and completely stalled | `.github/dependabot.yml`; 5 open (4 ~4 weeks old), 4 group PRs closed unmerged | **Zero dependabot PRs have ever merged.** Root cause is P1-2: their branches cut from `main`, which has no `ci.yml` → zero checks → no signal. 15 packages are merely in-range-behind; one `npm install` takes them. |
| `chore/price-increase-15` is a merge hazard | +9 / −86, 10 days stale | Carries a 15% price pass, `useFocusTrap.ts`, and `507faac` lazy-3D — all absent from `main`. But conflict surface since merge-base: `place-order/index.ts` **+20 main commits**, `OrderView.tsx` +14, `CartDrawer.tsx` +10. Partly superseded — `main`'s `PaymentInstructions.tsx:43` is already Zelle-only via a different implementation; merging would drag back `paypal: string \| null` typing. **Cherry-pick the three good pieces; abandon the branch.** Merging as-is is the most dangerous git operation available here. |
| Deploy tools are the unpinned part | `wrangler`/`supabase` not in `package.json`; `README.md:34-36` prescribes `npx` | The only unpinned, un-lockfiled executables in the pipeline are the two that run **with deploy credentials in Ray's authed shell**. Lockfile discipline protects the app and stops exactly where the keys are. |
| Files over CLAUDE.md's 800-line cap | `AdminInventory.tsx` 1495, `OrderView.tsx` 1461, **`place-order/index.ts` 1452**, `AdminCoupons.tsx` 1217, `CartPage.tsx` 1010, `Landing.tsx` 1005, +2 | `place-order` is a single ~1,012-line `Deno.serve` handler doing 13 jobs — simultaneously the largest file, the most critical, untypechecked, and untested. |
| Money columns nullable without CHECK | `order_lines.unit_price_cents` (`003:137`) | No constraint, vs `product_variant_stock.price_cents` which has `check (… >= 0)` (`011:28`). Invariants enforced at the variant layer, weaker at the order layer where nulls are reachable. |
| Single top-level ErrorBoundary | `App.tsx:78` | Correct and working, but one boundary for the whole tree: a crashing subtree (e.g. the hologram) takes down the visible page rather than degrading in place. |
| Unstructured logs, inconsistent order tagging | 23 `console.*` in `place-order`; `:1403`, `:1441` have **no order identifier at all** | Ray can answer "what happened to order X" only by grepping raw function logs for an internal UUID — not the `VSR-ORD-…` number he actually has from an email. |

### P3

- **Remotion licensing tripwire.** `video/node_modules/remotion` 4.0.489, `license: "SEE LICENSE IN LICENSE.md"` — free for individuals and for-profits with **≤3 employees**; a company license is required above that. As a solo operator this is **currently compliant**. Record it; it becomes a real obligation at employee #4.
- **`video/` tracked on `origin/main`** — 22 files, but only **185,802 bytes of source**; the 576MB on disk is `node_modules` + `out/`, already excluded by `video/.gitignore`. `tsconfig.app.json:27` includes only `src`, so it is **never typechecked and never bundled — zero build impact**. The branch untracks it entirely (`63d809e`). Lower-stakes than it looks.
- **7 fully-merged branches** (+0 ahead) safe to delete: `design/2026-polish-pass`, `design/monochrome-instrument`, `feat/checkout-hardening`, `feat/coupons-affiliates`, `feat/white-label-foundation`, `feature/accounts-and-design-refresh`, `inventory/images-and-intelligence`. PR #9 is decorative — open since 2026-07-04, branch already +0/−68 (landed outside the PR).
- **Stale comments that lie.** `place-order/index.ts:684` — `customer_profiles.free_shipping` "survives as an admin override *for guests*" is impossible (guest orders have `user_id = null`, so `049`'s left join can never match). `src/index.css:7-8` documents a `?fontstack=v1` escape hatch no code reads (removed as CSP-blocked in `59f8a8f`). `tailwind.config.js:74` says "Cormorant / Plex"; it's STIX/Geist. `pricing.ts:4` says "Real per-tier pricing is not wired in yet" — overrides are the prod path.
- `stix-two-text-600.woff2` declared with no matching `font-semibold`+`font-serif` usage. Not preloaded → zero load cost; dead declaration.
- `priceCheck.ts:96` — false positive: a legitimately formula-priced dose on a partially-priced SKU is flagged "possible evasion."
- `noUncheckedIndexedAccess` not enabled (`tsconfig.app.json`) — array/object index reads aren't narrowed to `T | undefined`, in a codebase that indexes cart/coupon arrays by SKU.
- 17× `supabase!.rpc(...)` non-null assertions across admin pages — safe (routes are `AdminGate`d) but repeated instead of a typed accessor. Three more at `CartDrawer.tsx:635,650,653` are money-adjacent and runtime-safe today, but the compiler won't catch a future guard-shape change.
- `deno.lock`'s `workspace.packageJson` mirror is stale vs `package.json` (cosmetic; Deno isn't building the frontend).
- `tests/fixtures/rewardAccrual.ts:1-13` is a hand-written mirror of SQL in `mark_order_paid()` (044). `rewardAccrual.test.ts` tests the fixture, not production. The file comment is honest about it, but the filename reads as coverage that doesn't exist.

---

## Sequenced action plan

Do these **in this exact order**. Steps 0–1 are strictly net-positive and should go out on their own.

**0. Zero-deploy mitigation — right now, one row.**
Set `promo_settings.b2g1_enabled = false`. Verified live today as `true` with no end date and no exclusions. This single row simultaneously removes the **P0-4** $240 cliff and defuses **P1-6** B2G1 spoofing and the live IGF-1 LR3 collision. It costs a promo; it buys the entire B2G1 attack surface. No code, no deploy, instantly reversible.

**1. Deploy the branch's edge functions — today.**
`supabase functions deploy place-order send-receipt send-processing-notification send-delivered-notification send-shipment-notification`
Closes **P0-1** and **P0-2** — the two worst findings — with code already written and already unit-tested. **No migration required** (`shipping_cents` has existed since `010`/`016`/`020`; the shipping change is code-only). Every hour this waits is an hour production runs with no price verification and an open IDOR.
*Tradeoff, stated plainly:* this deploys code that isn't on `main` yet, creating deployed↔`main` drift. That is the correct trade against a live IDOR — but it makes step 2 urgent, not optional.

**2. Merge `feat/launch-hardening-and-2026-polish` → `main`, then enable branch protection.**
The branch is **+9 / −0** against `main` — zero drift, ready. Merging ends the step-1 drift, puts `ci.yml` on `main` for the first time, and unblocks the 5 stalled dependabot PRs as a side effect (their lack of CI signal traces to the same missing file). Then turn on protection so `ci.yml` is an actual gate rather than a file — today it is neither on `main` nor enforced.

**3. Fix P0-3 (wholesale on any SKU).**
Gate `wholesalePlan` on the priced variant row already loaded into `slowByKey` (`index.ts:795-825`). Until this lands, every signed-in buyer ordering 5+ of *anything* is silently invoiced 27–40% under quote. **Confirm the intended rule first** — the code and the comment at `:748` disagree.

**4. Fix P0-5 (member divergence).**
Prefill and bind the contact field to `user.email`. This is the one finding **no server-side check can ever catch**: the client's unit price is honest, only the total is wrong, and nothing verifies totals.

**5. Fix P0-4 properly, then re-enable B2G1.**
Re-arbitrate after the guest gate. Step 0 is a tourniquet, not a fix — don't leave the promo off permanently and call it done.

**6. Add `deno check` (or a tsconfig) for `supabase/functions` (P1-1).**
Cheapest structural win available. The 1,452-line file that moves all the money is currently typechecked by nothing. Do this before writing any more of it.

**7. Wire error tracking + a failed-order alert (P1-3).**
`ErrorBoundary.componentDidCatch` already has a comment marking the hook point. Until this exists, every finding above fails silently and you learn about it from a customer.

**8. Add tests for shipping and wholesale (P1-13).**
Extract `computeOrderPricing()` the way `priceCheck.ts` was extracted — that precedent proves the team does this well when it does it. Install `@vitest/coverage-v8` so the 80% bar in CLAUDE.md is measurable at all.

**9. Then the rest of P1**, roughly in this order: P1-4 (unprotected email fetch), P1-7 (NULL-priced inquiry lines), P1-5 (voucher race), P1-8 ($0 lines), P1-9 (`buyer_contact` index), P1-11 (cart totals), P1-12 (focus trap — `useFocusTrap.ts` already exists on `chore/price-increase-15`), P1-14 (write down rollback), P1-15/16 (generator + formula policy).

**10. Housekeeping.** Cherry-pick `507faac` (lazy 3D), `c882aa3` (`useFocusTrap`), and the price SQL off `chore/price-increase-15`, then **abandon that branch** — do not merge it. Delete the 7 fully-merged branches. Close PR #9.

### The two process changes that actually matter

- **Client and edge function must deploy together, atomically.** Today they're two manual commands; `place-order` v56 and the frontend landed **18 minutes apart**. That window happened to be harmless — this time.
- **`git commit -a` on `main` is how this happened.** `6e5334e` fused **57 files / 4,231 insertions** — fonts + a live pricing change + a 3,600-line Remotion workspace — into one commit, pushed it, and deployed it **17 seconds later**, while the hardening that made the same feature safe stayed on a branch. The fused commit's real cost wasn't messiness. It was that it shipped the feature and left the safety net. With no branch protection and 98% direct-to-main, nothing structurally prevents a repeat.

---

## What's already good

This section is not a courtesy. The engineering here is materially better than the deploy story suggests, and several of these are things most production codebases get wrong.

**Backend security discipline is genuinely excellent.**
- **50/50 `SECURITY DEFINER` functions pin `set search_path`** across all 56 migrations. Zero missing. This is the single most common Postgres RLS-bypass footgun and it is fully closed.
- **Every admin price-path RPC carries an internal `is_admin()` check** — independently verified for `save_order_lines`, `admin_create_order`, `set_order_shipping`, `import_inventory`, `set_product_price`, `create_order_from_inquiry`, `admin_upsert_coupon`. The SQL layer is uniformly gated, which is exactly why the four ungated *edge functions* read as an oversight rather than a pattern.
- **Every grant is explicitly revoked from `public` too**, not just `anon`/`authenticated` — the codebase internalized its own incident (`030_revoke_public_execute_mark_paid.sql`) and applied the lesson in every later migration.
- **This team already found and fixed a real privilege escalation**, textbook: `043_portal_identity_hardening.sql` closes writable `customer_profiles.tier/status` with a `BEFORE INSERT AND UPDATE` guard trigger that pins columns rather than raising — and correctly guards **both** INSERT and UPDATE, where most real-world fixes miss the direct-insert path.
- **`resolve-video` is a careful SSRF defense**, not a `fetch` wrapper: host allowlist checked *before* the request, **re-checked on the post-redirect resolved URL** (`:181-210`), 10s timeout, byte-capped streaming download (`:87-118`).
- **CORS hard-fails to the production origin** rather than `*` on a missing env var (`_shared/cors.ts:7-9`). Turnstile fails **closed**. CSP (`public/_headers`) is strict: `object-src 'none'`, `frame-ancestors 'none'`, no `unsafe-inline` for scripts.
- **No secrets in the repo or git history** — `git log -p --all -S` for `service_role`/`SUPABASE_SERVICE_ROLE_KEY`/`sk_live` returns only doc references, never a key. `dist/` is not committed.
- **Token-gated anon endpoints return uniform `{ok:false, reason}`** on every failure path — no error-shape oracle. Every table has RLS enabled (23/23); no `USING (true)` anywhere.

**The money architecture is right even where the implementation isn't.**
- **`stampedUserId` uses `auth.getUser(bearer)`** — a real round-trip to GoTrue, not a local decode. No forgery path found.
- **`redeem_coupon` uses `SELECT … FOR UPDATE` and `place-order` rolls back on a lost race** (`:1252-1293`). Textbook. The voucher path (P1-5) is the one place missing the pattern this codebase already invented.
- **Integer-cents discipline is clean.** No path found where a fractional cent reaches an order line or a displayed price. `clampQty`/`clampCents` (`:214-223`) correctly reject `NaN`/`Infinity`/negatives; `discountCents` is capped at `grossSubtotalCents` (`:1030`) so `totalCents` can never go negative — verified algebraically. `tierPriceCents:32` guards `!Number.isFinite(mg)`, so NaN cannot reach a price.
- **The client mirrors are deliberately display-only and say so.** `wholesale.ts:8-14`: *"the client never sends a discounted price, so the price-mismatch check stays honest."* `accountDiscount.ts:12`: *"NOT authoritative for billing."* This is a real architectural decision that keeps skew's blast radius at *preview ≠ invoice* rather than *wrong charge*. It deserves credit — the exceptions (the line-name string coupling, the 5-vs-3 threshold) are the bugs, not the design.
- **`effectiveTierPriceCents` vs `tierPriceCents`: the cart resolves correctly** through `variantPriceCents` (`cartActions.ts:112-118`), so admin overrides *are* honored. The known price-path trap is **not** tripped on the main cart path.
- **`AdminNewOrder` is a well-built price path** — uses `effectiveTierPriceCents`, skips null-priced variants (`:79`), and `admin_create_order` validates server-side (`041:91` rejects null/negative).
- **Idempotency**: read-before-write plus a `23505` unique-constraint backstop; `placeOrder.ts:52-79` binds the key to a cart signature so retries can't double-charge.
- **`confirm_order_fulfilled` and `cancel_order` use `for update` row locks** and roll back the whole transaction if any line would go negative. `stock_movements` is a real append-only ledger with `on_hand_after` snapshots.
- **Migrations are 100% additive** — no `DROP TABLE`/`DROP COLUMN`/`TRUNCATE` in 58 files; every `ADD COLUMN` guarded by an `information_schema` check.

**Frontend and delivery.**
- **Code-splitting is comprehensive and admin is genuinely isolated.** All 28 public pages and all 17 admin pages lazy-load individually (`App.tsx:23-63`); no admin chunk appears in `dist/index.html`'s modulepreload list. An anonymous shopper never fetches admin code — the opposite of the classic anti-pattern.
- **three.js is correctly excluded from the main/vendor chunks** and behind a lazy boundary — it does not block shell TTI.
- **Catalog imagery is already right**: 63 vial images all `.webp` (1.4MB total, ~22KB avg), 71 specimens all `.svg`; `loading="lazy"` on every tile image, each in an `aspect-square` wrapper so the box is reserved before decode — low real CLS despite no explicit width/height.
- **The 50-compound hot path has no algorithmic hazard** — `filtered`/`groupedSections` correctly `useMemo`'d, one O(n) `Map` pass, O(1) `bySku` lookups. No O(n²).
- **Near-zero type escape hatches**: `: any` → 0, `as any` → 0 real (1 false positive in a comment), `@ts-ignore`/`@ts-expect-error` → 0, across 38,661 lines. Strict flags on and enforced.
- **No empty catch blocks anywhere**; every `JSON.parse` call site is wrapped. A real `ErrorBoundary` (`App.tsx:78`) means a throw shows a branded screen, not a white one.
- **`placeOrder.ts` is well-engineered**: 30s `Promise.race` timeout, four distinct human-readable failure messages, cart-signature idempotency, and `clear()` only on confirmed success — a failed submit never strands or double-charges the buyer.
- **`npm audit` → 0 vulnerabilities**, `npm ci` verified deterministic, `deno.lock` carries real sha256 integrity hashes pinning `supabase-js` → 2.110.2, and **all 10 prod deps are actually imported** — zero dead weight.
- **Accessibility fundamentals are solid**: real skip link (`App.tsx:70-75` → `AnimatedPortalShell.tsx:33`), `lang="en"`, pinch-zoom not disabled, all 50 catalog images have real `alt` (decorative ones correctly `alt=""`), labels properly bound via `htmlFor`/`id`, dose pickers use correct `role="radiogroup"`/`aria-checked`.
- **The 3D hero respects `prefers-reduced-motion`** — `CompoundHologram3D.tsx:702` is `aria-hidden`, and the JS `useFrame` rotation checks the `reduced` flag (`:614-619`) rather than relying on the CSS blanket.
- **`DisclaimerGate` — the hard first-visit blocker — is fully correct**: real focus trap with wrap-around, initial focus, properly labelled controls. The one modal that does modality right, and the reference to copy.
- **The tests that exist are not shallow.** `priceCheck.test.ts:60-68` is a genuine zero-width-character evasion regression test. `coupons.test.ts:200-262` transcribes worked examples from the blueprint with dollar-exact assertions. `lineDiscounts.test.ts:41-48` checks the rounding remainder foots. The craftsmanship is high; the breadth is the problem.
- **`priceCheck.ts` was deliberately kept import-free so vitest could test it** (`:26`) — the right instinct, actually executed. It is the template for fixing P1-13.
- **The README is unusually honest** — it leads with "**`git push` deploys NOTHING**" and documents the worktree/`.env.local` trap that already caused a real outage.

---

*Read-only scan. No files were modified, no commits made, no deploys performed. The only file written is this document.*
