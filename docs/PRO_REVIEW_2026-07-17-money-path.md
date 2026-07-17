# Pro Review — VS Research Labs, Money-Path Extraction (verified 2026-07-17 night)

Independent, adversarial principal-engineer re-grade of the system **as deployed**,
grading the work done against the A-path review's remaining A-blockers.
Lineage: `docs/SYSTEM_SCAN_2026-07-16.md` (D) → `docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md`
(B-) → `docs/PRO_REVIEW_2026-07-16-post-deploy.md` (B) →
`docs/PRO_REVIEW_2026-07-17-b-plus.md` (B+) → `docs/PRO_REVIEW_2026-07-17-a-path.md`
(B+ held; addendum: Security A- after migration 066 — the baseline for this review).

Verified head: `47eca66` (commits since A-path head `2bb6785`: `50caed6`, `b74fab3`,
`8d8645b`, `1d48455`, `b575d31`, `d73c402`, `47eca66`). Working tree **clean** — the
baseline's §4 #3 uncommitted-test-edits finding is closed (`e8bde5a`). Prod verified
read-only: `supabase migration list` local/remote in sync through **066**;
`supabase functions list` shows **place-order v63 ACTIVE** (updated 23:12:00Z) and
**health v1 ACTIVE** (23:12:08Z); `wrangler deployments list` latest 23:13:13Z.
Live probes: `curl https://ufaajzfuppohbxebftwp.supabase.co/functions/v1/health` →
**200 `{"ok":true,"db":true}`** in 0.63s; live `vsresearchlabs.com` boot
`modulepreload` = `rolldown-runtime` + `react-vendor` + `vanilla` only — **no
supabase chunk** (the 49.75 KB gz SDK is off the entry path, confirmed in the live
HTML, not just dist). CI green on `main` HEAD (run 29620033585). Gates re-run
locally: `tsc -b` clean, `deno check supabase/functions/` clean, `eslint .` **0
errors** (43 warnings, pre-existing), `npm run build` OK, `vitest run --coverage`
**474 passed / 21 skipped**, thresholds 45/44/46/43 pass at 45.20 L / 44.60 S /
46.63 B / 44.05 F.

---

## 1. Overall grade: **A- (earned — the baseline's A- line is cleared)**

The A-path baseline was explicit about what the honest A- line was: "After items
1–3, Security reaches A-, coverage measures the real path, and perf reaches B."
All three landed and all three verify adversarially:

- **Item 1 — throttle re-key (066): in prod, in sync.** Migration 066 is applied
  local+remote; the baseline addendum's live probe showed rotating-XFF tripping at
  call 16. Not re-hammered this review (each probe writes a throttle row), but the
  migration of record is deployed and the addendum's proof stands. **Security A-
  held.**
- **Item 2 — the prod money path is now measured and covered.** `b575d31`
  extracted the entire discount-stacking engine (`orderTotals.ts`), boundary
  validation (`orderPayload.ts`), and shipping authority (`orderShipping.ts`) out
  of `index.ts` into pure Deno-free modules — and I diffed the extraction
  **line-for-line against the removed inline code** (§3.1): it is
  behavior-preserving, including the two gates most likely to drift silently
  (`rewardPercent != null` vs the old `if (rewardVoucher)` object-truthiness, and
  `accountPercent != null` vs `if (accountDiscount)` — both equivalent for every
  reachable input, fence semantics at percent=0 preserved). The place-order module
  directory now measures **99.67 S / 96.88 B / 100 F / 100 L** (verified via
  coverage JSON — all six extracted modules at 100% statements; the text reporter
  merely elides them). The 80% bar is genuinely cleared **on the checkout money
  engine**, pinned by 106 new tests including client-mirror parity cases.
- **Item 3 — the SDK is off the boot chain, live.** The live HTML's
  `modulepreload` set contains no supabase chunk; `supabase-ZQK6vhsk.js` (49.75 KB
  gz) loads behind first cart/admin/account interaction. **Perf reaches B.**

Plus the carried §5 items: the cart subtotal is one function (`cartSubtotalCents`,
8 call sites, `d73c402`), `index.ts` is down to **1,520 lines** (from 1,728), and a
real public health endpoint is deployed and answering (§3.4).

What keeps this at A- and not A — all real, none HIGH:

