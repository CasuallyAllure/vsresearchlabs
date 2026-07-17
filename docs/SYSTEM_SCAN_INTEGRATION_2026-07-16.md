# Integration Re-Grade — 2026-07-16 (overnight run)

**Subject:** branch `integration/remediation-2026-07-16` — `main@9e4e3d0` plus six
merged remediation branches, graded against the **same 11-domain rubric** as
`docs/SYSTEM_SCAN_2026-07-16.md` (baseline: overall **D**).

**What this grades:** the integrated code **as if deployed**. Nothing here is
deployed; production still runs `9e4e3d0`. The deploy sequence is
`docs/DEPLOY_PLAN.md`. Where the scan graded "what is deployed," this document
grades "what the morning deploy ships" — the same standard applied to the same
artifact at the moment it matters.

**Verification state (all run on this branch, 2026-07-17):**
`npx tsc -b` ✅ · `deno check supabase/functions/` ✅ · `npx vitest run` ✅
**143 passed** / 21 skipped (RLS suite self-skips without Docker, unchanged) ·
`npx eslint .` ✅ 0 errors (43 warnings, non-blocking by CI design) ·
`npm run build` ✅. Two integration issues were found and fixed during
verification: a telemetry log referencing the pricing lane's removed
`priceMismatches` array (`deno check` caught it; commit `2b7e850`), and the
adversarial review's bundle-pairing gap (commit `f7a028a`, § Adversarial
review below).

---

## Overall grade: **B-** (was **D**)

The five P0s are closed in this code — confirmed independently by an
adversarial re-review (§ Adversarial review, below). Money now has a server
authority: every line price is verified against the admin catalog and checkout
**fails closed** on a mismatch. The IDOR is gated. The promo engine is pure,
unit-tested, and monotonic. Errors page the operator instead of vanishing.

Why not the blueprint's B+ target: B+ was the **Wave 6** exit. This
integration lands waves 0–3 plus roughly half of waves 4–5. The honest gaps
that hold it at B-: the reward-voucher TOCTOU is still open (P1-5), coverage
is still unmeasurable (no `@vitest/coverage-v8`), three live doses are still
buyer-priceable (flagged, not refused), the two perf packets and the shared
cart-total function never existed as branches, and branch protection remains
an operator toggle. All of it is enumerated per-domain below.

---

## Scorecard

| # | Domain | Was | **Now** | Δ | One-line justification |
|---|---|---|---|---|---|
| 1 | **Pricing & money integrity** | F | **B-** | +5 | All five P0s closed with a fail-closed server price authority and a pure, property-tested promo engine; voucher race + three formula-priced doses keep it from B. |
| 2 | **Security & authz** | D | **B+** | +4 | IDOR gated, price check authoritative, payload fields capped; the already-A-grade SQL discipline now has a matching edge layer. Rate-limiter case bucket + `lookup_order` throttle still open. |
| 3 | **Data integrity** | B- | **B+** | +2 | NULL-priced inquiry lines impossible (raise + `NOT VALID` CHECK), measured functional indexes, `gen:inventory` fail-loud. Invoice formula fallback survives for legacy rows only. |
| 4 | **Testing** | D+ | **C+** | +2 | 41 → 134 tests, and the new ones sit exactly on the money path (34 promo-arbitration incl. a qty-1..20 monotonicity property, 35 price-check). Coverage still unmeasurable; client wholesale/shipping mirrors still untested. |
| 5 | **CI/CD & release hygiene** | D | **B-** | +3 | Five hard gates including `deno check` of the money path; rollback runbook for all three targets. Protection not yet enabled (operator), deploys still manual. |
| 6 | **Dependencies** | B | **B** | 0 | Untouched by this integration. Deploy tools still unpinned; dependabot queue unblocks only after this lands on `main`. |
| 7 | **Performance** | C+ | **C+** | 0 | No perf packet landed: Supabase SDK still in the shell, hero 3D still eager, Inter still on the Google CDN. |
| 8 | **Accessibility** | C+ | **B** | +1.5 | Real focus traps on all four `aria-modal` buy-path surfaces; ≥24px targets and ≥4.5:1 text on catalog+cart. Duplicate `<main>` and `Field` error association still open. |
| 9 | **Frontend quality** | C+ | **B-** | +1 | Five new small pure modules; but `place-order/index.ts` grew to 1,670 lines and the cart-total duplication (P1-11) is untouched. |
| 10 | **Observability** | D | **B-** | +3 | Client + edge error tracking, operator alert on every money-path failure stage, logs keyed by order number. No uptime monitor yet (operator step). |
| 11 | **`video/` workspace** | B | **B+** | +0.5 | Untracked from the repo entirely (`63d809e`); zero build impact is now structural. License tripwire note still worth recording. |

