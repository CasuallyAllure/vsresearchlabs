# Pro Review — VS Research Labs, Post-Voucher-Fix (verified 2026-07-17)

Independent, adversarial principal-engineer re-grade of the system **as deployed**.
Lineage: `docs/SYSTEM_SCAN_2026-07-16.md` (D) → `docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md`
(B-) → `docs/PRO_REVIEW_2026-07-16-post-deploy.md` (B, the baseline for this review).

Verified head: `b1f1092` (commits `488e12c` + `b1f1092`, tag `deploy/edge/2026-07-17`).
Prod verified read-only: `supabase migration list` shows **064 applied** (local/remote
in sync, 60 local files, remote through 064); `supabase functions list` shows
**place-order v59 ACTIVE**. Live RPC probe re-run independently this review:
anon → `42501 permission denied for function consume_reward_voucher`, authenticated
(bot admin) → `42501`, active vouchers visible = 0. Gates re-run locally:
`vitest run` **155 passed / 21 skipped** (was 143 — the 12 new voucher tests),
`vitest run --coverage` passes at 26.73 S / 23.67 B / 27.27 F / 27.9 L, exactly the
ratchet floor in `vitest.config.ts:28`. CI green on `main` (run 29597219478, success).

---

## 1. Overall grade: **B+** (was D → B- → B)

The previous review said, verbatim: do §6 items 1–3 and the overall is an honest
B+. Two of the three landed today and both are money-domain moves:

- **Item 1 — the only live money bug is closed.** Migration 064's
  `consume_reward_voucher` is a single guarded `UPDATE … WHERE status='active'
  RETURNING` (`064_reward_voucher_consume.sql:45-51`) — under row locking exactly
  one concurrent caller flips active→used; there is no separate read to go stale.
  place-order claims **before** materializing the reward row
  (`place-order/index.ts:1318-1319`) and rolls the reward off the order on a lost
  race (`:1342-1361`), with an operator alert if the rollback update fails
  (`:1367-1374`). Traced end-to-end in §3; the race is genuinely dead.
- **Item 3 — coverage is now measurable AND enforced.** `@vitest/coverage-v8`
  installed, `npm run test:coverage` (`package.json:15`), ratchet thresholds in
  `vitest.config.ts:28`, and CI runs the coverage variant as a hard gate
  (`.github/workflows/ci.yml:64`). The 80% bar is finally *assertable* — CI fails
  on any regression below the measured floor.
- Bonus from item 4: the rate-limit bucket is now case-folded —
  `.ilike("contact", contactBucket)` with LIKE metacharacters escaped
  (`index.ts:670-673`), so re-casing a contact no longer opens a fresh throttle
  bucket.

Item 2 (`isVariantPublic` default-visible flip) did **not** land — but the prior
review itself quantified that as UX-only and currently unreachable (live blast
radius: one SKU, fully hidden, checkout 409s regardless). It does not gate B+.

