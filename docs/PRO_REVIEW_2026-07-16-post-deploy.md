# Pro Review — VS Research Labs, Post-Deploy (verified 2026-07-17)

Independent, adversarial principal-engineer re-grade of the system **as deployed**.
Baselines: `docs/SYSTEM_SCAN_2026-07-16.md` (D), `docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md` (B-).

Verified head: `aeb962c` (via `git log --oneline -10`). DB read live & read-only
(bot admin session). Gates re-run: `tsc -b` clean, `vitest` 143 passed / 21 skipped,
`eslint` 0 errors / 43 warnings, no `@vitest/coverage-v8`.

---

## 1. Overall grade: **B** (was D → B-)

The overnight integration graded the *branch as-if-deployed* at B-. It is now
actually deployed **and** today's data changes closed the single biggest pricing
gap the B- was carrying (three live formula-priced doses now have server
authority). Two independent structural wins landed on top: `ci.yml` reached
`main` and branch protection is enabled; the hero 3D is now code-split. That is
enough to move the honest overall from **B- to B**.

Why not B+: one **live money double-spend** remains (reward-voucher TOCTOU,
`place-order/index.ts:1324-1327`, migration 060 never written); test **coverage
is still unmeasurable** (no coverage tooling, so CLAUDE.md's 80% bar cannot be
asserted); and the abuse-throttle + perf gaps the B- flagged are untouched. B is
earned, not rounded — every domain below is cited.

The good news the review can state quantitatively: the "systemic" per-dose price
skew is, in the live catalog, **contained to exactly one SKU (HGH), which is
fully unreachable**. The fail-closed checkout means even that is a 409, not a
mis-bill. Details in §4.

## 2. Scorecard

| # | Domain | Scan (D-era) | Integration (B-) | NOW (live) | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | F | B- | **B** | +0.5 | Today's DB pricing closed the 3 formula-doses gap; server authority fail-closed & verified. Voucher TOCTOU (live double-spend) keeps it off B+. |
| 2 | Security & authz | D | B+ | **B+** | 0 | IDOR gated, price check authoritative. `lookup_order` throttle (migration 062) + case-sensitive rate bucket + voucher race still open. |
| 3 | Data integrity | B- | B+ | **B+** | 0 | 061 blocks NULL inquiry lines; live HGH data now clean (hidden both levels). Invoice formula fallback survives for legacy rows only. |
| 4 | Testing | D+ | C+ | **C+** | 0 | 143 money-path tests, but coverage tooling still absent → 80% bar unmeasurable; client money-mirrors untested. |
| 5 | CI/CD & release hygiene | D | B- | **B** | +0.5 | `ci.yml` now on `main` (264fdf5), 5 hard gates live, branch protection ENABLED. Deploys still manual/unscripted. |
| 6 | Dependencies | B | B | **B** | 0 | Untouched. Deploy tools (`wrangler`/`supabase`) still unpinned via npx. |
| 7 | Performance | C+ | C+ | **C+** | +0.2 | Hero 3D now `lazy()` code-split (real win). Supabase SDK still eager module-scope; Inter still on Google CDN render-blocking. |
| 8 | Accessibility | C+ | B | **B** | 0 | Focus traps + AA targets held. Duplicate `<main>` landmark on product pages still open. |
| 9 | Frontend quality | C+ | B- | **B-** | 0 | aeb962c closed the deep-link hole cleanly. `place-order/index.ts` still 1,651 lines; cart totals still duplicated (P1-11). |
| 10 | Observability | D | B- | **B-** | 0 | Client+edge telemetry, operator alerts on money-path failures, now actually deployed. No external uptime probe. |
| 11 | `video/` workspace | B | B+ | **B+** | 0 | Untracked from repo; zero build impact structural. Remotion license note still worth an ops paragraph. |

Arithmetic: nothing below C+, five domains at B or above, both money domains at
B/B+ → **B** overall.

## 3. Per-domain evidence