- **Coverage over the whole measured surface is 45%**, not 80: `src/lib` sits at
  29% with `accountData`/`customerAuth`/`tracking`/`placeOrder`/`exporters` at 0%,
  and `index.ts` (now 1,520 lines) is still excluded. The exclusion is now far
  more defensible — the money engine left the file — but residual money arithmetic
  remains inline and untested (§4 #2).
- **The deployed frontend artifact is not reproducible from this checkout**
  (§4 #1): the live build's baked Supabase anon key is the new
  `sb_publishable_…` key, while a build from the repo's `.env` (untouched since
  Jul 6) bakes the legacy JWT key. Source is byte-identical to HEAD (proven,
  §3.5) — but a routine `deploy.sh --frontend` today would silently swap the key
  back.
- **The external uptime monitor is documented, not proven running.** The health
  endpoint is real and live; `docs/UPTIME.md` is setup instructions. An
  unregistered monitor is a documented setup, not a running probe.
- The crash-window and winner-path findings carry (§4 #6/#7), and the landing
  route still pulls a 955 KB (255 KB gz) `HeroHoloCarousel` chunk — lazy, behind
  the route, not gating first paint, but heavy.

## 2. Scorecard

| # | Domain | Scan (D-era) | Integration (B-) | B | B+ | A-path NOW | NEW NOW | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | F | B- | B | A- | A- | **A-** | 0 | Money engine extraction verified faithful line-by-line (§3.1); engine now pure + 100%-pinned. Crash window (§4 #6) and never-run winner path keep it from A. |
| 2 | Security & authz | D | B+ | B+ | B+ | A- (addendum) | **A-** | 0 | 066 in sync local+remote; no new attack surface (health endpoint exposes booleans only, §3.4). Throttle not re-hammered (probe writes rows); addendum proof stands. |
| 3 | Data integrity | B- | B+ | B+ | B+ | B+ | **B+** | 0 | One shared `buildAppliedCouponLabel` for initial + rollback labels kills the drift class for good. Crash window order-persist→voucher-claim still open (§4 #6). |
| 4 | Testing | D+ | C+ | C+ | B- | B | **B+** | +0.5 | 474 tests; ratchet 45/44/46/43 enforced; the checkout money engine measures ~100% — the baseline's "coverage excludes the money path" blocker is cleared. Whole-surface 45%, `src/lib` holes, thin floors (§4 #3) block A-. |
| 5 | CI/CD & release hygiene | D | B- | B | B+ | B+ | **B+** | 0 | CI green on HEAD; deploy.sh order-correct — but the shipped artifact can't be rebuilt from the checkout (§4 #1), two frontend deploys 45s apart, ~9 deploys hand-cadenced across the day, no deploy tags. |
| 6 | Dependencies | B | B | B | B | B | **B** | 0 | Unchanged; deploy tools still unpinned via npx (wrangler 4.86 vs 4.112 available). |
| 7 | Performance | C+ | C+ | C+ | C+ | B- | **B** | +0.5 | SDK off the boot `modulepreload` chain **verified in the live HTML**; entry ~23 KB gz + react-vendor 74 KB gz; Inter self-hosted. Hero chunk 255 KB gz still heavy (lazy, route-gated). |
| 8 | Accessibility | C+ | B | B | B | B+ | **B+** | 0 | Single `<main>` holds; `1d48455` touch-target/type-floor pass not independently audited this review — no regression found, no upgrade claimed. |
| 9 | Frontend quality | C+ | B- | B- | B- | B- | **B** | +0.5 | `cartSubtotalCents` is one source of truth across all 8 sites (verified by grep); `index.ts` 1,728→1,520; live frontend source byte-identical to HEAD (§3.5). |
| 10 | Observability | D | B- | B- | B- | B | **B+** | +0.3 | Health endpoint deployed and answering 200 `{ok,db,ts}` live; money-path alert net complete. External monitor documented (UPTIME.md) but not verifiably registered — not counted as a running probe. |
| 11 | `video/` workspace | B | B+ | B+ | B+ | B+ | **B+** | 0 | Untouched. |

Arithmetic: two domains at A-, six at B+/B, none below B, no HIGH findings open,
and all three of the baseline's named A-blockers verifiably cleared → **A-
overall**. A requires: the residual inline money math tested, whole-surface
coverage climbing toward the 80% bar, a monitor that provably pages someone, and
a deploy that is reproducible from the repo.

## 3. Adversarial verification of the new work

### 3.1 The money-engine extraction is behavior-preserving (commit `b575d31`) — checked line-by-line

This was the highest-stakes claim and it holds. I diffed the removed inline code
against `orderTotals.ts` / `orderPayload.ts` / `orderShipping.ts` clause by
clause:

- **Stacking order and caps identical.** Wholesale loop (`max(min(p.value,
  gross−flat),0)`, sequential `flatCents` accumulation), bundle gate
  (`bundleValue > 0`), B2G1 (`freeUnits × unit`), reward
  (`round(maxUnit×pct/100)` capped, fence `rewardRemainder = max(maxUnit−red,0)`),
  percent base (`max(gross−flat,0)` then `−rewardRemainder`), account slice
  first, per-code re-scale `round(fullDiscount×base/gross)` with running cap,
  `discount = min(flat+pctUsed, gross)`, `total = gross−discount+shipping` — all
  byte-equivalent to the removed code (`orderTotals.ts:77-177` vs the `b575d31`
  deletion hunks).
- **The two gate-semantics traps checked explicitly.** Old: `if (rewardVoucher)`
  (object truthiness). New: caller passes `rewardVoucher ? rewardVoucher.percent :
  null`, module gates `rewardPercent != null` (`orderTotals.ts:117`) — equivalent
  for every case including a hypothetical percent=0 voucher, whose **fence** (the
  full `maxUnit` fenced off the percent base) is preserved, not dropped. Same for
  `accountPercent != null` vs `if (accountDiscount)`. **No divergence.**
- **Percent write-back order-safe.** `appliedList.filter(kind==="percent")`
  preserves order; contributions come back positionally and are written back in
  the same filtered iteration (`index.ts:913-919`).
- **`flatCents` lifetime checked.** The old code kept mutating the outer
  `flatCents` through the flat passes; nothing after the extraction call site
  reads it (rollback re-derives `total` from `gross−discount+shipping`,
  `index.ts:1271-1272`) — the narrowing is safe.
- **`validateOrderPayload` is byte-identical** in messages, statuses, check
  ORDER, slice bounds, and clamp calls; `shippingCentsFor` is trivially the old
  ternary with the same 999.
- **One theoretical semantic delta, unreachable:** the shared label builder
  drops a falsy `accountCode` (`orderTotals.ts:204`), so an *empty-string*
  account code would now yield `null` where the old inline build produced `""`.
  Account codes are hardcoded `ACCT-BUSINESS`/`ACCT-LIFETIME` (`index.ts:583`) —
  not reachable. Noted for completeness, not a finding.
- `b74fab3` (orderFormat/orderIdentifiers/sanitizeAttestation) spot-checked:
  moved verbatim.

### 3.2 The coverage claims are real — and the text reporter hides the proof

`vitest run --coverage` locally: 474 passed / 21 skipped; totals 45.20 L / 44.60 S
/ 46.63 B / 44.05 F over floors 45/44/46/43. The text reporter lists only 3 files
under place-order — the six others (orderTotals, orderPayload, orderShipping,
bundlePlan, orderFormat, orderIdentifiers, sanitizeAttestation) are elided at
100%; the JSON summary confirms **every extracted module at 100% statements**,
dir aggregate 99.67 S / 96.88 B — matching the commit's claim exactly. `index.ts`
remains excluded (`vitest.config.ts:24`) — now defensible as mostly-orchestration,
with the residual noted in §4 #2. CI enforced the same numbers on HEAD (run
29620033585, green).

### 3.3 The SDK is off the boot chain — live, not just in dist

Live HTML `modulepreload`: `rolldown-runtime-QTnfLwEv.js`,
`react-vendor-DOZiANMT.js`, `vanilla-DZJGj1NY.js` — identical set to `dist/`.
No supabase chunk, no cart chunk, no admin chunk. `8d8645b`'s three cut edges
(boot stores dynamic-imported in the idle callback, AdminGate lazy, CartDrawer
lazy behind first cart open) verified in source. `HeroHoloCarousel` is
`React.lazy` inside `CompoundVisualizerFrame.tsx:21` inside the lazy Landing
route — 255 KB gz on the landing view, but nothing gates first paint.

### 3.4 Health endpoint + cart dedupe — real

`health/index.ts`: GET/HEAD only, SDK-free PostgREST one-row read of
`promo_settings` with a 5s abort, response is `{ok, db, ts}` and nothing else,
`no-store`. Probed live: 200 `{"ok":true,"db":true}` in 0.63s. `verify_jwt=false`
in `config.toml` as documented. `cartSubtotalCents` defined once
(`cartActions.ts:125`), called at all 8 former duplication sites (grep-verified:
CartDrawer ×2, CartPage ×6).

### 3.5 The deploy state — source verified identical, environment not

The live entry hash (`index-D3Bf34g0.js`) does not match a fresh HEAD build
(`index-CyaqL-lL.js`). Chased to ground: builds are deterministic (rebuild →
identical hashes) and path-independent (same commit built in a scratch worktree →
identical hashes), HEAD's hashed assets 404 off the live worker, and a normalized
diff of the live entry vs HEAD's shows **exactly one real difference: the baked
`VITE_SUPABASE_ANON_KEY`** — live carries the new `sb_publishable_…` key, the
repo `.env` (mtime Jul 6) carries the legacy JWT anon key. Every other differing
chunk hash is pure cascade from that one constant (verified: `pricing` and
`productOverrides` chunks differ only in embedded neighbor-chunk hashes). So the
deployed frontend **is** HEAD's source — `d73c402`'s cart dedupe and the design
pass are live — but the artifact was built with an env override that exists
nowhere in the repo. Both keys currently authenticate (`/auth/v1/health` → 200
with each). See §4 #1.

## 4. New findings this review (severity-ranked)

**#1 — MEDIUM: the deployed frontend cannot be rebuilt from the checkout — the
baked anon key came from outside the repo.** The live build bakes
`sb_publishable_OZqMGcP7YYh…`; a `scripts/deploy.sh --frontend` from this
checkout bakes the legacy JWT key from `.env` (proven §3.5 — the sole real diff
between live and HEAD builds). Both keys are valid **today**, so nothing is
broken — but the whole point of publishable keys is that the legacy JWT pair
eventually gets rotated off, and the repo has no record of the new key. Failure
scenario: legacy key disabled in the Supabase dashboard → the next routine
frontend deploy (built from `.env`) ships a dead key → every API call from the
site 401s — the exact "backend not configured" class the deploy-from-main-repo
rule exists to prevent, arriving through the front door. Fix: put the publishable
key in `.env` (it is a public client key, not a secret; `.env` is gitignored) and
note the migration in `docs/DEPLOY_PLAN.md`. ~15 min.

**#2 — MEDIUM: money arithmetic still lives inline in `index.ts`, untested.**
The extraction took the stacking engine, but Pass 1's flat-cap math is still
inline: the free-item "make one owned unit free" contribution
(`max(min(unit, gross−flat),0)`, `index.ts:854`) and the fixed-code cap
(`index.ts:877-879`), plus the redemption-rollback re-price
(`discountCents -= a.contribution` / `max(...,0)` /
`total = gross−discount+shipping`, `index.ts:1259,1271-1272`). These decide real
dollars on real orders and are exercised by zero tests — the `vitest.config.ts`
comment "index.ts is I/O orchestration" oversells by exactly this much. They are
small and extractable into `orderTotals.ts` siblings with the same pattern.
~2-3h. This is the honest gap in "the money path is covered."

**#3 — LOW: the coverage ratchet margins are razor-thin.** Lines floor 45 vs
measured 45.20 (**0.20 margin**), statements 44 vs 44.60. One deleted test file
or refactored module fails CI on noise rather than regression — same brittleness
the baseline flagged at 0.72. Either accept the churn or ratchet on the
place-order dir (where the bar is 96+) separately from the global floor.

**#4 — LOW: the uptime monitor is a document, not a probe.** The health endpoint
is deployed and answering (§3.4) — that half is real. But `docs/UPTIME.md` is
UptimeRobot *setup instructions*; nothing verifies a monitor exists, and no
monitor identity/config is recorded anywhere. Until a probe is registered and a
test alert has fired, the system's downtime detection is still "the owner
notices." ~30 min of clicking, then record the monitor URL in UPTIME.md.

**#5 — LOW: release cadence is still hand-shaped.** Two frontend deploys 45
seconds apart (23:12:28Z, 23:13:13Z) and ~9 worker deploys across the day; no
`deploy/edge/*` tag was created (deploy.sh prints the reminder, nothing
enforces it). Combined with #1, the "was this deploy the script or a hand-run?"
question cannot be answered from the record — which is the question deploy.sh
exists to answer.

**#6 — INFO (carried): crash window between order persist and voucher claim.**
Order row inserted with the reward discount baked in (`index.ts:981-1007`),
voucher claimed at `:1107`; a crash between persists an under-billed order with
the voucher still `active`. Unchanged, sub-second, reconciliation query still
the cheap close.

**#7 — INFO (carried): the winner path has still never executed in prod.** Not
re-verified this review (requires a prod read); no code change touched the claim
path this cycle. The first real voucher order remains the first prod execution.

**#8 — INFO: the health endpoint is an unauthenticated DB read per request.**
Every anonymous GET costs one PostgREST round-trip; there is no rate limit.
Fine at monitor cadence (2 probes × 5 min); a griefer curl-looping it burns DB
connections for free. Cheap-to-accept risk; noted for the record.

## 5. Path forward (ordered, concrete)

1. **Record the publishable key in `.env`** and note the key migration (§4 #1) —
   make `deploy.sh --frontend` reproduce what is live. ~15 min. **Do this before
   the next frontend deploy, not after.**
2. **Extract the residual Pass-1 flat-cap + rollback re-price math** into
   `orderTotals.ts` siblings with pinning tests (§4 #2) — finishes the "money
   path measured" story honestly. ~2-3h.
3. **Register the two uptime monitors and fire a test alert** (§4 #4); paste the
   monitor dashboard URL into UPTIME.md. ~30 min. (Observability → A-.)
4. **Next cycle ships via one `deploy.sh` run end-to-end** and creates the tag
   (§4 #5) — one deploy, one record.
5. **Grow `src/lib` coverage** (accountData, customerAuth, tracking, placeOrder
   are 0%) toward the 80% bar; ratchet follows. Ongoing.
6. **Run the winner-path once against prod** with a real test voucher (§4 #7)
   and reconcile — the last unexecuted money branch.
7. **Split the Hero chunk** (255 KB gz) if landing LCP matters next; it is lazy
   and route-gated, so this is polish, not a blocker.

Items 1–3 are the A line: reproducible deploys, the last inline dollars tested,
and a monitor that provably pages. Nothing on this list is a regression risk to
what shipped today.

## 6. Post-review addendum — follow-up wave verified (`cd6f270`, `fcf4f61`; verified same night)

*Added by the same reviewer after the coordinator's follow-up wave, kept
transparently separate from §1–§5 (which stand as written on `47eca66`). Every
claim below was re-verified adversarially, same standard.*

**§4 #2 (residual inline money math) — CLOSED, extraction verified faithful.**
`cd6f270` moves the last three pieces into `orderTotals.ts` and I diffed each
against the removed inline code: `flatContribution` is byte-equivalent to the
old `max(min(v, gross−flat), 0)`; `sanitizeFixedDiscountCents` reproduces the
old `floor(Number(x ?? 0))` → NaN/±Inf/negative→0 exactly; and
`repriceAfterFailedRedemptions` is an exact-semantics port — the old code
subtracted each failing entry's contribution during the loop and floored once
at the end; the new code collects `failedContributions` **per failing entry**
(not re-derived by code match) and does the same reduce-then-floor, with the
same shipping-on-top rebuild. No divergence found. `orderTotals.ts` measures
**100/100/100/100** (verified via coverage JSON), `orderTotals.test.ts` has 69
tests, suite **494 passed / 21 skipped**, thresholds pass at 45.49 L / 44.84 S /
46.82 B / 44.82 F. `index.ts` now genuinely carries no discount arithmetic —
the "I/O orchestration" claim is no longer an oversell. **place-order v64
ACTIVE** (23:32:43Z) carries it; `tsc -b` + `deno check` clean at HEAD
`fcf4f61`; CI run 29620959746 success.

**§4 #1 (irreproducible frontend artifact) — CLOSED, proven byte-for-byte.**
`.env` now bakes the `sb_publishable_…` key (JWT parked in `.env.bak-jwt-key`,
untracked; `.env.example` documents the migration in `fcf4f61`). A fresh
`npm run build` from the checkout produces `index-B3IMHstd.js` — **exactly what
live serves** — and `assets/payment-BHUvg1IT.js` fetched from prod is
**byte-identical** (`cmp` clean) to the local dist copy, real Zelle handle
baked. The deploy is reproducible from the repo again.

**§4 #4 (unregistered monitor) — CLOSED (registered + test-fired), with a noted
limit.** `.github/workflows/uptime.yml` is a real scheduled probe (`*/15` cron +
dispatch, GitHub-hosted runner — genuinely outside the Worker/Supabase failure
domain) hitting both URLs with keyword checks; dispatch run **29620987364
success** (probe job green in 5s). Honest caveats, not blockers: GitHub cron is
best-effort, no *scheduled* run had fired yet at verification time (workflow
minutes old), and alerting is GitHub's default failure e-mail — the workflow
itself acknowledges all three. This now counts as a running external probe.

**NEW INCIDENT — recorded as a finding. MEDIUM: an out-of-band deployer raced
this wave on the same account.** Timeline verified in `wrangler deployments
list`: 23:33:03Z (this wave's deploy), **23:33:35Z — 32 seconds later, same
account identity (`raymonwelltaylorc@icloud.com`), not initiated by this
session**, then 23:38:16Z (canonical redeploy, Current Version `ea1632e7`,
verified serving the byte-identical HEAD build above). The coordinator reports
the rogue 23:33:35 artifact carried the publishable key but was missing
`VITE_ZELLE_HANDLE` — which would render `[Set VITE_ZELLE_HANDLE]` on payment
surfaces (`src/lib/payment.ts:18`); that artifact is superseded and its assets
are gone, so its *content* is reported-not-independently-verifiable, but the
deployment record fully corroborates the timeline. My read: this
retroactively explains §4 #1 — the 23:13 artifact with the out-of-repo key was
plausibly the **same out-of-band builder** (another machine/session on the
owner's account; the repo's own parallel-agents history makes an owner-side
origin likely). Severity **MEDIUM**: whatever the origin, the account has a
deployer whose builds carry no provenance (`Source: Unknown`, no message, no
tag) and whose env bakes stale values into money-adjacent UI. Fixes: (a)
identify/stop the other deploy lane; (b) `wrangler deploy` with `--message`/
tags from deploy.sh so ours are distinguishable; (c) if the origin can't be
identified, rotate the Cloudflare API token — an unattributable prod deployer
is one rotation away from being a security finding instead of an ops one.

**Effect on the grade.** All three of §5's stated A-line items (1–3) are now
done and verified. Domain moves: **Observability B+ → A-** (health endpoint +
registered, test-fired external probe + complete money alert net); **Testing
holds B+** strengthened (money path now 100% to the last cap; whole-surface
45% and the `src/lib` zeros still bar A-); **CI/CD holds B+** — reproducibility
closed, but the unknown-deployer incident opens a provenance gap of the same
weight. **Overall: A- holds, now on firmer footing than §1 granted it.** A is
blocked by exactly: the unknown-deployer provenance gap (the new MEDIUM),
whole-surface coverage vs the 80% bar, and the carried crash-window/winner-path
items. Verified head after the addendum: `fcf4f61`; DB **066**; place-order
**v64**; frontend **ea1632e7** (byte-identical to a clean checkout build).

---
*Verification footprint: read-only except this file. Ran `git log/show/diff/
status/worktree` (scratch worktree in the session scratchpad, built at two
commits for hash comparison, then removed); `tsc -b`, `deno check`, `eslint .`,
`npm run build` ×2 (determinism), `vitest run --coverage` + JSON summary; `gh run
list`; `supabase migration list`, `supabase functions list`; `wrangler
deployments list`; `curl` of the live site HTML + 6 hashed assets + cache-bust
probes + `functions/v1/health` ×1 + `auth/v1/health` ×2 (key-validity check, no
data returned). No order placed, no DB write, no deploy, no throttle probe (each
lookup_order call writes a bucket row). Addendum pass re-ran the gates at
`fcf4f61` (tsc/deno/vitest+coverage JSON/build), diffed `cd6f270` hunk-by-hunk,
byte-compared live `index-B3IMHstd.js` + `payment-BHUvg1IT.js` against a fresh
checkout build, read `uptime.yml` + runs 29620987364/29620959746, and checked
`wrangler deployments list/status`. No tracked file modified except this
report.*