Rubric arithmetic sanity check: nothing below C+, four domains at B or above,
the two money domains at B-/B+ — a **B-** overall, honestly earned, not
rounded up.

---

## Domain evidence (every claim cited against this branch)

### 1. Pricing & money integrity — F → B-

**Closed:**
- **P0-1** — the price check is authoritative and fail-closed.
  `supabase/functions/place-order/index.ts:645-653`: `verifyLinePrices(...)`
  → on failures, `409` with `priceFailureMessage`; the order is never
  created. `priceCheck.ts` exports the verdict API; a `SKU_RE`-failing SKU is
  **rejected, not skipped** (index.ts:616 comment + `priceCheck.test.ts`, 35
  tests). A `$0`/`unitPriceCents: 1` line on a priced SKU is refused. This
  supersedes the deployed build's never-written `priceMismatches` array.
- **P0-3** — wholesale eligibility is a server fact.
  `supabase/migrations/063_wholesale_eligible.sql` adds + seeds
  `product_variant_stock.wholesale_eligible` (63 compounds true; instruments
  and consumables false; **default false** for new SKUs).
  `place-order/promoPlan.ts` gates the plan on the matched eligible variant
  row and prices packs off the **server-resolved** price. The floor is now 5
  on both sides (`promoPlan.ts:20-31` `WHOLESALE_HALF.size = 5` vs client
  `cartActions.ts:36` `WHOLESALE_MIN_PACK` derived from the same pack table)
  — the 3-vs-5 asymmetry is gone.
