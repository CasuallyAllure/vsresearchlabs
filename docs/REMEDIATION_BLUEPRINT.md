# REMEDIATION BLUEPRINT — vsresearchlabs
### Master execution plan for the 2026-07-16 graded backlog

**Sources of truth:** `docs/SYSTEM_SCAN_2026-07-16.md` (whole-system scan, overall **D**) and `docs/REVIEW_2026-07-16.md` (5 P0s, verdict RED). Every packet below traces to a backlog ID in those documents. If a packet and the scan disagree, the scan wins — re-read it before coding.

**Audience:** multiple coding agents working in separate git worktrees, plus one human operator (Ray) for deploy/DB/ops steps. **Ambiguity is failure**; every packet names exact files and a testable done-condition.

**Ground rules for every agent:**
1. Branch from the tip of `main` *at the moment your wave opens* (after the prior wave's merges). Never branch from another packet's branch unless this document says so.
2. One packet = one branch = one PR. No fused commits. Do not touch files outside your packet's declared surface.
3. Do not run `npm run gen:inventory` (P1-15 landmine) unless you are executing packet PAR-H4.
4. Do not deploy. Deploys (`supabase functions deploy`, `wrangler`, `db push`) are operator-only steps, called out explicitly as OPS packets.
5. All new SQL migrations use the number pre-assigned in this document (§3.4). Never pick your own number.
6. Line numbers cited below are from the scan/review; they cite both `main@9e4e3d0` and `feat/launch-hardening-and-2026-polish`. **After OPS-2 merges the branch, the branch's line numbers are the live ones.** Re-locate by symbol name, not line number.

---

## 1. Executive shape of the plan

Two facts drive the whole structure:

- **Almost every P0/P1 money bug lives in one file**: `supabase/functions/place-order/index.ts` (1,452 lines, one `Deno.serve` handler). Work touching it **cannot be parallelized** — it is a single serial track, executed by one agent (or successive agents) in a fixed order.
- **Almost everything else is disjoint**: observability, CI, accessibility, performance, data migrations, test scaffolding, docs. These run in parallel worktrees with near-zero merge collision risk, subject to a handful of named file-contention points (§3.3).

So the plan is:

```
WAVE 0 (ops, hours)      : mitigate → deploy existing fixes → merge branch → protect main
WAVE 1..5 (agent waves)  : SERIAL TRACK (place-order money fixes, strict order)
                           + PARALLEL TRACKS (everything else) filling each wave
WAVE 6 (consolidation)   : extract computeOrderPricing, test it, final telemetry hook
```

There is also a second, smaller serial lane: the **cart-surface sub-track** (`CartDrawer.tsx` / `CartPage.tsx` / `PromoCode.tsx`), because four packets all edit those files (SER-A4 client half, PAR-H1, PAR-H2a, PAR-C1, PAR-C2). It is serialized in §3.2.

---

## 2. Work breakdown — packets

Effort: **S** ≤2h · **M** ≤1 day · **L** >1 day.
Grade notation: `Pricing F→D` means "moves the Pricing & money integrity domain grade from F to roughly D."

### 2.1 OPS packets (operator-executed, not agent-coded)

---

#### OPS-1 — Zero-deploy mitigation: disable B2G1
- **Backlog:** Scan step 0; defuses P0-4 cliff + P1-6 spoofing + live IGF-1 LR3 collision.
- **Touches:** one prod DB row: `promo_settings.b2g1_enabled = false`. No code, no branch.
- **Acceptance:** live read of `promo_settings` returns `b2g1_enabled: false`. Log the change (time + who) in `docs/GO_LIVE.md` or an ops note so SER-A5 knows to re-enable.
- **Grade impact:** Pricing F→E-ish (removes the live +$240 guest cliff and the whole B2G1 attack surface while fixes land). Temporary tourniquet, not credited as a fix.
- **Effort:** S (minutes). **Wave 0. Do first.**

#### OPS-2 — Deploy the branch's edge functions (closes P0-1, P0-2)
- **Backlog:** P0-1 (no server price verification), P0-2 (4 ungated notifiers / authenticated IDOR).
- **Command:** `supabase functions deploy place-order send-receipt send-processing-notification send-delivered-notification send-shipment-notification` from `feat/launch-hardening-and-2026-polish` (commit `7860e57` lineage). No migration required (scan verified: `shipping_cents` exists since 010/016/020).
- **Acceptance:**
  - Deployed `place-order` source contains `priceMismatches.push` (grep count ≥ 1; on old main it was 0).
  - Each of the 4 notifiers contains `requireAdmin(` (grep count ≥ 1 each; on old main it was 0).
  - Manual probe: signed-in **non-admin** JWT calling `send-receipt` with a valid foreign `order_id` gets a 401/403, not HTML.
  - Manual probe: order POST with `unitPriceCents: 1` on a priced SKU produces a price-mismatch `order_events` row / flagged email subject.
- **Grade impact:** Security D→**B**, Pricing F→**D** (verification exists; P0-3/4/5 still open).
- **Effort:** S. **Wave 0, immediately after OPS-1.**

#### OPS-3 — Merge `feat/launch-hardening-and-2026-polish` → `main`; enable branch protection
- **Backlog:** P1-2; ends the deployed↔main drift created by OPS-2; puts `ci.yml` on `main` for the first time.
- **Steps:** merge the branch (scan verified it is +9/−0 vs `main` — clean); then `gh api` / repo settings: protect `main` (require PR, require the `ci.yml` check, no force-push). Frontend redeploy from merged `main` so client and edge function stop being from different commits.
- **Acceptance:** `git merge-base --is-ancestor 7860e57 main` → true; `gh api repos/:owner/:repo/branches/main/protection` → 200 (was 404); `.github/workflows/ci.yml` present on `main` and a CI run visible on the merge commit.
- **Grade impact:** CI/CD D→**C**.
- **Effort:** S. **Wave 0. Everything in Wave 1 branches from this merged `main`.**

#### OPS-4 — Per-wave deploy gate (recurring)
- At the end of each wave: operator deploys edge functions + frontend **together** (the "atomic deploy" process rule from both docs), from the same `main` commit. Applies new migrations in number order first.
- **Acceptance per wave:** `supabase functions list` version timestamp and Cloudflare deploy timestamp within minutes of each other, both traceable to the same `main` SHA recorded in the wave log.

---

### 2.2 SERIAL TRACK packets (all touch `supabase/functions/place-order/index.ts` — strict order, one at a time)

> **Owner model:** one agent owns the serial track per wave. Each packet branches from `main` after the previous serial packet merged. **Never two open branches touching `place-order/index.ts`.** The shared price-check module `supabase/functions/place-order/priceCheck.ts` counts as the same surface.

---

#### SER-A3 — P0-3: Gate wholesale on the priced catalog variant (server)
- **Backlog:** P0-3. Server grants 27–40% wholesale on **any SKU**, priced off the client's own number; signed-in buyer qty 10 of a $200 non-biopeptide item is billed −$800 under quote.
- **Touches:** `supabase/functions/place-order/index.ts` (wholesale block; branch ~`:748-825`, symbols `wholesalePlan`, `slowByKey`, the `qty >= 3` eligibility at `:799`); new/extended unit tests in `tests/unit/` (see note on testability below).
- **Spec:**
  1. **First, confirm intent with the operator** (blocking question, do not guess): comment at `:748` says "every orderable dose"; client (`src/lib/wholesale.ts:55-64`, `BiopeptideResearchSupplies.tsx:121`) offers wholesale on **biopeptides only**, doses that are public + tracked + priced > 0. The scan's recommended rule: server eligibility must require the line to resolve to a **matched, priced variant row** from the `product_variant_stock` query already loaded into `slowByKey` — the data is fetched and unused.
  2. Price the pack value off the **server-resolved** variant price, never the client-sent `unit`.
  3. Align the threshold with the client: client `WHOLESALE_MIN_PACK = 5` (`cartActions.ts:36`) vs server `qty >= 3` (P2 asymmetry) — pick one floor (client's 5 is the advertised one) and use it on both sides.
- **Acceptance:**
  - A line whose SKU has no priced variant row can never enter `wholesalePlan` (unit test).
  - Pack value computed from server price: test with client `unit` lying high and low; billed discount unchanged.
  - Reproduce the scan's exploit as a test: signed-in, `laboratory-equipment` @ $200 × 10 → billed **$2,000 + shipping rules**, not $1,200.
  - Threshold: qty 3–4 of an eligible dose gets **no** wholesale on either client or server.
  - Existing 41 unit tests still pass; `deno check` (once PAR-F1 lands) clean.
- **Grade impact:** Pricing D→**C-** (largest silent money leak closed). **Effort: M.** **Wave 1.**

#### SER-A4 — P0-5: Bind checkout contact to the session; resolve membership from the JWT
- **Backlog:** P0-5. Client `isMember = !!user`; server requires `authedEmail === contact`. Member typing any other email (or a phone number — field is literally "Email or Phone \*") is silently billed as guest: +$249.99 (+69.4%) on the scan's worked example. **No price check can ever catch this** — only totals are wrong.
- **Touches:** client — `src/layout/CartDrawer.tsx` (contact `useState('')` at ~`:94`, `isMember` ~`:82`), `src/pages/CartPage.tsx` (~`:96`, `:72`, the "Email or Phone \*" field ~`:817`, validation ~`:124`); server — `supabase/functions/place-order/index.ts` `stampedUserId` block (~`:618-643`).
- **Spec:**
  1. **Client:** when signed in, prefill contact from `user.email` and either lock it or show an explicit inline warning that member pricing requires the account email. Add email-format validation on the contact field for signed-in users (guests may still use phone; but then the UI must not promise member perks).
  2. **Server:** resolve membership from the verified JWT alone (`auth.getUser(bearer)` already exists); treat `contact` as a **delivery/notification address, not an identity claim**. Perks gated on `stampedUserId` (free shipping, wholesale, account discount, reward voucher) key off the JWT identity.
  3. Keep the invoice-email suppression logic for non-email contacts, but it must no longer strip membership.
- **Acceptance:**
  - Signed-in user + contact field showing a *different* email/phone → server still stamps `user_id`, still applies member shipping/discounts (integration-style test or documented manual probe with two dummy accounts).
  - Signed-in UI: contact prefilled with `user.email`; changing it triggers the warning (or is impossible).
  - Client `isMember` and server membership can no longer diverge for a signed-in session: drawer/preview total equals server-billed total on the scan's headline case ($60 case ×10, member → $360-class total both sides).
  - Guest flow unchanged: no JWT → guest shipping + no member perks.
- **Grade impact:** Pricing C-→**C+** (kills the +69% overbilling class and the trust gap). **Effort: M.** **Wave 2.**
- **Note:** the client half opens the **cart-surface sub-track** (§3.2). PAR-H1/H2a/C1/C2 must branch *after* this merges.

#### SER-A5 — P0-4: Re-arbitrate B2G1 after the guest gate; re-enable B2G1
- **Backlog:** P0-4. Hard `else-if` arbitration + guest gate drops the wholesale plan with **no fallback to B2G1** → guest qty 9 = $369.99, qty 10 = $609.99 (+$240 for one more vial).
- **Touches:** `supabase/functions/place-order/index.ts` — arbitration (`else-if` at branch `:821-825` / symbol `wholesalePlan` vs `b2g1FreePlan`) and the guest/account gate (branch `:840-842`); unit tests.
- **Spec:** if `wholesalePlan` is dropped (guest, or post-SER-A3 ineligibility), re-evaluate the affected lines for B2G1 instead of discarding all discounts. Result must be **monotonic**: for a fixed eligible item, total(qty n+1) ≤ total(qty n) + unit price, always.
- **Acceptance:**
  - Table test replaying the scan's example: $60 slow vial, guest, B2G1 on → qty 9 = $369.99 **and** qty 10 ≤ $429.99 (B2G1 applied), never $609.99.
  - Monotonicity property test across qty 1..15 for a slow eligible dose, guest and member.
  - **Then OPS:** re-enable `promo_settings.b2g1_enabled = true` (reverses OPS-1) only after this deploys — this packet's definition of done includes telling the operator to flip it back.
- **Grade impact:** Pricing C+→**B-** (last P0 closed; all five P0s now dead). **Effort: M.** **Wave 3.**

#### SER-A6 — P1-6 + P2-squash: one dose resolver, shared, hardened
- **Backlog:** P1-6 (B2G1 eligibility spoofable via `note`; live IGF-1 LR3 `0.1mg`/`1mg` collision) + P2 "two `squash` definitions disagree."
- **Touches:** `supabase/functions/place-order/index.ts` (`isSlow` matcher, `squash` at branch `:788`, `note` usage `:800`); `supabase/functions/place-order/priceCheck.ts` (export the longest-match resolver + the Unicode-stripping `squash` at `:59-60`); `tests/unit/priceCheck.test.ts`.
- **Spec:** export the longest-match dose resolver and the hardened `squash` from `priceCheck.ts`; use them for B2G1/slow matching in `index.ts`. Match against `product.name` **only** (the dose is baked into it by `cartActions.ts variantProduct`); `note` must never be an identity signal. Delete the weak local `squash`.
- **Acceptance:**
  - `grep -c "const squash" supabase/functions/place-order/index.ts` → 0 (single definition lives in `priceCheck.ts`).
  - Regression tests: (a) IGF-1 LR3 collision — 3 × "IGF-1 LR3 — 0.1mg" with `1mg` slow does **not** qualify B2G1; (b) `note: "5mg"` on a "X — 20mg" line does **not** flip eligibility; (c) zero-width-char line resolves identically in price check and promo check.
- **Grade impact:** Pricing B-→B- (hardening; enables safely keeping B2G1 on), Security B→B+. **Effort: M.** **Wave 4.**

#### SER-A7 — P1-5: Atomic reward-voucher consume (TOCTOU)
- **Backlog:** P1-5. Filtered CAS UPDATE never checked for match → two concurrent checkouts, one voucher, two 40% discounts.
- **Touches:** **migration `060_voucher_atomic_consume.sql`** (new RPC, `SELECT … FOR UPDATE`, returns the consumed row or nothing — mirror `redeem_coupon`; `SECURITY DEFINER` + pinned `search_path` + explicit revokes, matching the house pattern); `supabase/functions/place-order/index.ts` (read `:693-706`, consume `:1190-1211` → call the RPC, and on a lost race roll back the discount exactly like the coupon path `:1252-1293`); tests.
- **Acceptance:**
  - The edge function checks the RPC result; a no-match consume removes the voucher discount from the order (or rolls back), never silently keeps it.
  - Migration follows house rules: additive, idempotent guard, `set search_path`, revoke from `public`.
  - Unit test on the rollback arithmetic; RLS-suite test if Docker available.
- **Grade impact:** Pricing B-→**B**. **Effort: M.** **Wave 4 (immediately after SER-A6, same agent).**

#### SER-A8 — P1-4: Harden the email/notification path in the handler
- **Backlog:** P1-4. `sendResendEmail`'s bare `fetch` (`:422`) + unwrapped business-notification call (`:1430`) can throw *after* the order committed → buyer sees failure on a successful order; hardcoded `invoiceEmailSent: contactIsEmail` (`:545`) can lie.
- **Touches:** `supabase/functions/place-order/index.ts` only.
- **Spec:** try/catch inside `sendResendEmail`; top-level try/catch on the handler that still returns a truthful success if the order committed; persist `invoice_email_sent` from the actual send result (column addition, if needed, goes in migration **061** — coordinate with §3.4) instead of asserting it; include the `VSR-ORD-…` order number in **every** `console.*` in the handler (fixes the P2 "logs not keyed by order" for this file).
- **Acceptance:** simulated Resend failure (bad key in a dev run / mocked fetch) → order still succeeds, response truthful about email status, one structured log line with the order number; `grep -n "console" supabase/functions/place-order/index.ts` shows no log line in the order path without an order identifier.
- **Grade impact:** Observability D-side→C for the money path; Security/Pricing steady. **Effort: S/M.** **Wave 5.**

#### SER-A9 — P1-10 + P1-8(server half): the price check flags everything it skips
- **Backlog:** P1-10 (lines failing `SKU_RE` silently dropped from query *and* report) + P1-8 server half ($0/unpriced lines skipped by `priceCheck.ts:78`'s `price_cents != null` filter).
- **Touches:** `supabase/functions/place-order/index.ts` (`:566-602`), `supabase/functions/place-order/priceCheck.ts` (`:116-139`, `:78`), `tests/unit/priceCheck.test.ts`.
- **Spec:** `SKU_RE` failure ⇒ mismatch entry with `serverCents: null`; a line with `unitPriceCents === 0` ⇒ flagged unconditionally; a SKU with no priced rows ⇒ "unresolved" flag, not silence.
- **Acceptance:** unit tests: `"BPC-157 "` (trailing space) + any price → flagged; `unitPriceCents: 0` → flagged; SKU with zero priced variants → flagged. No false-positive regression on the existing 41 tests (watch `priceCheck.ts:96` known false positive — do not widen it).
- **Grade impact:** Pricing B→**B+**, Security B+→A-. **Effort: S.** **Wave 5 (same agent as SER-A8).**

#### SER-A10 — P2 sweep inside the handler: rate-limit normalization, field caps, sanitized second `.in()`
- **Backlog:** P2 items: case-sensitive rate limiter (`:609-616`; fix pattern = `send-contact/index.ts:199-203`'s `.ilike()`/lowercase), unbounded `product.id/name/sku/category` (`:478-497` — cap like `note` ≤1000), unsanitized SKU in the promo-detection `.in()` (`:773-793` — reuse `SKU_RE` filter with the same "flag, don't drop" semantics from SER-A9).
- **Touches:** `supabase/functions/place-order/index.ts`; optionally `supabase/functions/send-inquiry/index.ts` (same limiter bug at `:364-368`).
- **Acceptance:** `Buyer@x.com` and `buyer@x.com` share one rate bucket (test the normalizer as a pure function or via extracted helper); oversized `product.name` (e.g. 10 KB) rejected with 4xx; poison SKU in one line no longer suppresses promo detection for other lines (unit test via the extracted matcher).
- **Grade impact:** Security A-→A- (rounds out edge hardening). **Effort: S.** **Wave 5.**

#### SER-E2 — P1-13 core: extract `computeOrderPricing()` and table-test the whole money path
- **Backlog:** P1-13, plus the P2 "800-line cap" as it applies to `place-order` (this is the sanctioned first slice of splitting the 1,452-line file).
- **Touches:** `supabase/functions/place-order/index.ts` (extract the pure pricing pipeline: shipping, wholesale plan, B2G1 arbitration + re-arbitration, account discount, voucher, coupon composition, totals) → new import-free module `supabase/functions/place-order/computeOrderPricing.ts` (follow the `priceCheck.ts` precedent: no Deno/supabase imports so vitest can run it); `tests/unit/computeOrderPricing.test.ts` (new).
- **Why last on the serial track:** every prior serial packet changes this exact logic; extracting first would force serial rebases of everything.
- **Acceptance:**
  - `place-order/index.ts` handler shrinks materially (target: pricing logic fully out; file under ~1,000 lines) and calls the pure function.
  - Table tests cover: guest vs member shipping (`GUEST_SHIPPING_CENTS`), wholesale case/half thresholds and gating (post-SER-A3 rules), B2G1 incl. re-arbitration (post-SER-A5), voucher + coupon composition, monotonicity property.
  - Behavioral no-op: golden tests written **before** extraction against current outputs pass after.
  - Coverage (via PAR-E1's `@vitest/coverage-v8`) reports the new module ≥ 80% — the first time CLAUDE.md's bar is measurable on the money path.
- **Grade impact:** Testing C-→**B**, FE/backend quality C+→B, Pricing B+→**A-** (regression-proofed). **Effort: L.** **Wave 6.**

#### SER-B2b — Telemetry hook inside `place-order`
- **Backlog:** P1-3 (edge-side error tracking), final wiring.
- **Touches:** `supabase/functions/place-order/index.ts` — call the `_shared` telemetry helper built by PAR-B2a from the handler's catch paths and from email-failure branches (SER-A8's structure makes this a ~20-line change).
- **Acceptance:** thrown error in a dev invocation produces an event in the error tracker tagged with function name + order number (when available); no PII beyond what the tracker config allows.
- **Grade impact:** Observability →**B**. **Effort: S.** **Wave 6 (fold into SER-E2's PR only if trivial; otherwise its own branch after).**

---

### 2.3 PARALLEL TRACK packets (disjoint surfaces — run concurrently in worktrees)

#### Track B — Observability & error tracking

**PAR-B1 — Frontend error tracking (Sentry or equivalent)**
- **Backlog:** P1-3 (frontend half). `ErrorBoundary.tsx:28` already marks the hook point.
- **Touches:** `src/components/ErrorBoundary.tsx` (`componentDidCatch`), `src/main.tsx` (init — keep it **out of the critical shell path**: lazy/deferred init so PAR-D3 isn't undermined), `package.json` (+1 dep), env plumbing for the DSN (document in `docs/SUPABASE_SECRETS.md` pattern — DSN is not a secret but keep the convention), CSP: `public/_headers` needs the tracker's ingest origin added to `connect-src`.
- **Acceptance:** a deliberately thrown render error in dev reaches the tracker dashboard; `ErrorBoundary` still shows the branded screen; `npm run build` passes; CSP not loosened beyond the single ingest origin; bundle-size delta of the shell recorded in the PR (must not regress shell gzip by >10 KB — pick the slim SDK).
- **Grade:** Observability D→**C**. **Effort: M.** **Wave 1.**

**PAR-B2a — Edge telemetry shared module + notifier/inquiry functions**
- **Backlog:** P1-3 (edge half), P2 unstructured logs.
- **Touches:** new `supabase/functions/_shared/telemetry.ts` (capture helper + structured log formatter keyed by order number/function name); wire into catch paths of `send-receipt`, `send-processing-notification`, `send-delivered-notification`, `send-shipment-notification`, `send-order-invoice`, `send-inquiry`, `send-contact`, `mark-payment-claimed`. **Explicitly NOT `place-order`** (that is SER-B2b).
- **Acceptance:** each listed function's catch path calls the helper; forced failure in one notifier (dev) produces a tracked event; alert rule created (operator step, document it): "any error event from an order-path function" pages email. No behavior change on success paths.
- **Grade:** Observability C→**C+/B-**. **Effort: M.** **Wave 2.**

**PAR-B3 — Uptime monitoring + failed-order alerting runbook**
- **Backlog:** P1-3 (monitoring/alerting slice).
- **Touches:** docs only (`docs/GO_LIVE.md` or new section in the rollback runbook from PAR-F2): uptime check on the storefront + a scheduled probe of `place-order` OPTIONS/health, alert destinations, who gets paged. Operator sets up the external monitor (ops step listed for Ray).
- **Acceptance:** documented, monitor live (operator confirms), test alert received.
- **Grade:** Observability →B- (with B2a/B2b, domain lands **B**). **Effort: S.** **Wave 2.**

#### Track C — Accessibility (buy path)

**PAR-C1 — `useFocusTrap` extraction + apply to the four leaky modals**
- **Backlog:** P1-12. `DisclaimerGate.tsx:54-81` is the correct in-repo reference; `useFocusTrap.ts` also exists on `chore/price-increase-15` (`c882aa3`) — cherry-pick or re-derive, whichever is cleaner (PAR-F3 stages the cherry-pick).
- **Touches:** new `src/lib/useFocusTrap.ts`; `src/components/catalog/CompoundIntelligenceOverlay.tsx` (`:195-209,319`), `src/layout/CartDrawer.tsx` (`:236-248` + the `focus:outline-none` control at `:464-473` gets a visible focus style), `src/layout/NavDrawer.tsx`, `src/components/account/MemberAccessGate.tsx` (`:164`); optionally refactor `DisclaimerGate.tsx` to consume the hook.
- **Constraint:** touches `CartDrawer.tsx` → **cart-surface sub-track member** (§3.2). Branch only after PAR-H2a merges.
- **Acceptance:** keyboard-only walkthrough (documented in PR): open each of the four → focus moves in, Tab wraps, Shift-Tab wraps, Esc closes, focus restores to trigger; page behind not reachable while open. `aria-modal` now truthful in all four.
- **Grade:** Accessibility C+→**B**. **Effort: M.** **Wave 4.**

**PAR-C2 — Contrast + tap targets on catalog and cart**
- **Backlog:** P2 a11y cluster: contrast (nickname badge `CompoundTile.tsx:155-161` 2.9:1; tile desc `:164-170`; `text-ink/40–/55` in `CartDrawer.tsx:330,345,361,376,641,649,660,666` and `CartPage.tsx:785-786,815-816,850`) and tap targets (`DoseTierChips.tsx:65,128` ~13–22px; `CompactProductTile.tsx:159-193,203-218`; `CartPage.tsx:626-633,640-646,666-673`). `CompoundTile.tsx:286-296` (`h-[27px]`) is the in-repo reference for correct sizing.
- **Touches:** the files above only. **Cart-surface sub-track member** for the two cart files — branch after PAR-C1.
- **Acceptance:** all cited text ≥ 4.5:1 against its actual background (record measured ratios in the PR); all cited controls ≥ 24×24 CSS px hit area; visual diff screenshots attached; no layout regression on mobile width 360px.
- **Grade:** Accessibility B→**B+**. **Effort: M.** **Wave 5.**

**PAR-C3 — Landmarks, form-error association, misc AT fixes**
- **Backlog:** P2: duplicate `<main>` (`AnimatedPortalShell.tsx:33` + `ProductPage.tsx:466`); `Field.tsx:68-94,112-146` add `aria-describedby` linking error text to input; shipping-tier dot `CompactProductTile.tsx:109-116` gets `role="img"`.
- **Touches:** `src/layout/AnimatedPortalShell.tsx`, `src/pages/ProductPage.tsx`, `src/components/ui/Field.tsx` (path per repo — locate by filename), `src/components/catalog/CompactProductTile.tsx`. No cart files → fully parallel.
- **Acceptance:** exactly one `<main>` per rendered page (check ProductPage); screen-reader (VoiceOver pass or axe-core run documented) announces the error when focusing an invalid field; axe-core on `/` and one product page shows no landmark violation.
- **Grade:** Accessibility (with C1+C2 → domain **B+**). **Effort: S.** **Wave 1.**

#### Track D — Performance

**PAR-D1 — Lazy-gate the hero 3D (cherry-pick `507faac`)**
- **Backlog:** P2: `HeroHoloCarousel` 255 KB gzip unconditionally above the fold; fix already written on `chore/price-increase-15` (`507faac perf: lazy 3D visualizer`).
- **Touches:** `src/pages/Landing.tsx` (`:682`) + whatever `507faac` touches (verify with `git show 507faac --stat` first; cherry-pick, resolve, do **not** merge the branch — scan says the branch as a whole is a merge hazard).
- **Acceptance:** homepage network trace: `HeroHoloCarousel-*.js` not fetched until the hero is near-viewport/idle; `prefers-reduced-motion` behavior preserved (`CompoundHologram3D.tsx:614-619` check intact); Lighthouse/`dist` stat in PR showing shell unchanged and hero chunk deferred.
- **Grade:** Performance C+→**B-**. **Effort: S/M.** **Wave 2 (after PAR-F3 stages the cherry-pick).**

**PAR-D2 — Fonts: kill the render-blocking Google CDN chain + metric fallbacks**
- **Backlog:** P2: Inter via `@import` on Google CDN, no preconnect (`src/index.css:10`); no `size-adjust`/`ascent-override` on 7 self-hosted faces (`src/theme/fonts-v2.css:18-69`). P3: dead `stix-two-text-600.woff2` declaration; stale `?fontstack=v1` comment (`index.css:7-8`); wrong `tailwind.config.js:74` comment.
- **Touches:** `src/index.css`, `src/theme/fonts-v2.css`, `tailwind.config.js` (comment), `public/` (if self-hosting Inter — preferred, siblings already self-hosted).
- **Acceptance:** zero requests to `fonts.googleapis.com`/`gstatic.com` in a cold-load trace (or, minimum bar, preconnect + non-blocking load); all faces have metric-matched fallbacks (`size-adjust`/`ascent-override`); CLS on the landing headings measurably reduced (before/after in PR); dead declaration and lying comments removed.
- **Grade:** Performance B-→B-. **Effort: S/M.** **Wave 1.**

**PAR-D3 — Defer the Supabase SDK out of the shell**
- **Backlog:** P2: module-scope `.load()` in `src/main.tsx` forces 49.75 KB gzip SDK + modulepreload into every page load.
- **Touches:** `src/main.tsx`, `src/lib/supabase.ts` (make the client a lazy singleton behind a dynamic import), call-site audit for top-level awaits of the client.
- **Acceptance:** `dist/index.html` no longer modulepreloads `supabase-*.js`; homepage loads and renders with the SDK chunk absent from the initial waterfall; auth/session restore still works (manual: sign in, reload, still signed in); all e2e routes green; shell gzip reduction recorded (~45–50 KB expected).
- **Grade:** Performance →**B**. **Effort: M (touchy — audit carefully).** **Wave 3.**

#### Track E — Testing scaffolding (non-serial half)

**PAR-E1 — Coverage tooling + money-mirror tests + cross-file constant guard**
- **Backlog:** P1-13 (scaffolding half), P2 `WHOLESALE_PACKS` sync guard, P3 `rewardAccrual` fixture honesty.
- **Touches:** `package.json` (+`@vitest/coverage-v8`), vitest config, `.github/workflows/ci.yml` (coverage step — **coordinate: PAR-F1 owns ci.yml; land F1 first, E1 rebases**), new `tests/unit/wholesale.test.ts` + `tests/unit/shipping.test.ts` (table tests over `src/lib/wholesale.ts` `wholesalePackPricing`/`wholesaleDoses`/`formatPerVial` — incl. the `$NaN` guard fix `wholesale.ts:89-94` `if (!Number.isFinite(cents)) return '—'`, that one-line fix belongs here), new `tests/unit/constantsAgree.test.ts` asserting client `WHOLESALE_PACKS` (`wholesale.ts:39-40`) equals server `WHOLESALE_CASE`/`WHOLESALE_HALF` (`place-order/index.ts:758-759`) by importing/parsing both; rename or annotate `tests/fixtures/rewardAccrual.ts` so it stops reading as coverage.
- **Acceptance:** `npx vitest run --coverage` succeeds and reports; tests reference `GUEST_SHIPPING_CENTS`, `shippingCentsFor`, `wholesalePackPricing`, `wholesaleDoses` (grep — scan showed 0 references, must be >0 each); constant-agreement test fails if either side's percentages move alone; `formatPerVial(NaN)` → `'—'`.
- **Grade:** Testing D+→**C-**. **Effort: M.** **Wave 1.**

#### Track F — CI / release hygiene

**PAR-F1 — Typecheck the money path in CI (`deno check`) + CI hardening**
- **Backlog:** P1-1. `supabase/functions/**` typechecked by nothing today.
- **Touches:** `.github/workflows/ci.yml` (add `deno check supabase/functions/**/index.ts` + shared modules; pin the Deno setup action by SHA — see PAR-F4's pinning theme), optionally a `deno.json`/task. **Owns `ci.yml` this wave** (E1 rebases on it).
- **Acceptance:** CI run shows the deno check step passing on `main`; a deliberate type error in a scratch branch of `place-order/index.ts` fails CI (prove once, screenshot in PR); branch-protection required-checks updated to include it (operator toggle, note in PR).
- **Grade:** CI/CD C→**C+**, underwrites every serial packet. **Effort: S.** **Wave 1.**

**PAR-F2 — Rollback runbook for all three deploy targets**
- **Backlog:** P1-14.
- **Touches:** new `docs/ROLLBACK.md` (+ README pointer). Content per scan: **frontend** — `wrangler rollback` usage + rebuild-from-commit fallback; **edge functions** — checkout last-good SHA + `supabase functions deploy`, plus the practice of tagging each deploy (`deploy/edge/YYYY-MM-DD` tags) so a clean revert target always exists; **DB** — honest "forward-fix only" policy, with the additive-migration convention written down and the OPS-4 wave-gate order (migrations → functions → frontend).
- **Acceptance:** doc exists; operator dry-runs `wrangler rollback --help` path once and confirms the edge-function steps against a real historical version; README links it.
- **Grade:** CI/CD C+→**B-**. **Effort: S/M.** **Wave 1.**

**PAR-F3 — Branch garden: cherry-pick the salvage, delete the dead**
- **Backlog:** P2 `chore/price-increase-15` merge hazard; P3 seven fully-merged branches + PR #9.
- **Steps (agent prepares, operator pushes deletions):** cherry-pick onto small branches: `c882aa3` (`useFocusTrap.ts` — feeds PAR-C1) and `507faac` (lazy 3D — feeds PAR-D1); the 15% price SQL is a **business decision** — stage it as a patch file in `docs/` or a branch and hand to operator, do not apply. Then delete `design/2026-polish-pass`, `design/monochrome-instrument`, `feat/checkout-hardening`, `feat/coupons-affiliates`, `feat/white-label-foundation`, `feature/accounts-and-design-refresh`, `inventory/images-and-intelligence` (all verified +0 ahead); close PR #9; **abandon (do not merge) `chore/price-increase-15`** after salvage.
- **Acceptance:** `git branch -r` shows the seven gone; PR #9 closed with a comment pointing here; two cherry-pick branches exist and build.
- **Grade:** CI/CD hygiene support. **Effort: S.** **Wave 1 (early — C1/D1 depend on it).**

**PAR-F4 — Dependency queue + pin the deploy tools**
- **Backlog:** P2 dependabot stalled (root cause was P1-2 — now fixed by OPS-3/PAR-F1); P2 `wrangler`/`supabase` CLIs unpinned where the deploy credentials live.
- **Touches:** `package.json`/`package-lock.json` (add `wrangler` + `supabase` as pinned devDependencies; README `:34-36` switches `npx <tool>` to the lockfile-pinned versions); then shepherd the 5 open dependabot PRs through the now-working CI (rebase → green → merge), plus one `npm install` pass for the 15 in-range-behind packages.
- **Acceptance:** `npm ls wrangler supabase` resolves from the lockfile; dependabot open-PR count 0; `npm audit` still 0; CI green on each merge.
- **Grade:** Dependencies B→**A-**, CI/CD →B. **Effort: M (mostly waiting on CI).** **Wave 2 (needs OPS-3 + PAR-F1 landed).**

#### Track G — Data integrity (migrations — numbers pre-assigned, see §3.4)

**PAR-G1 — Migration `059`: functional index on `buyer_contact`**
- **Backlog:** P1-9. Every fraud-gate/status/coupon-abuse lookup full-scans `orders`.
- **Touches:** new `supabase/migrations/059_buyer_contact_index.sql`: `create index if not exists idx_orders_buyer_contact_norm on orders ((lower(btrim(buyer_contact))));` — match the exact expression used at `012:217`, `016:68`, `028:175`, `031:189,262`, `043:258`, `048:74`, `053:69`, `057:157` (verify each predicate's expression; if any differs, index each distinct expression).
- **Acceptance:** migration idempotent (`if not exists`); after apply, `EXPLAIN` on the coupon-abuse lookup shows an index scan (operator runs against prod read-only or a local db).
- **Grade:** Data B-→B. **Effort: S.** **Wave 1.**

**PAR-G2 — Migration `061` + invoice-surface fix: no more NULL/formula prices**
- **Backlog:** P1-7 (`create_order_from_inquiry` writes NULL `unit_price_cents`; `027:73-76`), P2 invoice fallback (`InvoiceDocument.tsx:33-40`, `TrackOrder.tsx:50`, `OrderView.tsx:144` render the placeholder formula), P2 money-column CHECK.
- **Touches:** new `supabase/migrations/061_inquiry_lines_priced.sql`: `create or replace` of `create_order_from_inquiry` to resolve `unit_price_cents` from the variant (or `raise exception` when unresolvable), preserving `is_admin()` gate + `search_path` pin; add `check (unit_price_cents is null or unit_price_cents >= 0)` on `order_lines` as `NOT VALID` then `VALIDATE` (legacy-safe) — full NOT NULL is deferred until legacy rows audited (note it in the migration comment). Client: `unitOf()` fallbacks in `src/components/documents/InvoiceDocument.tsx`, `src/pages/TrackOrder.tsx`, `src/pages/admin/OrderView.tsx` (paths approximate — locate by filename) render `—`, never `tierPriceCents` formula.
- **Acceptance:** RLS/unit test or scripted check: `create_order_from_inquiry` on a priced variant writes the variant price; on an unpriceable line it raises; a synthetic NULL-priced line renders `—` on all three surfaces (component test or storybook screenshot); migration idempotent.
- **Grade:** Data B→**B+**, Pricing support. **Effort: M.** **Wave 2.**

**PAR-G3 — Migration `062`: rate-limit `lookup_order`**
- **Backlog:** P2. `grant execute … to anon`, brute-forceable via PostgREST (~100k ZIP space; email path practical).
- **Touches:** new `supabase/migrations/062_lookup_order_ratelimit.sql` — add an attempt-tracking table or leverage the existing rate-limit pattern; throttle per contact+IP-hash or add a small `pg_sleep`/attempt counter with lockout. Keep the uniform `{ok:false, reason}` shape (house rule — no error oracle).
- **Acceptance:** >N failed lookups for one order number within the window → refusals; success path latency unchanged; response shape unchanged on all failure paths.
- **Grade:** Security A- support, Data B+. **Effort: S/M.** **Wave 3.**

#### Track H — Frontend money-display correctness

**PAR-H1 — One shared cart-total function (P1-11)**
- **Backlog:** P1-11: drawer `breakdown` omits coupons when no account discount (`CartDrawer.tsx:627-636`); `PromoCode.tsx:65,200-205` renders a second contradictory total; `/cart` has **no grand total** (`CartPage.tsx:681-745`).
- **Touches:** new `src/lib/cartTotals.ts` (pure; consumes the same inputs the server pricing uses — after SER-E2 lands, converge on shared shapes, but do not block on it); `src/layout/CartDrawer.tsx`, `src/pages/CartPage.tsx`, `src/components/cart/PromoCode.tsx` (locate by filename). **Cart-surface sub-track: branch after SER-A4 merges.**
- **Acceptance:** exactly one "Total" figure per surface; coupon-without-account-discount included in it (regression test in vitest on `cartTotals`); `/cart` shows a labelled grand total **including shipping**; drawer/page totals agree with each other for the same cart; known-gap disclosure ("wholesale/B2G1 finalized at invoice") rendered where the client can't compute server-only discounts, rather than a silently wrong number.
- **Grade:** FE quality C+→**B-**, Pricing trust support. **Effort: M.** **Wave 3.**

**PAR-H2a — Kill reachable $0 lines client-side (P1-8 client half)**
- **Backlog:** P1-8: `cartActions.ts:117` `?? 0`; six live non-mg doses billable at $0; `canQuickAdd` used at only 2 of 11 call sites.
- **Touches:** `src/lib/cartActions.ts` (`lineUnitCents` → `number | null`; `canQuickAdd`), `src/lib/pricing.ts` (typing only — policy change is PAR-H3), payload builders in `CartDrawer.tsx` (~`:193`) and `CartPage.tsx` (~`:188`) refuse null-priced lines, and the 9 unguarded call sites: `CompoundTile.tsx:92`, `CompactProductTile.tsx:70`, `ProductCard.tsx:66`, `BiopeptideInventoryModal.tsx:52`, `CompoundIntelligenceOverlay.tsx:174,236`, `ProductPage.tsx:151`, `CompoundIntelligenceHero.tsx:368` — all route through `canQuickAdd`. **Cart-surface sub-track: branch after PAR-H1 merges.**
- **Acceptance:** each of the six known doses (`VSR-RS-HCG` 1000/2000/5000/10000iu, `VSR-RS-LMB 10ml`, `VSR-RS-LIPC 10ml`) shows no Add affordance (or a "price on request" state) and cannot reach the payload; unit test: `lineUnitCents` returns `null`, never `0`, for a non-mg unpriced dose; `grep -rn "?? 0" src/lib/cartActions.ts` → 0 on the price line; typecheck green (the `number | null` ripple is the real work).
- **Grade:** Pricing support (closes the historical $0-line class), FE quality →B. **Effort: M.** **Wave 4.**

**PAR-H3 — One pricing-fallback policy (P1-16)**
- **Backlog:** P1-16: formula fallback produces $14,420 vials; `productOverrides.ts:253-259` contradicts the stated policy at `:237-242`; 87/~130 variants have `priceCents == null` in generated JSON.
- **Touches:** `src/lib/pricing.ts` (`:33-35` formula; `:4` stale comment), `src/lib/productOverrides.ts` (`:250` default-true `isVariantPublic`; `:259` supply-signal escape hatch).
- **Spec:** **Confirm with operator, then enforce "no price ⇒ hide"** (the policy `:237-242` claims): drop the supply-signal escape hatch; the formula becomes dev-only or is deleted; `wholesaleDoses` can then never include a formula-priced dose.
- **Acceptance:** a tracked-but-unpriced dose (stock received, no price imported) does **not** publish (unit test on `isVariantPublic`); grep shows no production call path into the formula (or the formula deleted); the three absurd examples (korean-glutathione 1200mg etc.) unreachable; stale comments fixed.
- **Grade:** Pricing support, FE quality →B. **Effort: M.** **Wave 2 (before H2a is fine — different files; coordinate the one-line `pricing.ts` overlap: H3 owns `pricing.ts`, H2a rebases).**

**PAR-H4 — Defuse `gen:inventory` (P1-15)**
- **Backlog:** P1-15: running the generator drops `korean-glutathione` and resurrects `10-amino-1mq` unpriced; the "deterministic/byte-identical" claim at `buildInventory.mjs:15-17` is false.
- **Touches:** `scripts/buildInventory.mjs` (fail-loud guard: refuse to write if the output would **drop** any SKU present in the current generated file, unless `--allow-drops`; fix or remove the false determinism banner) + manifest/META reconciliation (add `korean-glutathione` META + manifest row; explicitly tombstone `10-amino-1mq` if it is meant to stay gone).
- **Acceptance:** dry-run mode (`--check`) exits nonzero listing WOULD ADD/WOULD DROP before any write; after reconciliation, a real run is byte-identical to the committed generated file (`git diff --exit-code`); the six P1-8 unpriced doses unaffected.
- **Grade:** Data B+→**B+/A-** support. **Effort: S/M.** **Wave 1.**

#### Track I — P3 housekeeping (single sweep packet)

**PAR-I1 — Truth pass + strictness + records**
- **Backlog:** P3 items not absorbed elsewhere: lying comments (`place-order/index.ts:684` free-shipping-for-guests claim — comment fix only, coordinate with serial track owner or fold into SER-A8), Remotion license note (record the ≤3-employee tripwire in `docs/` — one paragraph in `docs/ROLLBACK.md`-adjacent ops notes or `CLAUDE.md`), `noUncheckedIndexedAccess` in `tsconfig.app.json` (**time-boxed**: enable, fix fallout if <2h, else revert and file as debt), typed supabase accessor to replace the 17 `supabase!.` assertions (optional, only if the strictness flag lands), stale `deno.lock` workspace mirror note.
- **Acceptance:** grep confirms each fixed comment; build + typecheck green; anything reverted is listed in the PR as explicit debt.
- **Grade:** FE quality →B+ rounding. **Effort: S/M.** **Wave 5 (lowest priority — drop if capacity is short).**

---

## 3. Dependency graph, waves, and collision control

### 3.1 Wave plan

Every wave ends with OPS-4 (atomic migrate→functions→frontend deploy from one `main` SHA). A packet may start as soon as its listed dependencies are **merged**, but agents should treat wave boundaries as sync points.

| Wave | Serial track (one agent, strict order) | Parallel tracks (concurrent worktrees) | Ops |
|---|---|---|---|
| **0** (hours) | — | — | **OPS-1** (B2G1 off) → **OPS-2** (deploy branch functions) → **OPS-3** (merge branch, protect `main`, redeploy frontend) |
| **1** | **SER-A3** wholesale gate (needs operator intent answer first) | **PAR-F1** CI deno-check · **PAR-F3** branch garden/cherry-picks · **PAR-E1** test scaffolding (rebases on F1's ci.yml) · **PAR-B1** frontend Sentry · **PAR-G1** migration 059 index · **PAR-F2** rollback runbook · **PAR-H4** gen:inventory guard · **PAR-C3** landmarks/Field · **PAR-D2** fonts | OPS-4 |
| **2** | **SER-A4** contact binding (opens cart sub-track) | **PAR-B2a** edge telemetry (non-place-order) · **PAR-B3** uptime/alerts · **PAR-G2** migration 061 inquiry pricing + invoice `—` · **PAR-D1** lazy 3D (needs F3) · **PAR-H3** pricing-fallback policy · **PAR-F4** dependabot + pin deploy tools (needs F1) | OPS-4 |
| **3** | **SER-A5** B2G1 re-arbitration → **OPS: re-enable B2G1** | **PAR-H1** shared cart totals (needs A4) · **PAR-D3** defer Supabase SDK · **PAR-G3** migration 062 lookup_order limit | OPS-4 + B2G1 on |
| **4** | **SER-A6** shared dose resolver → **SER-A7** voucher RPC (migration 060) | **PAR-H2a** $0 lines client (needs H1) · **PAR-C1** focus traps (needs H2a for CartDrawer; overlay/NavDrawer parts can start earlier) | OPS-4 |
| **5** | **SER-A8** email hardening → **SER-A9** flag-what-you-skip → **SER-A10** P2 sweep | **PAR-C2** contrast/tap targets (needs C1) · **PAR-I1** housekeeping sweep | OPS-4 |
| **6** | **SER-E2** extract `computeOrderPricing` + table tests → **SER-B2b** place-order telemetry | — (all parallel tracks complete; agents idle-verify: run full test suite, axe pass, Lighthouse) | OPS-4 + final re-grade (§6) |

### 3.2 The two serial lanes (why these can't parallelize)

**Lane 1 — `supabase/functions/place-order/` (index.ts + priceCheck.ts):**
`SER-A3 → SER-A4(server) → SER-A5 → SER-A6 → SER-A7 → SER-A8 → SER-A9 → SER-A10 → SER-E2 → SER-B2b`.
One open branch at a time, ever. Rationale: 1,452-line single handler, untyped until PAR-F1, every packet edits overlapping pricing logic. Any parallel attempt here produces semantic (not just textual) merge conflicts in money code.

**Lane 2 — cart surfaces (`CartDrawer.tsx`, `CartPage.tsx`, `PromoCode.tsx`):**
`SER-A4(client) → PAR-H1 → PAR-H2a → PAR-C1(CartDrawer part) → PAR-C2(cart files part)`.
These are otherwise-parallel-track packets that happen to share two big files; they simply queue behind each other. Their non-cart file edits (e.g. C1's overlay/NavDrawer, C2's tile chips) don't need to wait — an agent may split a packet's cart-file edits into the queued branch and land the rest early, **if** it says so in the PR.

**Everything else is parallel-safe by construction:** disjoint files, plus three named contention points:
- `.github/workflows/ci.yml`: owner order **F1 → E1** (E1 rebases).
- `package.json`/lockfile: touched by B1, E1, F4, D3 — trivial dep-add conflicts; merge in wave order, rebase, re-run `npm ci`.
- `src/lib/pricing.ts`: **H3 owns it**; H2a limits itself to type-signature ripple and rebases on H3.

### 3.3 Migration number assignments (collision control)

| Number | Packet | File |
|---|---|---|
| `059` | PAR-G1 | `059_buyer_contact_index.sql` |
| `060` | SER-A7 | `060_voucher_atomic_consume.sql` |
| `061` | PAR-G2 | `061_inquiry_lines_priced.sql` |
| `062` | PAR-G3 | `062_lookup_order_ratelimit.sql` |
| `063+` | reserved | any packet discovering a needed migration asks the lead before taking a number |

Numbers are reserved even if waves reorder; a skipped number is fine, a duplicated one is not. All migrations: additive, idempotent guards, `SECURITY DEFINER` ⇒ pinned `search_path` + revoke from `public` (house pattern, 50/50 compliance today — keep it 54/54).

### 3.4 Dependency edges (explicit)

```
OPS-1 → OPS-2 → OPS-3 → {everything}
OPS-3 → PAR-F1 → PAR-E1, PAR-F4
PAR-F3 → PAR-C1 (useFocusTrap cherry-pick), PAR-D1 (lazy-3D cherry-pick)
SER-A3 → SER-A4 → SER-A5 → SER-A6 → SER-A7 → SER-A8 → SER-A9 → SER-A10 → SER-E2 → SER-B2b
SER-A4 → PAR-H1 → PAR-H2a → PAR-C1(cart part) → PAR-C2(cart part)
SER-A5 → OPS re-enable B2G1
PAR-B2a → SER-B2b (shared telemetry module must exist)
PAR-E1 → SER-E2 (coverage tooling must exist)
PAR-H3 → PAR-H2a (pricing.ts ownership)
OPS-1 …reversed by… SER-A5's deploy (B2G1 stays OFF until then)
```

---

## 4. Branch strategy

**Model:** trunk-based with short-lived packet branches; each agent works in its own git worktree; merges via PR into protected `main` (protection live after OPS-3), CI (PAR-F1's checks) required. Squash-merge each packet — one commit per packet on `main`, titled with the packet ID.

**Branch names (one per packet, exactly these):**

| Packet | Branch | Merge order within wave |
|---|---|---|
| SER-A3 | `fix/a3-wholesale-server-gate` | Wave 1 — **merge last in wave** (biggest review) |
| PAR-F1 | `ci/f1-deno-check` | Wave 1 — merge **first** (everything after gets typechecking) |
| PAR-F3 | `chore/f3-branch-garden` (+ `pick/useFocusTrap`, `pick/lazy-3d` staging branches) | Wave 1 — second |
| PAR-E1 | `test/e1-coverage-and-money-mirrors` | Wave 1 — after F1 |
| PAR-B1 | `obs/b1-frontend-error-tracking` | Wave 1 |
| PAR-G1 | `db/g1-buyer-contact-index` | Wave 1 |
| PAR-F2 | `docs/f2-rollback-runbook` | Wave 1 |
| PAR-H4 | `fix/h4-gen-inventory-guard` | Wave 1 |
| PAR-C3 | `a11y/c3-landmarks-and-field-errors` | Wave 1 |
| PAR-D2 | `perf/d2-fonts-selfhost-fallbacks` | Wave 1 |
| SER-A4 | `fix/a4-contact-binding-membership` | Wave 2 — merge last in wave |
| PAR-B2a | `obs/b2a-edge-telemetry-shared` | Wave 2 |
| PAR-B3 | `docs/b3-uptime-alerting` | Wave 2 |
| PAR-G2 | `db/g2-inquiry-lines-priced` | Wave 2 |
| PAR-D1 | `perf/d1-lazy-hero-3d` | Wave 2 |
| PAR-H3 | `fix/h3-pricing-fallback-policy` | Wave 2 |
| PAR-F4 | `chore/f4-deps-and-pinned-deploy-tools` | Wave 2 — merge last of parallel (lockfile churn) |
| SER-A5 | `fix/a5-b2g1-rearbitration` | Wave 3 — merge last in wave |
| PAR-H1 | `fix/h1-shared-cart-totals` | Wave 3 |
| PAR-D3 | `perf/d3-defer-supabase-sdk` | Wave 3 |
| PAR-G3 | `db/g3-lookup-order-ratelimit` | Wave 3 |
| SER-A6 | `fix/a6-shared-dose-resolver` | Wave 4 |
| SER-A7 | `fix/a7-voucher-atomic-consume` | Wave 4 — after A6 |
| PAR-H2a | `fix/h2a-null-price-lines` | Wave 4 |
| PAR-C1 | `a11y/c1-focus-traps` | Wave 4 — after H2a |
| SER-A8 | `fix/a8-email-path-hardening` | Wave 5 |
| SER-A9 | `fix/a9-flag-skipped-lines` | Wave 5 — after A8 |
| SER-A10 | `fix/a10-handler-p2-sweep` | Wave 5 — after A9 |
| PAR-C2 | `a11y/c2-contrast-tap-targets` | Wave 5 |
| PAR-I1 | `chore/i1-truth-pass` | Wave 5 — merge last |
| SER-E2 | `refactor/e2-compute-order-pricing` | Wave 6 — first |
| SER-B2b | `obs/b2b-place-order-telemetry` | Wave 6 — after E2 |

**Anti-collision rules:**
1. Serial-lane branches are cut from `main` only after the previous serial branch merged. No stacking.
2. Parallel branches rebase onto `main` before requesting merge; merge order within a wave follows the table (infrastructure first, big-file serial packets last so parallel PRs don't rot behind them).
3. A packet touching a file outside its declared surface must say so in the PR title and get lead sign-off — that's how we keep the collision map true.
4. Worktrees: `git worktree add ../wt-<branch-suffix> <branch>` — never share a worktree between packets.
5. No agent pushes to `main` directly (protection enforces this after OPS-3 — that's the point of doing it first).

---

## 5. The critical serial track vs. safe parallel tracks — one-page card

**CRITICAL SERIAL TRACK (money; one agent at a time; strict order):**
1. **OPS-1** B2G1 off (mitigation) →
2. **OPS-2** deploy branch functions = **server price authority live** (P0-1) + IDOR closed (P0-2) →
3. **OPS-3** merge + protect →
4. **SER-A3** P0-3 wholesale gate →
5. **SER-A4** P0-5 contact/member binding →
6. **SER-A5** P0-4 B2G1 re-arbitration → re-enable B2G1 →
7. **SER-A6/A7** spoof-proof resolver + voucher race →
8. **SER-A8/A9/A10** email path, flag-the-skipped, P2 sweep →
9. **SER-E2** extract + table-test `computeOrderPricing` → **SER-B2b** telemetry hook.

**SAFE PARALLEL TRACKS (any number of agents, disjoint surfaces):**
- **Observability:** PAR-B1 (frontend Sentry), PAR-B2a (edge shared telemetry), PAR-B3 (uptime/alerts).
- **Accessibility (buy path):** PAR-C3 (landmarks/field errors) anytime; PAR-C1/C2 queue only for their cart-file slices.
- **Performance:** PAR-D2 (fonts), PAR-D1 (lazy 3D), PAR-D3 (defer SDK).
- **Testing scaffolding:** PAR-E1 (coverage + money-mirror tests + constant guard).
- **CI/branch protection/release:** PAR-F1 (deno check), PAR-F2 (rollback runbook), PAR-F3 (branch garden), PAR-F4 (deps + pinned deploy tools).
- **Data:** PAR-G1 (index 059), PAR-G2 (inquiry pricing 061 + invoice `—`), PAR-G3 (lookup limit 062).
- **Money display / catalog policy:** PAR-H3 (fallback policy), PAR-H4 (generator guard); PAR-H1/H2a queue on the cart lane.
- **Housekeeping:** PAR-I1.

---

## 6. Re-grade checklist — projected grades as packets land

Baseline (scan): **Overall D.** Pricing F · Security D · Data B- · Testing D+ · CI/CD D · Deps B · Perf C+ · A11y C+ · FE quality C+ · Observability D · video B.

| Checkpoint | Packets landed | Domain movements | **Projected overall** |
|---|---|---|---|
| **After Wave 0** | OPS-1,2,3 | Pricing F→**D** (price authority live; P0-3/4/5 open, P0-4 mitigated) · Security D→**B** (IDOR closed) · CI/CD D→**C** (ci.yml on main + protection) | **C-** |
| **After Wave 1** | SER-A3 + F1,F3,E1,B1,G1,F2,H4,C3,D2 | Pricing D→**C-** (wholesale leak closed) · Testing D+→**C-** (coverage measurable, money mirrors tested) · CI/CD C→**B-** (typechecked money path + rollback runbook) · Observability D→**C** (frontend tracking) · Data B-→**B** (index) · A11y C+ (partial) | **C** |
| **After Wave 2** | SER-A4 + B2a,B3,G2,D1,H3,F4 | Pricing C-→**C+** (member divergence dead) · Observability C→**B-** (edge telemetry + uptime) · Data B→**B+** (inquiry pricing) · Perf C+→**B-** (lazy 3D) · Deps B→**A-** (queue cleared, tools pinned) | **C+** |
| **After Wave 3** | SER-A5 (+B2G1 back on) + H1,D3,G3 | Pricing C+→**B-** (**all five P0s closed, promo restored safely**) · Perf B-→**B** (SDK deferred) · FE quality C+→**B-** (one truth for totals) | **B-** |
| **After Wave 4** | SER-A6,A7 + H2a,C1 | Pricing B-→**B** (spoofing + voucher race closed) · A11y →**B** (focus traps) · FE quality →**B** ($0 lines dead) | **B-/B** |
| **After Wave 5** | SER-A8,A9,A10 + C2,I1 | Security →**A-** (edge P2 sweep) · Pricing B→**B+** (nothing skipped silently) · A11y →**B+** (contrast/targets) | **B** |
| **After Wave 6 (final)** | SER-E2, SER-B2b | Testing →**B** (money path table-tested, ≥80% on pricing module) · Pricing B+→**A-** (regression-proofed) · Observability →**B** · FE quality →**B+** (place-order under control) | **B+** |

**Final re-grade procedure (Wave 6 exit):** re-run the scan's verification table — `priceMismatches.push` count ≥1 deployed; `requireAdmin` in all 4 notifiers deployed; branch protection 200; `npm audit` 0; `vitest --coverage` ≥80% on `computeOrderPricing`/`priceCheck`/`wholesale`/`shipping`; monotonicity test green; B2G1 on with hardened resolver; one Total per cart surface; axe pass on `/`, product page, cart; `EXPLAIN` shows the 059 index used. If all pass, claim **B+**. The residual gap to A is structural (forward-only DB, single operator, manual Zelle verification) and is priced into the runbooks, not the code.

**Standing risks the plan carries (acknowledged, not solved here):**
- SER-A3 and PAR-H3 both **block on an operator intent decision** (wholesale scope; no-price-means-hide). Ask in Wave 0, in writing.
- OPS-2 creates deployed↔main drift for hours; OPS-3 exists to close it same-day. Do not let Wave 0 span days.
- Wave-end deploys are still manual; PAR-F2/OPS-4 make them scripted-checklist manual. True deploy automation is post-blueprint work.

---

*This blueprint is a read-only product of the 2026-07-16 scan/review. No code was modified in producing it. Line numbers drift; symbols don't — agents re-locate by symbol.*
