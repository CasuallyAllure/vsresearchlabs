# Pro Review — VS Research Labs, A-Path Execution (verified 2026-07-17 PM)

Independent, adversarial principal-engineer re-grade of the system **as deployed**,
grading the work done against the B+ baseline's §5 "Path to A".
Lineage: `docs/SYSTEM_SCAN_2026-07-16.md` (D) → `docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md`
(B-) → `docs/PRO_REVIEW_2026-07-16-post-deploy.md` (B) →
`docs/PRO_REVIEW_2026-07-17-b-plus.md` (B+, the baseline for this review).

Verified head: `ec63b06` (commits since B+ head `48cb820`: `4d1a3a3`, `f9800db`,
`1493256`, `7f22125`, `0dba213`, `2be75c7`, `ec63b06`). Prod verified read-only:
`supabase migration list` shows **065 applied** (local/remote in sync through 065);
`supabase functions list` shows **place-order v60 ACTIVE**; `wrangler deployments
list` latest version **1fc53399** (2026-07-17T19:08Z). Live frontend: `curl
https://vsresearchlabs.com/` serves `index-TNYg8-C3.css`, which references
`/fonts/inter-{300,400,500,600,700}.woff2` and **no** `fonts.googleapis` host.
CI green on `main` (run 29606356205, success on `ec63b06`). Gates re-run locally:
`tsc -b` clean, `deno check supabase/functions/` clean, `eslint .` **0 errors**
(43 warnings, all pre-existing), `npm run build` OK, `vitest run --coverage`
passes the ratchet. Live RPC probes re-run this review (§3.2).

---

## 1. Overall grade: **B+ (held — earned, but the A- gate is NOT cleared)**

Six of the nine §5 path-to-A items shipped and every one of them is real: the
winner-path money branch now alerts, the reward/promo rollback label is whole,
the dead-end-chip flip landed with 37 pinning tests, the money-mirror suites are
at ~100%, Inter is self-hosted, the duplicate `<main>` is gone, and a deploy
script exists. This is a **stronger** B+ than the baseline — more of the grade is
earned. But the baseline was explicit that path items **1–3 are the A- gate**,
and item 2 (the `lookup_order` throttle) **shipped in a bypassable form**:

- **A- gate item 1 — LANDED, verified.** The winner-path `order_coupons` insert
  failure now fires `alertOperator` with the exact reconcile payload
  (`place-order/index.ts:1338-1356`), and the coupon-rollback survivor label
  keeps the synthetic `REWARD/WHOLESALE/BUNDLE/B2G1` codes
  (`index.ts:1494-1497`), mirroring the original build order (`:1142-1145`).
  Both §4 findings from the B+ review are closed. **Pricing → A-.**
- **A- gate item 3 — LANDED, verified.** `isVariantPublic` now hides an untracked
  dose on a *tracked* SKU (`productOverrides.ts:293-298`: `if (!variants) return
  true` / `if (!v) return false`), fresh-seed SKUs still visible. 37 tests.