**1. Pricing.** Authority is fail-closed and verified end-to-end (§5).
`priceCheck.ts:262-308` `verifyLinePrices` returns `ok:false` on any mismatch;
`index.ts` 409s before any DB write. `resolveLinePrice` (`priceCheck.ts:181-210`)
refuses `unresolved`/`unknown`/`zero`, allows only matched-but-null rows as
`unverified` (flagged on the order timeline). Today's live prices verified in the
DB: `VSR-RS-TB4-005 5mg=6000`, `VSR-RS-KISS 5mg=5500`, `VSR-RS-TA1 5mg=7500`, all
`hidden=false`. **Open:** voucher TOCTOU (§4 #1).

**2. Security.** Notifier IDOR gated (integration-confirmed). Price check is now a
security control. **Open, verified absent:** migrations 060 (voucher RPC) and 062
(`lookup_order` throttle) do not exist (`ls supabase/migrations` → 059, 061, 063
only); rate-limit bucket still `.eq("contact", contact)` case-sensitive
(`index.ts:669`).

**3. Data integrity.** 061 raises on NULL inquiry lines. Live DB confirms HGH is
clean: variant rows `24IU`/`36IU` both `price=null hidden=true`, and
`product_stock` row `hidden=true`. **Open:** invoice formula fallback at
`InvoiceDocument.tsx:37`, `TrackOrder.tsx:50`, `OrderView.tsx:144` (all
`tierPriceCents(...)` for legacy NULL rows) — reachable for legacy rows only.

**4. Testing.** `vitest` 143 passed / 21 skipped. `grep coverage package.json` →
nothing; **`@vitest/coverage-v8` absent**, so the 80% bar is unmeasurable. Client
mirrors (`wholesale.ts`, `shippingCentsFor`) still untested.

**5. CI/CD.** `git ls-files .github/workflows/ci.yml` → tracked on `main`. Branch
protection enabled (operator-confirmed; required check `checks`, strict,
`enforce_admins=false` so the solo admin can still push). **Open:** deploys
manual, migrate→functions→frontend ordering documented not scripted.

**7. Performance.** `HeroHoloCarousel` now `lazy(() => import('./HeroHoloCarousel'))`
(`CompoundVisualizerFrame.tsx:21-22`) — the ~955 kB 3D chunk is off the critical
path. **Still open:** `src/main.tsx:31,34` module-scope `.load()` pulls the
Supabase SDK eagerly; `src/index.css:10` `@import url('https://fonts.googleapis.com/...Inter...')`
render-blocking third-party.

**8. Accessibility.** Focus traps intact. **Open:** two `<main>` landmarks on a
product page — `AnimatedPortalShell.tsx:33` (`id="main-content"`) wraps the route,
and `ProductPage.tsx:476` nests a second `<main>`.

**9. Frontend.** aeb962c is correct (§5). `place-order/index.ts` = 1,651 lines.
Cart totals duplicated: `CartDrawer.tsx:641-652` and `CartPage.tsx:88,709-713`
each recompute subtotal + bundle independently (P1-11), no shared `cartTotals.ts`.

## 4. New findings this review (severity-ranked)

**#1 — HIGH (live money bug): reward-voucher double-spend (P1-5, still open).**
`place-order/index.ts:1324-1327`:
```
const { error: voucherErr } = await supabase.from("reward_vouchers")
  .update({ status: "used", ... }).eq("id", rewardVoucher.id).eq("status", "active");
if (voucherErr) console.error(...);
```
The voucher is *read* active at :769 and *consumed* here with a filtered update.
The result is only checked for a DB **error** — never for **0 rows matched**.
Failure scenario: a stamped owner opens two checkout tabs, both read the one
active voucher, both compute a 40%-of-top-line reduction, both submit. The second
UPDATE flips 0 rows (already `used`) but that order **still received the discount**
because nothing gates the reduction on a successful consume. One 40%-off voucher,
spent twice. Fix is the reserved migration 060 (atomic `UPDATE ... RETURNING`, and
refuse/reverse the reward line when it returns nothing).

**#2 — LOW→INFO (architectural fragility, currently NOT exploitable): per-dose
price-skew via `isVariantPublic` default-visible.** `productOverrides.ts:290`
returns `true` for any (sku,dose) with **no** `product_variant_stock` row
("not yet tracked — don't hide"). A JSON-declared dose with no DB row therefore
renders as an addable chip at the formula price (`pricing.ts` `tierPriceCents`).
**Quantified against the live DB** (138 variant rows vs 71 catalog entries'
`variants`): exactly **one SKU** has dose skew — `VSR-RS-HGH`, whose JSON declares
`10/12/15/24/36mg` while the DB carries only `24IU`/`36IU`. **Zero** JSON doses on
any *other* SKU are missing a DB row, and **zero** substring-resolve to a
different-priced dose. So the systemic risk has a live blast radius of one SKU —
**and that SKU is fully hidden**: `product_stock.hidden=true` filters it from the
catalog grid (`BiopeptideResearchSupplies.tsx:109,116` gate on `isSkuVisible`) and
aeb962c gates the deep link. Even if it were reachable, checkout would 409
(`dose_unresolved`), not mis-bill. **Severity is UX-only and currently
unreachable**, but the *architecture* stays fragile: aeb962c only guards
**fully-hidden** SKUs. The moment anyone edits a JSON dose string on a **visible**
SKU so it no longer matches its DB row (or seeds a new SKU with mismatched dose
strings), that dose becomes an addable chip that dead-ends at a 409 — with no
grid/deep-link guard, because the SKU is visible. The durable fix is to flip
`isVariantPublic`'s untracked default to **hide** (return `false` when `!v`) so
catalog visibility is driven only by real DB rows.

**#3 — INFO: B2G1 live-flag risk.** `promo_settings.b2g1_enabled=true`. B2G1 is
server-enforced and re-arbitrated inside `buildPromoPlans` (`promoPlan.ts`), the
exact path the monotonicity property test pins, and exclusivity ordering suppresses
stacking with wholesale/bundle. Residual risk is **business, not bug**: every 3rd
unit per line is free, which on high-value SKUs (e.g. `VSR-RS-RTT-005 30mg=12000`)
is a real $120 giveaway per triple — intended, but worth the operator confirming
it is priced in.

## 5. Verification of today's changes

**Newly-priced 5mg doses — a wrong price now 409s, the right price passes.**
Traced `priceCheck.ts`: for `VSR-RS-TB4-005 5mg`, the line name squashes to
`…—5mg`; `resolveVariantRow` longest-matches the `5mg` row (the `10mg`/`2mg` rows
don't substring-match, and `2mg` is hidden anyway). Matched + priced → `resolveLinePrice`
returns `{priced, cents:6000}`. `verifyLinePrices` (:293) does
`line.unitPriceCents !== 6000 → price_mismatch`. So **any** client price ≠ 6000 →
`ok:false` → 409; **only 6000 passes**. Same for `KISS 5mg`→5500 and `TA1 5mg`→7500
(both confirmed `price_cents` in the live DB, `hidden=false`). The pre-deploy
"unverified, allowed-through-flagged" state for these three is **gone** — they are
now hard-verified.

**HGH unreachable — confirmed at both surfaces.** Live DB: `product_stock` HGH
`hidden=true`; both variant rows `hidden=true, price=null`. Grid: filtered by
`isSkuVisible` (false when `hidden`). Deep link `/product/:id`: aeb962c
(`ProductPage.tsx:102,174`) computes `skuHidden = !isSkuVisible(product.sku)` and
returns `ErrorState`. `isSkuVisible` (`productOverrides.ts:204-208`) is false only
on `hidden || deleted_at` — it does **not** over-hide (defaults true when no row),
so the gate is correct and minimal.

**B2G1-on given the live catalog:** safe on the money path (server-enforced,
monotonic-tested); see §4 #3 for the business note.

## 6. Path to a higher grade (ordered, concrete)

1. **Write migration 060 — atomic voucher consume RPC.** `UPDATE reward_vouchers
   SET status='used' … WHERE id=$1 AND status='active' RETURNING id`; refuse the
   reward reduction when it returns no row. Closes the only live money bug.
   `place-order/index.ts:1324` + new migration. ~1–2h. (Pricing/Security → B+.)
2. **Flip `isVariantPublic` untracked default to hide** (`productOverrides.ts:290`
   return `false` when `!v`), and add a JSON-dose-vs-DB CI check. Kills the
   per-dose dead-end class permanently on visible SKUs. ~1h + test. (Frontend/UX.)
3. **Add `@vitest/coverage-v8` + a coverage script/threshold.** Makes the 80% bar
   assertable; wire it as a CI gate. `package.json` + `ci.yml`. ~1h. (Testing → B.)
4. **Migration 062 — `lookup_order` anon throttle** + fold the rate-limit bucket
   to case-insensitive contact (`index.ts:669`). ~1–2h. (Abuse → B+.)
5. **Perf packet:** defer the Supabase SDK out of module scope in `src/main.tsx`;
   self-host Inter with a metric-matched fallback (`src/index.css:10`). ~2–3h.
   (Perf C+ → B.)
6. **Extract `cartTotals.ts`** shared by drawer + page (P1-11); render `—` for
   NULL-priced invoice lines instead of the formula fallback. ~2h. (Frontend/Data.)
7. **Remove the duplicate `<main>`** (make `ProductPage.tsx:476` a `<div>`). ~5m.
   (A11y.)

Do 1–3 and the overall is an honest **B+**; add 4–5 and Wave-6's target is real.

---
*Verification touched the live DB read-only (bot admin session, no writes) and
ran local gates only. No order placed, no deploy, no tracked file modified except
this report.*