- **P0-4** — pricing is monotonic. The account gate lives **inside**
  `buildPromoPlans`, which re-arbitrates a dropped wholesale line back to
  B2G1 (`promoPlan.ts`); `tests/unit/promoPlan.test.ts` (34 tests) pins the
  scan's $60-vial worked example and a qty-1..20 monotonicity property for
  guest and member. The known tier-boundary counterexample (15 vials < 14 at
  a half-kit edge, in the buyer's favor) is pinned as intentional
  (`docs/PRICING_P0_NOTES.md` §6).
- **P0-5** — membership comes from the verified JWT alone
  (`index.ts:673-…`, comment documents the removed `authedEmail === contact`
  requirement); contact is a delivery address. Client prefills from
  `user.email` (`src/lib/useAccountEmailPrefill.ts`, wired in
  `CartDrawer.tsx:98`, `CartPage.tsx:111`; 7 tests).
- **P1-6** — one hardened, longest-match dose resolver shared between the
  price check and promo matching; `note` is no longer an identity signal
  (pricing-lane commits `290f0c0`, `c1c2c02`;
  `tests/unit/catalogDoseResolution.test.ts` checks the live catalog for
  substring collisions — the IGF-1 LR3 `0.1mg`/`1mg` collision class).
- **P2 items closed in passing:** unbounded item fields capped
  (`index.ts:527` id/name ≤200, note ≤1000, items ≤100, `MAX_LINE_CENTS`
  $100k sanity cap at `:196`); bundle/wholesale/B2G1/voucher exclusivity is
  explicit and ordered (`index.ts:930-966`), every flat reduction capped at
  the remaining subtotal (`:1106-1146`).

**Still open (why this isn't B):**
- **P1-5 voucher TOCTOU** — the consume is still an unchecked filtered CAS
  (`index.ts:1343-1347`); two concurrent checkouts can still double-spend a
  voucher. Migration number 060 remains reserved for the RPC fix.
- **Three live doses are buyer-priceable** — `VSR-RS-TB4-005 5mg`,
  `VSR-RS-KISS 5mg`, `VSR-RS-TA1 5mg` have no admin price, so the check can
  only flag (⚠ email + `order_events`), not refuse. Closes with a price
  import, no code (`docs/PRICING_P0_NOTES.md` §3, DEPLOY_PLAN §5.2).
- **P1-16 client half** — the supply-signal escape hatch survives
  (`src/lib/productOverrides.ts:293-299`): a tracked-but-unpriced dose with
  stock still publishes at the formula price client-side. The server now
  flags those lines, so the blast radius is *display*, not billing.
- **P1-11** — drawer and `/cart` still compute their own totals
  (`CartDrawer.tsx:645-…`, `CartPage.tsx:713-…`, now with a third input —
  the bundle); no shared `cartTotals.ts`.
- Rate limiter still case-sensitive (`index.ts:664-671`, `.eq("contact", …)`).

### 2. Security & authz — D → B+
- The four notifiers call `requireAdmin(req)` (grep: 2 hits each in
  `send-receipt`, `send-processing-notification`,
  `send-delivered-notification`, `send-shipment-notification`) — P0-2 closed.
- The price check is now a security control (self-invoicing dead), and the
  pricing lane's own adversarial re-review commit (`1c6fa4b`) bounded the
  line-name attack surface.
- Backend discipline unchanged from the scan's A- assessment (search_path
  pinning, `is_admin()` on every price-path RPC, explicit public revokes —
  migrations 059/061/063 all follow the house pattern).
- Open: `lookup_order` anon rate limit (reserved migration 062, never
  written); the place-order/inquiry rate-limit case bucket; voucher race
  (also a security finding to the extent it's exploitable by one buyer with
  two tabs).

### 3. Data integrity — B- → B+
- `061_inquiry_lines_priced.sql`: `create_order_from_inquiry` resolves each
  line from the priced variant (longest-match, mirroring `priceCheck.ts`) or
  **raises naming the inquiry + line**, aborting the conversion; adds a
  `NOT VALID` CHECK (`unit_price_cents >= 0`, NULL forbidden on new rows)
  grandfathering legacy rows — P1-7 closed, the P2 money-column CHECK
  half-closed.
- `059_buyer_contact_index.sql`: functional indexes built from the
  **measured** call sites — the commit corrected the blueprint (seven of its
  nine cited sites were wrong; the coupon-abuse lookup lives on
  `coupon_redemptions`) — P1-9 closed, better than specced.
- `scripts/buildInventory.mjs`: all writes queued; the run **aborts before
  touching a file** if it would drop a committed slug or revive a tombstoned
  one; `--check` reports ADD/DROP/MODIFY and writes nothing — P1-15 defused
  (the standing "do not run gen:inventory" rule can be retired after one
  supervised `--check` run).
- Open: the three invoice surfaces still fall back to the formula for
  NULL-priced lines (`src/components/order/InvoiceDocument.tsx:37`,
  `src/pages/TrackOrder.tsx:50`, `src/pages/admin/OrderView.tsx:144`) —
  reachable for **legacy** rows only now that 061 blocks new ones. Render
  `—` remains the right one-line fix.

### 4. Testing — D+ → C+
- 41 → **143** passing tests, concentrated on the money path:
  `promoPlan.test.ts` 34 (arbitration, guest re-arbitration, monotonicity
  property), `priceCheck.test.ts` 35 (incl. zero-width evasion + fail-closed
  verdicts), `bundle.test.ts` 10 + `bundlePlan.test.ts` 9 (server pair math
  incl. the unverified-line exploit), `coupons.test.ts` 14,
  `catalogDoseResolution.test.ts` 3 (live-catalog collision sweep),
  `useAccountEmailPrefill.test.ts` 7, `telemetry.test.ts` 20,
  `lineDiscounts` 6, `rewardAccrual` 5. The promo engine was extracted pure
  (`promoPlan.ts`, import-free) precisely so vitest could hold it — the
  `priceCheck.ts` precedent, repeated (and repeated again for
  `bundlePlan.ts` during this run).
- Open: `@vitest/coverage-v8` still not installed → CLAUDE.md's 80% bar
  still unmeasurable (`grep coverage package.json` → nothing). Client money
  mirrors (`wholesale.ts`, `shippingCentsFor`, `GUEST_SHIPPING_CENTS`) still
  have zero references in tests; the client↔server pack-constant agreement
  test was never written. E2E still doesn't run in CI. The full
  `computeOrderPricing()` extraction (SER-E2) remains undone — `promoPlan`
  covers arbitration, not shipping/coupon composition/totals.

### 5. CI/CD & release hygiene — D → B-
- `.github/workflows/ci.yml` on the branch (lands on `main` with the morning
  merge): five hard gates — `tsc -b` (app + vite config + **tests/**, whose
  new `tests/tsconfig.json` also pins `priceCheck.ts`), `deno check
  supabase/functions/`, `npm run test`, `npm run lint` (zero errors
  enforced), `npm run build`. The money path is typechecked by CI for the
  first time (P1-1 closed).
- `docs/ROLLBACK.md`: rollback for all three targets, verified against the
  installed tooling, including the honest "DB is forward-fix only" policy and
  deploy tagging — P1-14 closed. Branch-protection settings + the exact
  `gh api` command are documented there for the operator.
- Open: protection is **not enabled** (and cannot be until `ci.yml` exists on
  `main` — sequenced in DEPLOY_PLAN §5.4); deploys remain manual; the
  atomic migrate→functions→frontend rule is now written down but not
  scripted.

### 6. Dependencies — B (unchanged)
Untouched. `npm audit` 0 at last verification; `wrangler`/`supabase` still
run via `npx`, unpinned (P2 open); the 5 dependabot PRs remain stalled until
`ci.yml` reaches `main` — this integration is the unblock, not the merge.

### 7. Performance — C+ (unchanged)
No perf packet was ever branched. Still true on this branch: Supabase SDK
modulepreloaded into every page (`src/main.tsx:31-34` module-scope `.load()`
calls; `dist` shows `supabase-*.js` 49.75 kB gzip), `HeroHoloCarousel`
255 kB gzip eager above the fold, Inter render-blocking on the Google CDN
(`src/index.css:10`), no metric-matched font fallbacks. PAR-D1/D2/D3 are the
next wave's work; the cherry-pick source for lazy-3D (`507faac`) still sits
on `chore/price-increase-15`.

### 8. Accessibility — C+ → B
- `src/hooks/useFocusTrap.ts` (105 lines: wrap-around Tab/Shift-Tab, initial
  focus, Esc, focus restore) applied to all four leaky `aria-modal`
  surfaces: `CompoundIntelligenceOverlay`, `CartDrawer` (`:123`),
  `NavDrawer`, `MemberAccessGate` — P1-12 closed; `aria-modal` is now
  truthful on the highest-traffic surfaces.
- Tap targets ≥24px and text contrast ≥4.5:1 on `DoseTierChips`,
  `CompactProductTile`, `CompoundTile`, cart rows (a11y-lane commits
  `8ff51a0`, `2e6dc1c`) — the P2 contrast/target cluster closed.
- Open: duplicate `<main>` (`AnimatedPortalShell.tsx:33` +
  `ProductPage.tsx:466`), `Field` errors still not `aria-describedby`-linked,
  shipping-tier dot still role-less (PAR-C3 was never branched).

### 9. Frontend quality — C+ → B-
- New, small, single-purpose modules: `promoPlan.ts` (198), `bundle.ts`,
  `telemetry.ts` (client+edge), `useFocusTrap.ts`, `useAccountEmailPrefill.ts`
  — all under the file cap, all tested.
- Open: `place-order/index.ts` **grew** to 1,651 lines (bundle + telemetry +
  pricing landed in one file; SER-E2's extraction is the sanctioned fix);
  cart totals still duplicated drawer-vs-page with the bundle now a third
  moving part (P1-11); the invoice formula fallback (§3); the stale-comment
  P3 sweep untouched.

### 10. Observability — D → B-
- Client: `src/lib/telemetry.ts` captures boundary/window/rejection errors
  (session-capped, size-capped) → `report-error` edge function;
  `ErrorBoundary.componentDidCatch` finally has its "real telemetry sink".
- Edge: `_shared/telemetry.ts` — `captureException`, structured `logEvent`
  keyed by function + order number, and `alertOperator` (Resend email, kill
  switch `ALERTS_ENABLED`, destination defaulting to `inquiries@`). Every
  money-path failure stage in `place-order` alerts: inquiry insert, order
  insert, coupon/voucher anomalies, buyer-invoice failure, business
  notification failure, unhandled (via `withTelemetry`, which alerts and
  rethrows — behavior-preserving by design, `telemetry.ts:220-244`).
- `invoiceEmailSent` is now derived from the actual send result on the main
  path (`index.ts:1572`) — the P1-4 "hardcoded lie" variant is half-fixed
  (the idempotent-duplicate reply at `:587`/`:1251` still asserts it).
- Open: no uptime monitor / external probe (operator step, documented);
  `sendResendEmail`'s inner `fetch` can still throw on network failure —
  it's now *caught and alerted* at the top level rather than handled
  per-call-site, so a post-commit email blip still reads as a failed order
  to the buyer (P1-4 residue).

### 11. `video/` — B → B+
Untracked entirely by `63d809e` (`git ls-files video/` → 0); gitignored;
zero build impact is now structural rather than incidental. The Remotion
≤3-employee license tripwire still deserves its one-paragraph ops note (P3).

---

## Adversarial re-review (independent subagent, money paths)

A skeptical senior-reviewer agent was pointed at the integrated branch with
instructions to **refute** each P0-closure claim and hunt for
merge-introduced regressions (bundle × new-arbitration interplay, telemetry
wrapper semantics, cart-surface auto-merges).

**Conclusion: all five P0s confirmed closed**, each verdict backed by
file:line and — for P0-3/P0-4 — by regression tests reproducing the original
scan's exact dollar figures:

| Claim | Verdict | Key evidence |
|---|---|---|
| P0-1 price authority, fail-closed | **CLOSED** | `index.ts:604-658` → 409 before any DB write; `unitPriceCents: 1` refused (`price_mismatch`), trailing-space SKU refused (`malformed_sku` — also closes the review's P1-3 silent-skip), `$0` refused (`zero_price`); catalog read failure → 503, never fail-open. Attempted bypass via dose-text→override fallthrough is explicitly blocked (`priceCheck.ts:196-204`). |
| P0-2 notifier IDOR | **CLOSED** | `requireAdmin(req)` before any DB access in all four (`send-receipt:235`, `send-processing:152`, `send-delivered:98`, `send-shipment:192`); `adminGate.ts:29-52` does a real `auth.getUser()` + `is_admin()` RPC, fails closed, uniform 401. |
| P0-3 wholesale server gate | **CLOSED** | `promoPlan.ts:129-145`: requires a resolved variant row with `wholesale_eligible === true`; pack value from `row.price_cents`, never the client's number (no other feed found); `promoPlan.test.ts:74-96` replays the exploit incl. a forged `category` → zero wholesale. |
| P0-4 monotonic guest pricing | **CLOSED** | Guest `packValue` forced to 0 **inside** arbitration (`promoPlan.ts:188`) so the line falls to B2G1 in the same pass. Hand-replayed: $60 vial, guest — qty 9 → $369.99, qty 10 → **$429.99** (was $609.99); `total(10) ≤ total(9) + unit` exactly. Pinned at `promoPlan.test.ts:280-330`. |
| P0-5 JWT membership | **CLOSED** | `index.ts:690-715`: `stampedUserId` from `auth.getUser(bearer)` alone; the email-match branch only logs. All perks key off `stampedUserId`. Client prefill via `useAccountEmailPrefill`; `supabase.functions.invoke` attaches the session bearer regardless of the typed contact. |
| Merge regressions (bundle/telemetry/cart) | **1 found, fixed** | Exclusivity ordering, reduction caps, `withTelemetry` rethrow semantics, and cart payload builders all verified coherent. **MEDIUM finding:** bundle pair value was computed from client-sent `unitPriceCents` without excluding *unverified* (formula-priced) lines — a 1¢ fake line on an unpriced Retatrutide dose could manufacture 20% off a real GHK-Cu line. **Fixed on this branch** (`f7a028a`): pair math extracted to pure `bundlePlan.ts`, unverified lines excluded from pairing, 9 regression tests pin the exploit. |
| Full-file coherence sweep | **CLEAN** | No conflict markers, no dangling `findPriceMismatches`/`priceMismatches` references, old external guest gate gone; `tsc`/`deno check`/143 tests green. A LOW doc-drift comment in `placeOrder.ts` was also fixed in `f7a028a`. |

---

## Delta summary & the path from B- to B+

| Landed (this branch) | Still owed (next wave) |
|---|---|
| P0-1/2/3/4/5 closed; P1-1/3/6/7/9/12/14/15 closed; P2 caps, threshold sync, a11y cluster | **P1-5 voucher RPC (migration 060)** — the single biggest remaining money bug |
| 134 money-path tests, monotonicity property | Coverage tooling + client money-mirror tests (PAR-E1) |
| Rollback runbook, 5-gate CI | Branch protection ON (operator, after first main CI run) |
| Fail-closed everywhere new code was written | Price the 3 formula-priced doses; decide HGH (operator, no code) |
| | Perf wave (SDK defer, lazy 3D, fonts) — the whole C+ domain |
| | Shared cart totals (P1-11), `computeOrderPricing` extraction (SER-E2) |

Do the left column's deploy, then the right column top-to-bottom, and the
blueprint's Wave-6 **B+** is real. As of tonight: **B-**, every grade above
backed by the cited lines.

---

*Produced by the overnight integration run. The only production interaction
was read-only during the original scan; this run touched no deployed system,
no live database, and no production flag.*