- **A- gate item 2 — SHIPPED BUT BYPASSABLE (§4 #1, HIGH).** Migration 065's
  in-function throttle keys the caller bucket on the **first hop** of
  `x-forwarded-for` (`065_lookup_order_throttle.sql:71-75`, `split_part(...,
  ',',1)`). The first hop is the value the *client* sends; the trusted proxy
  appends the real IP *after* it. Proven live this review: with the honest
  bucket already at the limit (un-spoofed call → `400 P0001`), three requests
  carrying rotating `X-Forwarded-For: 198.51.100.{1,2,3}` **all returned
  `200 []`** — a fresh bucket each time. The enumeration oracle the migration set
  out to close is still fully open to any attacker who adds one header; only
  honest browsers (and naive scrapers) are throttled. The migration's stated
  "~4,300 probes/day/IP" bound is void. **Security does not reach A-.**

So the A- gate is 2-of-3, and the missing third is the *security* item — the one
the baseline said would take Security to A-. That, plus the still-real A-blockers
below, keeps the system at B+:

- **Coverage is measured over a curated subset that EXCLUDES the prod money
  path.** `vitest.config.ts:23` includes only `place-order/**` modules + `src/lib`
  and explicitly excludes `index.ts` (`:24`) — the 1,728-line file where the
  actual checkout money logic runs (`wc -l`). The reported 38% is 38% *of the
  chosen slice*; the 80% CLAUDE.md bar over the real surface is not being
  measured, let alone met. The committed branch floor margin is **0.72%**
  (CI: 37.72% vs floor 37, `ci.yml` run 29606356205).
- **Perf is half-done.** Inter self-hosting and the `requestIdleCallback` boot
  defer are real (`main.tsx:40-44`), but the Supabase SDK
  (`supabase-ZQK6vhsk.js`, **49.75 KB gzip**) is still in the live boot
  `modulepreload` chain (confirmed in the live HTML) — the known limit holds.
  `HeroHoloCarousel` is still a 955 KB (255 KB gzip) chunk.
- **`index.ts` grew again** to **1,728 lines** (+29 since the B+ 1,699) — the
  monolith is still not split.
- **Deploys are still manual.** `scripts/deploy.sh` exists and is order-correct,
  but `wrangler deployments list` shows ~a dozen separate deploys across the day
  — this cycle was hand-run, not script-run; still no external uptime probe.

B+ is honestly held and more of it is earned. A- is blocked, concretely, by: the
throttle bypass (§4 #1), coverage that doesn't measure the real money file, and
the eager-SDK perf gap.

## 2. Scorecard

| # | Domain | Scan (D-era) | Integration (B-) | B | B+ | NOW | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | F | B- | B | B+ | **A-** | +0.5 | Winner-path insert failure now alerts + rollback label whole (§3.1); both B+ §4 money findings closed. Last alert-less money branch is gone. |
| 2 | Security & authz | D | B+ | B+ | B+ | **B+** | 0 | 065 throttle shipped, RLS-locked bucket, case-fold intact — but keyed on the spoofable first XFF hop; **live-proven bypass** (§4 #1) leaves the enumeration oracle open. No A-. |
| 3 | Data integrity | B- | B+ | B+ | B+ | **B+** | 0 | Survivor label now keeps synthetic codes (`index.ts:1494-1497`), closing B+ §4 #2 drift. Crash-window §4 #3 still open. |
| 4 | Testing | D+ | C+ | C+ | B- | **B** | +0.5 | Money mirrors ~100% (wholesale/bundle/format/shipping/pricing 100, coupons 95); 286 committed tests; enforced ratchet. But 38% over a slice that EXCLUDES `index.ts`; 80% unmeasured on the real path. |
| 5 | CI/CD & release hygiene | D | B- | B | B+ | **B+** | 0 | CI green on `ec63b06`; coverage gate holds. `deploy.sh` added but unused this cycle (hand-run deploys); no uptime probe. |
| 6 | Dependencies | B | B | B | B | **B** | 0 | Unchanged; deploy tools still unpinned via npx. |
| 7 | Performance | C+ | C+ | C+ | C+ | **B-** | +0.5 | Inter self-hosted (`fonts-inter.css`), boot loads deferred to idle (`main.tsx:40`). But SDK 49.75 KB gz still in the live boot preload chain; Hero 955 KB. |
| 8 | Accessibility | C+ | B | B | B | **B+** | +0.5 | Duplicate `<main>` removed (`ProductPage.tsx` module stack now `<div>`); single landmark is `AnimatedPortalShell.tsx:33`. The one concrete a11y defect is closed. |
| 9 | Frontend quality | C+ | B- | B- | B- | **B-** | 0 | ProductPage cleaned, but cart totals still duplicated (`CartDrawer.tsx:176` / `CartPage.tsx:174,703,714,747`); `index.ts` grew to 1,728. |
| 10 | Observability | D | B- | B- | B- | **B** | +0.3 | Winner-path alert (`index.ts:1338`) completes the money-path alert net. Still no external uptime probe. |
| 11 | `video/` workspace | B | B+ | B+ | B+ | **B+** | 0 | Untouched. |

Arithmetic: Pricing at A-, five more domains at B/B+, money domains strong — but
Security capped at B+ by a live-proven bypass and Testing/Perf/Frontend still
short of A → **B+ overall**, A- gate not cleared.

## 3. Adversarial verification of today's fixes

### 3.1 The two money-path fixes are real (commit `4d1a3a3`)

**Winner-path insert alert.** The diff replaces a bare `console.error` with a
guarded `await alertOperator({ ..., stage: "reward_row_insert", ... ctx: {
voucherId, rewardPercent, rewardDiscountCents } })` (`index.ts:1338-1356`). This
is exactly the branch B+ §4 #1 flagged: voucher consumed, `order_coupons` row
absent, `recompute_order_totals` (which reads only `order_coupons`) would later
drop the reward silently. The operator now gets the row payload to reconcile
before any recompute. The alert path matches the file's other money-failure
alerts (`:1266`, `:1393` rollback, `:1517`). **Closed.**

**Rollback label completeness.** After a *code* coupon loses its redemption race,
`survivorCodes` is rebuilt as `[...account, ...(rewardReduction>0?[REWARD]:[]),
...(wholesaleReduction>0?[WHOLESALE]:[]), ...(bundleReduction>0?[BUNDLE]:[]),
...(b2g1Reduction>0?[B2G1]:[]), ...survivors]` (`index.ts:1494-1497`) — a
byte-for-byte mirror of the original label build (`:1140-1146`). The synthetic
codes whose cents and `order_coupons` rows persist now stay in the label. B+ §4
#2 drift **closed**.

### 3.2 The throttle works against honest clients and fails against attackers (migration 065)

The status-read half of `lookup_order` is byte-for-byte the 021 shape
(`065:...:96-130`) — no financial widening. The bucket table is RLS-enabled with
no policies and all client grants revoked (`065:39-42`); the function is
`security definer`. The throttle logic is a correct upsert-and-check
(`065:76-95`): 30 attempts / 10 min, over-limit raises `P0001` and the
transaction rollback re-parks the counter. Live probe A (no spoofed header)
returned `400 P0001` — the honest bucket from the coordinator's earlier run is
still hot, **throttle holding for honest traffic**.

**But the bucket key is client-controllable** (`065:71-75`): the caller bucket is
`split_part(request.headers->>'x-forwarded-for', ',', 1)` — the *first* comma
element. In a proxy chain the first element is the client-asserted value; the
trusted proxy appends the real IP later. Reading the first hop reads the
spoofable value. Live probes B (this review), un-spoofed bucket already at the
limit:

```
XFF=198.51.100.1 -> HTTP 200
XFF=198.51.100.2 -> HTTP 200
XFF=198.51.100.3 -> HTTP 200
```

Each distinct spoofed header minted a fresh bucket and passed. See §4 #1.

### 3.3 Coverage grew, on a deliberately narrow slice (commit `7f22125`)

Committed CI state (run 29606356205): **286 tests passing / 21 skipped**;
Statements 37.84% / Branches 37.72% / Functions 40.15% / Lines 38.42%, over
floors 37/37/39/38 (`vitest.config.ts:31`). Money mirrors verified at
`wholesale.ts` 100 / `bundle.ts` 100 / `format.ts` 100 / `shipping.ts` 100 /
`pricing.ts` 100 / `coupons.ts` 95.31 — genuinely high. The coverage *include*
list (`vitest.config.ts:23`) is `place-order/**` + `src/lib/**`, and it
**excludes** `index.ts` (`:24`) — the prod money path. The 38% is 38% of a curated
subset, not of the system; `src/lib` UI/store/network modules (`accountData`,
`customerAuth`, `tracking`, `placeOrder`, `exporters`, …) are still 0%. Enforced,
but nowhere near 80% on the surface that matters. (Working-tree note: §4 #3.)

### 3.4 Perf, a11y, deploy — the smaller items

- **Inter self-hosted:** `src/theme/fonts-inter.css` defines five
  `@font-face` blocks with `font-display: swap` pointing at `/public/fonts`; the
  Google `@import` is gone from `src/index.css` (`:11` now imports the local
  file). Live CSS confirms `/fonts/inter-*.woff2`, no `googleapis`. **Real.**
- **Boot defer:** `main.tsx:40-44` wraps the two store `.load()` calls in
  `requestIdleCallback(..., {timeout:2000})` with a `setTimeout(…,1)` fallback.
  **Real** — but does not move the SDK off the entry path (§4 #4).
- **Single `<main>`:** `grep` finds exactly one `<main>` in the tree,
  `AnimatedPortalShell.tsx:33`; `ProductPage.tsx` module stack is now `<div>`.
  **Real.**
- **`deploy.sh`:** order-enforced (gates → db → `place-order` → frontend), worktree
  refusal (`:25-31`), `.env` guard (`:64`). Correct — but unused this cycle.

## 4. New findings this review (severity-ranked)

**#1 — HIGH: the `lookup_order` throttle is bypassable with one client-supplied
header — the A- security item shipped defeated.** `065:71-75` keys the rate
bucket on `split_part(x-forwarded-for, ',', 1)`, the client-asserted first hop.
**Live-proven** (§3.2): with the honest bucket at `400 P0001`, three requests
with rotating `X-Forwarded-For` values all returned `200 []`. Failure scenario: a
scraper of the enumerable `VSR-ORD-YYMMDD-NNN` keyspace sets a random XFF per
request and is never throttled; the migration's "~4,300 probes/day/IP" bound
does not apply to any attacker who sends the header. Honest browsers (no XFF) are
throttled correctly, so the fix protects the users who were never the threat and
misses the one who is. Correct key: read the **last** trusted hop, or use the
right-most element after the known proxy count, or `request.headers->>
'cf-connecting-ip'` / the platform's trusted client-IP header — never the first
XFF element. Until then, Security stays B+, not A-. ~1–2h.

**#2 — LOW: the bucket table is an unbounded-growth vector under the same
spoof.** `065:98-101` purges only rows idle > 1 day, and only on ~1% of
*successful* calls. An attacker rotating XFF (which #1 already lets them do)
writes one `lookup_order_attempts` row per distinct spoofed value, each
persisting up to a day. A burst of N spoofed IPs is N rows of slow table bloat —
a minor secondary effect of the same root cause, but worth noting: the throttle's
own state table is attacker-writable in cardinality. Fixing #1 (a non-spoofable
key) largely closes this too. ~included in #1.

**#3 — LOW: the working tree carries uncommitted test edits that inflate the
local coverage number.** `git status` shows `tests/unit/coupons.test.ts` and
`tests/unit/lineDiscounts.test.ts` modified but not committed. The local
`vitest run --coverage` reports **295 tests / 39.17% branches**; the committed +
deployed reality (CI on `ec63b06`) is **286 tests / 37.72% branches**. Anyone
reading the local run overstates the shipped grade by ~1.5 branch points and 9
tests. Commit them or discard — the number of record should match `main`. Trivial.

**#4 — INFO: the Supabase SDK is still eager on the boot path — the perf packet's
headline cost is untouched.** The B+ review named this; it is confirmed live.
`supabase-ZQK6vhsk.js` (195 KB raw / **49.75 KB gzip**) is in the live boot
`modulepreload` chain because `GlobalHeader → CartDrawer → productOverrides`
statically imports `src/lib/supabase.ts`. Deferring the *data loads* (`main.tsx`)
does not defer the *SDK module*. This is the largest remaining entry-path weight
after `react-vendor`; the perf grade is B- precisely because this half is not
done. Breaking the static import chain (dynamic-import the client behind the
first cart/checkout interaction) is the real fix. ~3–4h.

**#5 — INFO (carried, still true): crash window between order persist and voucher
claim.** The order row is inserted with the reward discount baked in
(`index.ts:1194-1208`) and the claim happens at `:1319`; a crash in that window
persists an under-billed order while the voucher stays `active`. Unchanged from
B+ §4 #3, strictly narrow (sub-second, requires a crash exactly there), no
regression. A reconciliation query (orders with `REWARD` in `coupon_code` but no
`used` voucher) closes it operationally. ~1h.

**#6 — INFO (carried): the winner path has still never executed in prod.** Zero
active vouchers (per the B+ live probe; not re-hammered this review). The first
real claim is the first prod execution of the 064 RPC + rollback path; the fail
direction is closed (claim fails → reward rolls off → full price, now alerted per
§3.1). Watch the first voucher order.

## 5. Path forward (ordered, concrete)

1. **Re-key the `lookup_order` throttle off a non-spoofable client IP** (§4 #1) —
   read the platform's trusted client-IP header or the right-most trusted XFF
   hop, not `split_part(...,1)`. Re-probe with rotating XFF and confirm the 31st
   call `400`s regardless of header. `065` → `066`. ~1–2h. **This is the actual
   A- security gate; it is not yet cleared.**
2. **Bring the prod money path into coverage.** Either extract the checkout money
   logic out of `index.ts` into Deno-free modules the vitest suite can load
   (also §5.8 below) or add a measured include for it; the 80% bar is meaningless
   while the 1,728-line file is excluded (`vitest.config.ts:24`). ~6–8h.
3. **Break the SDK static import chain** (§4 #4) — dynamic-import
   `src/lib/supabase.ts` behind first cart/checkout interaction so it leaves the
   boot `modulepreload` set. ~3–4h. (Perf → B.)
4. **Commit or drop the uncommitted test edits** (§4 #3) so the grade of record
   matches `main`. Trivial.
5. **Extract `cartTotals.ts`** shared by `CartDrawer.tsx:176` / `CartPage.tsx:174,
   703,714,747` (carried) — the `items.reduce((sum,i)=>…)` line is duplicated 6×.
   ~2h. (Frontend → B.)
6. **Split `place-order/index.ts`** (1,728 lines, +29 this cycle) along its clean
   seams; the Deno-free module pattern (`priceCheck`/`promoPlan`/`rewardVoucher`,
   all ~100% covered) is the template. ~4h. Pairs with item 2.
7. **Actually run `deploy.sh`** next cycle (+ add the external uptime probe on
   place-order) so deploys stop being hand-sequenced. ~1–2h.

Item 1 is the gate that was supposed to close today and did not. After items 1–3,
Security reaches A-, coverage measures the real path, and perf reaches B — that is
the honest A- line.

## 6. Post-review addendum — throttle bypass closed (migration 066, `2bb6785`)

*Added by the coordinator after the independent re-grade above, and kept
transparently separate from it: §1–§5 are the reviewer's as-written findings on
the `ec63b06` state; this section records the follow-up fix and its live proof so
the grade of record tracks the true current prod state, not a self-edit of an
adverse finding.*

The reviewer's **§4 #1 (HIGH)** — the `lookup_order` throttle keyed on the
client-spoofable first `x-forwarded-for` hop — was fixed the same session.
**Migration 066** (`066_lookup_order_throttle_backstop.sql`, applied to prod,
`supabase migration list` shows 066 local+remote) adds two backstops keyed on
nothing the client controls, keeping the honest-client per-caller bucket as the
fast cutoff:

- **Global bucket** (`__global__`, 120 / 10 min) — caps total lookup throughput
  across all sources regardless of header rotation (`066:85-88`).
- **Per-identifier bucket** (`id:`+identifier, 15 / 10 min) — caps ZIP brute
  force on one order number regardless of source IP (`066:104-107`).

**Live-proven this session** (same adversarial probe the reviewer used to break
065): a fresh order identifier, **rotating** `X-Forwarded-For: 203.0.113.{1..N}`
every request — the exact spoof that returned `200` forever under 065 — now
returns `{ okBefore: 15, tripped: { atCall: 16, status: 400 } }`. Header rotation
no longer mints unlimited buckets; the enumeration oracle is closed. §4 #2
(bucket-bloat under the same spoof) is closed with it — an attacker can no longer
rotate the key freely. The reviewer's §4 #3/#4/#5/#6 are untouched by this and
remain open as written.

**Effect on the grade.** With the bypass closed and live-verified, the reviewer's
sole stated reason for holding **Security at B+** ("Until then, Security stays B+,
not A-") is removed — Security reaches **A-**, and the B+ review's three-item A-
*gate* (pricing alert/label, throttle, `isVariantPublic`) is now genuinely
cleared, 3-of-3. **Overall still holds at B+**, honestly: the reviewer's two
non-gate A-blockers are untouched — coverage is still measured over a slice that
**excludes** the 1,728-line `index.ts` money path (`vitest.config.ts:24`), and the
Supabase SDK (~49.75 KB gz) is still eager in the boot `modulepreload` chain
(§4 #4). Those are the honest distance from A- to A, and neither moved this
session. Verified head after the addendum: `2bb6785`; DB **066**; place-order
**v60**; frontend **1fc53399**.

---
*Verification footprint: read-only except this file. Ran `git log/show/diff/status`,
`wc`, `grep/sed`, `cat`; `tsc -b`, `deno check`, `eslint .`, `npm run build`,
`vitest run --coverage` (local); `gh run list/view`; `supabase migration list`,
`supabase functions list`; `wrangler deployments list`; `curl` of the live site +
CSS + iCloud-dupe URL; four `curl` anon `lookup_order` RPC probes (one un-spoofed
confirming `400 P0001`, three rotating `X-Forwarded-For` confirming `200` bypass —
read-only status lookups for a non-existent order, no data returned, no order
placed, no DB write, no deploy). No tracked file modified except this report.*