Why not A-: the `lookup_order` anon enumeration surface is still unthrottled
(migration 062/065 unwritten — `ls supabase/migrations` confirms 059→061→063→064,
no 062); the coverage floor is an honest 27% with the client money-mirrors at ~0%
(`src/lib/wholesale.ts` 14%, `pricing.ts` 0% per the coverage run);
`place-order/index.ts` has grown to **1,699 lines** (`wc -l`); the perf packet
(eager Supabase SDK, render-blocking Google-CDN Inter) is untouched; deploys are
still manual; and this review found one MEDIUM gap in the new code's failure
handling (§4 #1). B+ is earned — the last *live* money bug is closed and every
gate that says so is enforced in CI — but the A-track items below are real work,
not polish.

## 2. Scorecard

| # | Domain | Scan (D-era) | Integration (B-) | Prev (B) | NOW | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | F | B- | B | **B+** | +0.5 | Voucher TOCTOU closed atomically (064 + claim-first + rollback, §3); zero known live money bugs. order_coupons-insert-after-claim gap (§4 #1) keeps it off A-. |
| 2 | Security & authz | D | B+ | B+ | **B+** | 0 | Voucher RPC revoked from anon/auth (probed live: 42501×2); rate bucket case-folded (`index.ts:673`). `lookup_order` throttle still unwritten — the enumeration surface holds the grade. |
| 3 | Data integrity | B- | B+ | B+ | **B+** | 0 | Rollback path keeps orders/coupons/email consistent when it persists; §4 #1/#2 label-vs-discount drift edges are new but narrow. Legacy formula fallback unchanged. |
| 4 | Testing | D+ | C+ | C+ | **B-** | +0.5 | 155 tests, coverage measurable + CI-enforced ratchet — but the floor is 27% and `src/lib` money-mirrors are ~0%. Enforceable ≠ sufficient yet. |
| 5 | CI/CD & release hygiene | D | B- | B | **B+** | +0.5 | Coverage now a 6th hard gate (`ci.yml:64`); CI green on main; branch protection on. Deploys still manual/unscripted keeps it off A-. |
| 6 | Dependencies | B | B | B | **B** | 0 | +`@vitest/coverage-v8` (dev, pinned). Deploy tools still unpinned via npx. |
| 7 | Performance | C+ | C+ | C+ | **C+** | 0 | Untouched today: `src/main.tsx:31,34` module-scope `.load()` still eager-pulls the SDK; `src/index.css:10` still render-blocking Google-CDN Inter. |
| 8 | Accessibility | C+ | B | B | **B** | 0 | Untouched. Duplicate `<main>` still live: `src/layout/AnimatedPortalShell.tsx:33` + `src/pages/ProductPage.tsx:476`. |
| 9 | Frontend quality | C+ | B- | B- | **B-** | 0 | No frontend deploy today (wrangler 52cc9678 unchanged). `index.ts` grew to 1,699 lines; cart totals still duplicated (`CartDrawer.tsx:176,641` / `CartPage.tsx:174,703-747`). |
| 10 | Observability | D | B- | B- | **B-** | +0.2 | New `reward_rollback` operator alert (`index.ts:1367`) extends the money-path alert net. §4 #1 shows one alert-less money branch remains; no external uptime probe. |
| 11 | `video/` workspace | B | B+ | B+ | **B+** | 0 | Untouched. |

Arithmetic: nothing below C+, seven domains at B or above, **both money domains
at B+** with zero known live money bugs → **B+** overall.

## 3. Adversarial verification of today's fix

**The migration's single-consume guarantee is real.** The whole fix is one
statement: `UPDATE reward_vouchers SET status='used' … WHERE id=$1 AND
status='active' RETURNING id` (`064_reward_voucher_consume.sql:45-51`). Under
READ COMMITTED, concurrent updates serialize on the row lock and the loser
re-evaluates the WHERE against the *committed* row — status is now `used`, zero
rows match, `v_id` is null, RPC returns `{ok:false, reason:'not_active'}`
(`:53-55`). There is no read-then-write window because there is no separate read.
Null args fail closed (`:38-40`). Grants: `revoke execute … from public, anon,
authenticated` (`:61`) — **probed live this review, both 42501**.

**The winner path.** `claimRewardVoucher` (`rewardVoucher.ts:34-51`) is
fail-closed on every axis: RPC error → not claimed (`:44`), thrown → not claimed
(`:48-49`), malformed payload → not claimed (`:47`); only a literal `ok === true`
claims (`:46`). On claim, the reward `order_coupons` row is inserted with
`percent` populated (`index.ts:1330`) so `recompute_order_totals` (052) can
re-derive the fenced remainder — the fence math survives the *success* path.

**The loser path — email itemization stays truthful.** After a lost claim,
`rewardReduction = 0; rewardVoucher = null` (`index.ts:1353-1354`) **before** the
email builds: the invoice coupon block gates on `rewardVoucher &&
rewardReduction > 0` (`:1569`), so the reward line vanishes, and the email's
amounts come from a **DB re-read** (`:1536-1544`) that happens after the rollback
update (`:1355-1361`) — the email shows the rolled-back totals, internally
consistent. If the rollback update itself fails, the operator alert fires
(`:1367-1374`) with the intended total in context. `rollbackRewardPricing`
(`rewardVoucher.ts:73-83`) is pure, clamps to ≥0, removes exactly the reward
code from the comma-joined label, and is pinned by 5 tests including the
end-to-end race shape (`tests/unit/rewardVoucher.test.ts:183-204`: one order at
9,000, one at 15,000 — never two discounted orders).

**The test suite is honest about what it proves.** The fake DB
(`rewardVoucher.test.ts:32-52`) reproduces the guarded-UPDATE semantics (atomic
check-and-flip inside the async call, `await Promise.resolve()` before it so
callers genuinely interleave) and asserts both attempts *reached* the DB
(`:76` `consumeCalls === 2` — refused, not skipped). The 25-way race (`:80-88`)
pins exactly-one-winner. The atomicity itself is the DB's; the suite tests the
fail-closed *interpretation*, which is the correct division — and the header
comment says so explicitly (`rewardVoucher.ts:7-13`).

**Residual gaps found (none reopen the double-spend):** see §4. The worst is a
console-only failure branch on the winner path, not a race.

**Rate-limit fold verified.** `contact.replace(/([\\%_])/g, "\\$1")` escapes
backslash, `%`, `_` before `.ilike` (`index.ts:670-673`) — case-folded equality,
no LIKE-injection widening of the bucket.

## 4. New findings this review (severity-ranked)

**#1 — MEDIUM: winner-path `order_coupons` insert failure is console-only —
a consumed voucher whose discount can later silently evaporate.**
`index.ts:1336`: `if (rewardRowErr) console.error(...)` — no `alertOperator`,
no `order_events` note, no compensating action. Failure scenario: claim succeeds
(voucher now `used`), the reward `order_coupons` insert fails (transient DB
error). The order keeps its discount in `orders.discount_cents` (truthful today),
but `recompute_order_totals` reads **only** `order_coupons` — the next admin line
edit (`save_order_lines`) silently re-prices the order **without** the reward,
raising the total after the buyer was invoiced, and the 40% fence disappears
with it. Every comparable money-path failure in this file alerts
(`:1367`, `:1479`, `:1266`); this one should too. ~30m fix.

**#2 — LOW: coupon-redemption rollback drops the synthetic promo labels from
`coupon_code`.** `index.ts:1467-1471`: when a *code* coupon loses its redemption
race, `survivorCodes` is rebuilt from `accountDiscount` + surviving codes only —
`REWARD` / `B2G1` (which can legitimately coexist with codes; wholesale/bundle
cannot, `:923,:944`) vanish from the label while their cents stay in
`discount_cents` and their `order_coupons` rows exist. Failure scenario: reward
claimed + capped code raced out → `orders.coupon_code` says nothing about the
reward, admin sees a discount larger than the labeled codes explain. Label-only
(itemized surfaces read `order_coupons`), but it is exactly the drift the
comma-joined label at `:1139-1148` was built to prevent. ~20m fix.

**#3 — LOW: crash window between order persist and claim.** The order row is
inserted with the reward discount already baked in (`index.ts:1206`) at `:1193`;
the claim happens at `:1319`. A function crash/timeout in that window persists an
under-billed order while the voucher stays `active` — usable again on the next
order, with no alert (nothing ran). Narrow (sub-second, requires a crash exactly
there), strictly better than the old code (which had the same window *plus* the
race), and the invoice email never sends on a crash — but it is the remaining
non-atomicity in the flow. A follow-the-alert reconciliation query (orders with
`REWARD` in coupon_code but no `used` voucher pointing at them) closes it
operationally. ~1h.

**#4 — INFO: post-rollback percent math keeps the reward fence.** Percent
contributions were computed against `percentBase = baseAfterFlat −
rewardRemainder` (`index.ts:1106`); after the reward rolls off, they are not
re-scaled to the now-unfenced base. The losing buyer gets slightly *less*
percent-code discount than a voucher-less checkout would grant. Direction favors
the business, invoice stays internally consistent (sums match what's shown), and
re-deriving pass-2 mid-rollback would add real complexity for cents — acceptable,
but it should be a documented decision, not an accident.

**#5 — INFO: the winner path has never executed in production.** Migration 064
revokes execute from public/anon/authenticated with **no explicit service_role
grant** (`:61`). This works because Supabase's default privileges grant execute
to `service_role` on creation — proven by the identical pattern on
`redeem_coupon` (`031_coupons_affiliates.sql:294`), which place-order calls with
the same service-role client live today. But with **zero active vouchers in
prod** (probed), the first real claim is the first production execution. The
fail direction if anything is wrong is closed (claim fails → reward rolls off →
buyer billed at full price, alert-less per #1) — watch the first voucher order.

## 5. Path to A (ordered, concrete)

1. **Alert + reconcile on the winner-path insert failure** (§4 #1) and fold the
   synthetic codes into the rollback label rebuild (§4 #2).
   `index.ts:1336, 1467-1471`. ~1h. (Pricing → A-.)
2. **Migration 065 — `lookup_order` anon throttle** (carried from B review §6.4;
   062 was never written, 064 took the next slot). The order-number space is
   enumerable; the RPC is granted to anon (`012:223`). ~1–2h. (Security → A-.)
3. **Flip `isVariantPublic` untracked default to hide** (`productOverrides.ts:290`
   `if (!v) return true`) + a JSON-dose-vs-DB CI check. Carried unchanged from
   B review §6.2 — still the durable fix for the dead-end-chip class. ~1h.
4. **Raise the coverage ratchet by testing the client money-mirrors** —
   `src/lib/wholesale.ts` (14%), `pricing.ts` (0%), `coupons.ts` branch gaps —
   then bump `vitest.config.ts:28` floors. The ratchet only has teeth if it
   climbs. ~4–6h. (Testing → B+.)
5. **Perf packet** (carried from §6.5): defer the module-scope `.load()` calls
   (`src/main.tsx:31,34`); self-host Inter (`src/index.css:10`). ~2–3h. (Perf → B.)
6. **Extract `cartTotals.ts`** shared by `CartDrawer.tsx:176,641` /
   `CartPage.tsx:174,703-747` (P1-11, carried); render `—` for legacy NULL-priced
   invoice lines. ~2h.
7. **Remove the duplicate `<main>`** (`ProductPage.tsx:476` → `<div>`;
   shell landmark is `AnimatedPortalShell.tsx:33`). ~5m. (A11y → B+.)
8. **Split `place-order/index.ts`** (1,699 lines, growing ~50/fix) along its
   already-clean seams (rate-limit, promos, coupons, emails) — the Deno-free
   module pattern (`priceCheck`/`promoPlan`/`bundlePlan`/`rewardVoucher`) is the
   template and each extraction becomes testable. ~4h. (Frontend → B.)
9. **Script the deploy** (db → functions → frontend, order-enforced) + an
   external uptime probe on place-order. ~3h. (CI/CD, Observability → B+/B.)

Items 1–3 are the A- gate: after them, both money domains and security sit at
A- with every known failure branch alerting. 4–9 are the difference between an
A- system and an A system somebody else could operate.

---
*Verification footprint: read-only throughout. Ran `git log/show/tag`, `wc`,
`grep/sed`, `vitest run` and `vitest run --coverage`, `gh run list`,
`supabase migration list`, `supabase functions list`; one temp `.mjs` probe
(anon + bot-admin RPC call expecting 42501, `SELECT count` on active vouchers,
signed out, file deleted). No order placed, no deploy, no DB write, no tracked
file modified except this report.*
