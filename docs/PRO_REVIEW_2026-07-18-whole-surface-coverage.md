# Pro Review — VS Research Labs, Whole-Surface Coverage Wave (verified 2026-07-18)

Independent, adversarial principal-engineer re-grade of the system **as deployed**,
grading the whole-surface test-coverage wave against the money-path review's
remaining A-blockers. Lineage: `docs/SYSTEM_SCAN_2026-07-16.md` (D) →
`docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md` (B-) →
`docs/PRO_REVIEW_2026-07-16-post-deploy.md` (B) →
`docs/PRO_REVIEW_2026-07-17-b-plus.md` (B+) → `docs/PRO_REVIEW_2026-07-17-a-path.md`
(B+ held) → `docs/PRO_REVIEW_2026-07-17-money-path.md` (**A- + addendum — the
baseline for this review**).

Verified head: `04cf839` (commits since baseline head `fcf4f61`: `b9efbba`,
`30d3be2`, `04cf839`). **No production source changed this wave** —
`git diff fcf4f61..HEAD --stat -- src supabase` is empty; the diff is tests,
`vitest.config.ts`, `.gitignore`, and `scripts/labels/` (31 files, +6,228 lines).
Gates re-run locally at HEAD: `tsc -b` clean, `DENO_NO_PACKAGE_JSON=1 deno check
supabase/functions/` clean, `eslint .` **0 errors** (43 warnings, pre-existing),
`npm run build` OK (entry `index-B3IMHstd.js` — identical hash to the baseline's
canonical artifact), `vitest run --coverage` **890 passed / 21 skipped** (the
skips are the env-gated RLS suite, unchanged), coverage **99.64 S / 96.82 B /
99.31 F / 99.82 L** over the measured surface, thresholds 97/97/94/96 pass.
CI green on HEAD (run 29636765811). Prod verified read-only: `supabase migration
list` local/remote in sync through **066**; **place-order v64 ACTIVE**;
`functions/v1/health` → 200 `{"ok":true,"db":true}` in 1.03s; the uptime cron
has now fired **on schedule** three times overnight (01:06Z, 04:15Z, 06:28Z) —
the addendum's "no scheduled run yet" caveat is closed.

**But the frontend did move — and not by this session.** `wrangler deployments
list` shows three NEW deployments after the baseline's canonical `ea1632e7`
(23:38:16Z): **23:45:13Z, 07:56:54Z, and 08:02:54Z (now Current)**. The live
site is serving the out-of-band lane's artifact, and its payment surface is
broken (§3.5, §4 #1). That incident dominates this review's grade arithmetic.

---

## 1. Overall grade: **A- (held — by the width of an env var)**

The baseline named three A-blockers: (a) whole-surface coverage vs the 80% bar,
(b) the unknown-deployer provenance gap, (c) the carried crash-window /
winner-path INFOs. This wave attacked (a) and cleared it beyond argument:

- **The measured surface went from 45% to ~100%, and the tests are real.**
  890 tests (vs 494), every one of the 41 files in the coverage set ≥83%
  branches / ≥96% statements, the `src/lib` zeros
  (`accountData`/`customerAuth`/`tracking`/`placeOrder`/`exporters`) all
  eliminated. I sampled six suites adversarially (§3.2) looking for
  tautologies, implementation-mirroring, and vacuous over-mocking — and found
  high-quality behavioral pinning instead, including all three money-path
  client invariants (the `effectiveTierPriceCents` override path, the
  variant-dose $0 incident, the `cartSubtotalCents` SSOT) asserted with
  concrete numbers against seeded state, not against the implementation's own
  output.
- **The ratchet did its job and then ratcheted**: 45/44/46/43 → **97/97/94/96**
  with a deliberate ~2-point margin, fixing the razor-thin-floor brittleness
  the baseline flagged (§4 #3 there). CI enforces it as a hard gate.
- **The offline network guard is genuine** (§3.3): `tests/setup.ts` replaces
  `fetch`/`WebSocket`/`XMLHttpRequest` with throwing stubs before any test
  module loads, closing the "test silently hits prod" seam that once leaked
  real SKUs.

But blocker (b) did not just carry — **it detonated.** Between the addendum's
verification and this review, the out-of-band deployer was identified (by me,
from the deployment record: every push to `main` produces a deploy 56–110s
later — it is a git-connected auto-build lane on the Cloudflare account) and it
**overwrote the canonical frontend 7 minutes after the baseline signed off**,
then twice more when this wave's test commits were pushed. Its build env lacks
`VITE_ZELLE_HANDLE`, so the live payment chunk resolves the Zelle handle to the
literal **`[Set VITE_ZELLE_HANDLE]`** — verified byte-level against the live
asset (§3.5). A buyer reaching payment instructions right now is not told where
to send money. That is a **HIGH** finding, live since ~23:45Z.

Why A- still holds, stated plainly: the defect is **environmental, not code**
— the repo's own build is proven correct byte-for-byte (`index-B3IMHstd.js`
bakes `info@velariss.co`), the fix is minutes of owner-side configuration, and
every code-and-test claim this wave made verified clean. Grading the
*engineering system* — code, tests, CI, reproducibility — this is the
strongest state in the lineage. But **A is flatly unavailable** while an
uncontrolled deploy lane can and does ship broken money-adjacent UI on every
push, and if that lane is not fixed before the next review, the honest grade is
B+, because the deploy story poisons everything downstream of it.

A requires exactly: (1) the auto-deploy lane fixed or killed (§4 #1/#2 — the
single most urgent item in this document), (2) the carried crash-window and
winner-path items closed (§4 #4/#5), (3) the test story extended past the unit
surface — `place-order/index.ts` orchestration (1,528 lines, deno-checked
only), the other edge functions (~3,470 lines), and at least one CI-run E2E of
the checkout flow (§4 #3).

## 2. Scorecard

| # | Domain | Scan (D-era) | B- | B | B+ | A- (baseline) | NOW | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | F | B- | B | A- | A- | **A-** | 0 | Server engine held at ~100%; the three client price invariants (override path, variant dose, subtotal SSOT) now pinned by incident-replaying tests (§3.2). Crash window + never-run winner path still carried. |
| 2 | Security & authz | D | B+ | B+ | B+ | A- | **A-** | 0 | No new attack surface (zero production-source change, verified by diff); auth client paths (session claim, anti-enumeration signup, OTP) now behaviorally tested. 066 in sync; throttle not re-hammered (writes rows). |
| 3 | Data integrity | B- | B+ | B+ | B+ | B+ | **B+** | 0 | Untouched this wave; order-persist→voucher-claim crash window still the open item (§4 #4). |
| 4 | Testing | D+ | C+ | C+ | B- | B+ | **A-** | +0.5 | 890 tests; measured surface 99.64 S / 96.82 B, all 41 files ≥80%; quality adversarially sampled and non-hollow (§3.2); offline guard real (§3.3); ratchet 97/97/94/96. Not A: `index.ts` orchestration + other edge fns + the 34.7k-line UI layer sit outside the surface, no integration/E2E in CI, RLS suite still env-skipped. |
| 5 | CI/CD & release hygiene | D | B- | B | B+ | B+ | **B-** | −0.5 | The provenance gap materialized: an identified push-triggered auto-deploy lane overwrote the canonical artifact ×3 and is serving a broken-env build live (§3.5); `ci.yml`'s "git push deploys nothing" is now false in practice; deploys remain untagged/unattributed. CI itself is green and gates hard — the release half is the failure. |
| 6 | Dependencies | B | B | B | B | B | **B** | 0 | Unchanged; wrangler still 4.86 vs 4.112 via npx; dependabot minor/patch PR pending, CI-green. |
| 7 | Performance | C+ | C+ | C+ | C+ | B | **B** | 0 | Untouched; SDK stays off the boot chain in the repo build; Hero chunk 955 KB (255 KB gz) carried. |
| 8 | Accessibility | C+ | B | B | B | B+ | **B+** | 0 | Untouched this wave. |
| 9 | Frontend quality | C+ | B- | B- | B- | B | **B** | 0 | No frontend source change; `useScrollLock`/`useAccountEmailPrefill` hooks now tested but that moves Testing, not this. |
| 10 | Observability | D | B- | B- | B- | A- | **A-** | 0 | The cron probe is now proven firing on schedule (3 overnight runs) — but it watches availability, not correctness: it green-lit a night of broken payment UI. Holds A-; a content assertion on the payment surface would close the gap (§4 #2). |
| 11 | `video/` workspace | B | B+ | B+ | B+ | B+ | **B+** | 0 | Untouched. |

Arithmetic: Testing joins Pricing/Security/Observability at A-, nothing below
B **except CI/CD at B-** — and one **HIGH** finding is open for the first time
since the B era. The A- overall survives only because the HIGH is
config-not-code with a minutes-long fix and the wave's own claims all verified;
it is the last time that trade will be extended.

## 3. Adversarial verification

### 3.1 The wave's claims, checked one by one

- **"No production source changed"** — TRUE. `git diff fcf4f61..04cf839 --stat
  -- src supabase` → empty. The 6,228 added lines are 27 test files,
  `tests/setup.ts`, `tests/fixtures`, `vitest.config.ts`, `.gitignore`,
  `scripts/labels/`.
- **"889 passing / 21 skipped"** — measured **890**/21 (one more than claimed;
  46 files, 45 passed + 1 skipped). The skipped file is
  `tests/rls/portalIsolation.test.ts` via `describe.skipIf(!canRun)` — the
  documented Docker/env gate, not a silent hole.
- **"99.64 S / 96.55 B / 99.31 F / 99.82 L"** — measured **99.64 / 96.82 /
  99.31 / 99.82** (branches marginally better than claimed). Verified via both
  the text reporter and `coverage-summary.json`: 41 files, weakest three by
  branch are `src/lib/payment.ts` 83.33, `place-order/rewardVoucher.ts` 85.71,
  `src/lib/adminAuth.ts` 87.50 — nothing under the 80% bar on any metric.
- **Ratchet** — `vitest.config.ts:35` thresholds 97/97/94/96, comment updated,
  margin ~2 points (the baseline's §4 #3 thin-floor complaint addressed as
  specified).
- **CI green on HEAD** — run 29636765811 (04cf839) success; wave-1 run
  29636584432 success. Both enforced the new thresholds (`npm run
  test:coverage` is a hard gate, `ci.yml:64`).
- **DB/functions unmoved** — migrations in sync through 066; place-order v64
  ACTIVE. The frontend, however, DID move — see §3.5. The wave itself deployed
  nothing; its pushes *triggered* the rogue lane.

### 3.2 Test-quality audit — sampled adversarially, found non-hollow

Coverage percent is not quality, so I read six suites end-to-end hunting for
tautologies (asserting what the code computes against itself),
implementation-mirroring, and over-mocked vacuity:

- **`cartActions.test.ts` (the money one) — excellent.** The three
  production-incident invariants are pinned the right way around:
  the override-beats-formula test seeds `price_cents: 8888` into the real
  Zustand store, asserts the line price is 8888 **and asserts it is NOT the
  formula's answer** (`:149` — this fails if anyone reroutes to bare
  `tierPriceCents`, the exact bug class from memory); the $0-regression block
  (`:312-327`) reproduces the bare-`add(product)` incident (asserts the bare
  product still degrades to 0, then that `variantProduct` fixes it);
  `cartSubtotalCents` is asserted against a hand-computed constant
  (`8888*2 + 12000 + 6500*3`) *before* the internal-consistency check.
  Wholesale/fast/mixed-shipping edges all use seeded per-dose rows.
- **`placeOrder.test.ts` — excellent.** Pins the contractual surface: payload
  travels unmodified except `idempotency_key` (asserted via `structuredClone`
  snapshot + deep-equal on the invoke body), caller's object never mutated,
  idempotency key stable/rotating/cleared with sessionStorage stubbed
  (including quota-throw and corrupt-JSON paths), and every failure mode —
  server error string, transport error, thrown TypeError, 30s fake-timer
  timeout — settles to a specific user-facing message. Nothing vacuous.
- **`exporters.test.ts` — exceptional.** Rather than trusting the writer, it
  ships a test-local ZIP reader written against the PKZIP spec ("mirrors
  nothing; reads the spec") and verifies the .xlsx byte stream: local headers,
  central-directory offsets, EOCD counts, per-entry CRC local↔central
  agreement, worksheet XML cell-by-cell, Excel's 31-char/illegal-char sheet
  rules, Z→AA column rollover, XML control-char stripping. This is the
  strongest test file in the repo.
- **`customerAuth.test.ts` — good.** Real `renderHook`/RTL behavioral tests:
  once-per-session `link_my_orders` claim (and its re-arm on sign-out),
  anti-enumeration signup ("already registered" → code step), OTP trim/type,
  listener unsubscribe on unmount, profile-load failure degrading without a
  crash. Mocks sit at the supabase seam; assertions are on hook state and
  call contracts, not internals.
- **`accountDiscount.test.ts` — good.** Pins fidelity to
  `effective_customer_discount()` semantics (scope gating on account type,
  date windows, percent sanity, best-of tie-break to newest) with data-driven
  rows. One mild fragility: the mock discount chain resolves on the *second*
  `.eq()` via `mockImplementationOnce` sequencing — coupled to the query's
  call order, so a harmless query refactor breaks the mock (test fails loud,
  not wrong — acceptable, noted).
- **`supabase.test.ts` — good.** Re-imports the module per test with stubbed
  env; pins the degrade-to-null-never-throw bootstrap contract, placeholder
  URL rejection, `createClient` explosion containment, and the typed
  `requireSupabase` error.

The one near-vacuous test in the sample: `payment.test.ts:39-46` asserts
`PAYMENT_CONFIG.zelle` is "a non-empty string (real or placeholder)" — which is
true of the broken live build too. Unavoidable for baked env at unit level, but
worth naming because the actual live defect this review found (§3.5) is
precisely the case that assertion cannot catch. **Verdict: the coverage is not
hollow. This is real behavioral pinning, and the money invariants are pinned.**

Honesty note on "whole-surface": the measured surface is `src/lib/**` (3,722
lines) + the Deno-free place-order modules. Outside it: `place-order/index.ts`
(1,528 lines, `deno check` only), ~3,470 lines of other edge functions, and
~34,700 lines of `.tsx` UI. The lineage has always defined the coverage
blocker over this include set, so the blocker is honestly cleared — but the
CLAUDE.md 80% bar over the *repo* is not the same claim, and nobody should
read it as such.

### 3.3 The offline guard — real, with named residual seams

`tests/setup.ts` replaces `globalThis.fetch` with a throwing stub and proxies
`WebSocket`/`XMLHttpRequest` construction to throw, before any test module
loads (`setupFiles`, `vitest.config.ts:13`). Checked the escape hatches: the
stubs are plain assignments (not `vi.stubGlobal`), so a test's
`vi.unstubAllGlobals()` restores *the guard*, not the network; happy-dom
suites get the guard too because setup files run after environment install
(verified: the exporters suite runs under happy-dom and the guard is active).
Residual seams a hostile test could still use: `node:http/https/net` directly,
undici's `Agent`, or `child_process` — none reachable by supabase-js (which
uses fetch/WebSocket exclusively), so the guard seals the realistic prod-hit
path it was built for. INFO-level residue, not a finding.

### 3.4 Live state — DB and functions unmoved, probes healthy

Migrations local/remote in sync through **066**; **place-order v64 ACTIVE**;
health endpoint 200 `{ok:true,db:true}` in 1.03s (one probe). The uptime
workflow's *scheduled* runs are now on record (01:06Z / 04:15Z / 06:28Z, all
success, ~6s) — the baseline addendum's "cron not yet proven" caveat is
formally closed. No order placed, no `lookup_order` call, no DB write.

### 3.5 The frontend — the out-of-band lane identified, and it is serving a broken payment surface

The baseline left `ea1632e7` (23:38:16Z) Current, byte-verified. Since then,
three deployments, none from this session, all `Source: Unknown`, no tag, no
message: **23:45:13Z**, **07:56:54Z**, **08:02:54Z** (Current Version
`66f3d7d5`). Correlating against push times settles the provenance question
the baseline could not:

| Push to main (CI run start) | Deploy | Lag |
|---|---|---|
| 23:12:00Z (`47eca66`) | 23:13:13Z | 73s |
| 23:32:38Z (`fcf4f61`) | 23:33:35Z | 57s |
| 23:43:11–23:43:23Z (`c94cee3`,`6bd5bbd`) | 23:45:13Z | ~110s |
| 07:55:46Z (`30d3be2`) | 07:56:54Z | 68s |
| 08:01:58Z (`04cf839`) | 08:02:54Z | 56s |

Five for five. **The "unknown deployer" is a push-triggered auto-build lane on
the Cloudflare account** (the signature — build-latency lag from a clean env,
`Source: Unknown` — is Cloudflare Workers Builds' git integration or an
equivalent owner-side hook). This retroactively explains every anomaly in the
baseline: the 23:13 artifact with the out-of-repo key, and the 23:33:35
"race" 57s after the `fcf4f61` push.

What it is serving: live entry is `index-D3Bf34g0.js` — the *23:13 artifact
hash*, not the canonical `index-B3IMHstd.js` a repo build produces (verified:
`npm run build` at HEAD reproduces `B3IMHstd` exactly). The lane's env bakes
the correct `sb_publishable_…` key and Supabase URL — **and nothing else**.
Fetched the live payment chunk (`assets/payment-q5ehtlAh.js`, 440 bytes) and
read it whole: its baked env object is
`{BASE_URL, DEV, MODE, PROD, SSR, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL}`
— **no `VITE_ZELLE_HANDLE`** — so `PAYMENT_CONFIG.zelle` resolves to the
fallback literal **`[Set VITE_ZELLE_HANDLE]`** (`src/lib/payment.ts:18`). The
repo build's same chunk (`payment-BHUvg1IT.js`) bakes `info@velariss.co`.
Every payment-instruction surface on the live site is currently telling buyers
to send money to a placeholder string, and has been since ~23:45Z (and, this
evidence now shows, also in the 23:13→23:38 window the baseline's entry-only
normalized diff couldn't see — the Zelle handle lives in the payment chunk,
not the entry). Because the lane fires on every push, the canonical artifact
cannot stay deployed: **any future push re-breaks the site** until the lane's
env is fixed or the lane is killed. Reported to the coordinator mid-review;
remediation is owner-side and out of scope for a read-only re-grade.

Corollary: `ci.yml`'s documented invariant "ALL deploys are manual … git push
deploys nothing" (`ci.yml:21-22`) is false in practice, as is the memory rule
built on it. The repo's deploy model of record and the account's actual
behavior have diverged.

## 4. Findings this review (severity-ranked)

**#1 — HIGH: the live payment surface shows `[Set VITE_ZELLE_HANDLE]` instead
of the Zelle handle.** Evidence in §3.5 — byte-level, from the live asset, not
inference. A buyer at checkout/payment instructions cannot see where to send
payment; for a Zelle-only store this is a revenue-stopping defect on the money
path. Live since ~23:45:13Z (≥8h at verification). Root cause: the
push-triggered auto-deploy lane's build env lacks `VITE_ZELLE_HANDLE`. Fix
(owner-side, minutes): EITHER disable/disconnect the git-connected build on
the Cloudflare account, OR add `VITE_ZELLE_HANDLE` (and keep
`VITE_SUPABASE_*` current) to its build variables — then run
`scripts/deploy.sh --frontend` from the repo root and byte-verify the live
payment chunk (`curl … | grep velariss`). Until one of those happens, **every
push to main re-ships the broken build.**

**#2 — MEDIUM: the deploy lane itself — now identified, still uncontrolled.**
The baseline's "unknown-deployer provenance gap" is half-closed (identity:
push-triggered auto-build, five-for-five push↔deploy correlation) and
half-worse (it demonstrably overwrites canonical deploys and bakes stale env).
Beyond the #1 env fix, the lane needs an owner decision: keep it as THE deploy
path (then give it the full env and retire `deploy.sh --frontend`, updating
`ci.yml`'s comment and `docs/ROLLBACK.md`), or kill it (then the manual model
of record is true again). Two deploy lanes with different envs is the worst of
both and is the configuration that produced #1. Related cheap hardening: the
uptime probe's keyword check watches availability, not correctness — add a
content assertion that the live payment chunk contains the real handle (a
5-line curl+grep step in `uptime.yml`) so this class of breakage pages someone
instead of surviving three green probe runs.

**#3 — MEDIUM (carried, sharpened): the test story stops at the unit
surface.** `place-order/index.ts` (1,528 lines — auth, idempotency replay, DB
write sequencing, voucher claim ordering) is executed by zero tests; the other
~3,470 edge-function lines likewise; no E2E runs in CI (Playwright exists,
local-only); the RLS suite still needs Docker. The unit surface is now
saturated — the next real risk reduction is an integration/E2E lane, not more
unit tests.

**#4 — INFO (carried): crash window between order persist and voucher claim.**
Unchanged (`index.ts` untouched since `fcf4f61`); sub-second window;
reconciliation query remains the cheap close.

**#5 — INFO (carried): the reward-voucher winner path has still never executed
in prod.** Not re-verified (requires a prod read); no code change touched it.

**#6 — INFO: minor test-suite notes for the record.** `payment.test.ts`'s
`PAYMENT_CONFIG` assertion is env-shape-only (cannot catch #1's class — by
design, noted in §3.2); `accountDiscount.test.ts`'s mock chain couples to
query call-order; `placeOrder.test.ts` derives cart signatures with a helper
that mirrors the implementation's format (used for fixture setup, and the
rotate/reuse assertions are behavioral, so no vacuity). None warrant action.

## 5. Path forward (ordered, concrete)

1. **Fix or kill the auto-deploy lane and restore the canonical frontend**
   (#1/#2) — env var into the lane or lane disabled, then `deploy.sh
   --frontend` from repo root, then byte-verify the live payment chunk. **Do
   this before anything else and before any further push to main.** ~15–30 min.
2. **Add the payment-surface content assertion to `uptime.yml`** (#2) — make
   the probe catch correctness, not just liveness. ~15 min.
3. **Decide the deploy model of record** (#2) — one lane, documented, with
   `ci.yml`/`ROLLBACK.md`/memory updated to match reality. ~30 min + owner
   decision.
4. **Close the crash window** (#4) with the reconciliation query, and **run
   the winner path once** against prod with a test voucher (#5). ~1–2h.
5. **Stand up a minimal CI E2E lane** (#3): one Playwright checkout journey
   against a preview build with mocked place-order, plus a smoke of the
   deployed health endpoint. This is the Testing A- → A move. ~1 day.
6. Carried polish: Hero chunk split (255 KB gz), wrangler pin, dependabot PR
   merge after review.

Item 1 is the A line's gate; items 1–4 together with the E2E lane are the
honest A. Nothing in this wave's shipped work needs revisiting — it all
verified clean.

---
*Verification footprint: read-only except this file. Ran `git log/diff/show`;
`npx vitest run --coverage` ×2 (text + json-summary reporters, per-file numbers
from `coverage/coverage-summary.json`); `npx tsc -b`; `DENO_NO_PACKAGE_JSON=1
deno check supabase/functions/`; `npx eslint .`; `npm run build`; `gh run
list` (CI + uptime runs); `supabase migration list`; `supabase functions
list`; `npx wrangler deployments list` + `deployments status`; `curl` of the
live site HTML, the live entry `index-D3Bf34g0.js`, and the live
`payment-q5ehtlAh.js` (byte-compared against the repo build's
`payment-BHUvg1IT.js`); one `functions/v1/health` probe. Read six test suites
end-to-end plus `tests/setup.ts`, `vitest.config.ts`, `ci.yml`,
`src/lib/payment.ts`. No order placed, no DB write, no deploy, no
`lookup_order` call, no throttle probe. The HIGH finding was reported to the
session coordinator immediately upon verification, mid-review. No tracked file
modified except this report.*

---

## Post-review remediation addendum — written by the session coordinator, not the reviewer (2026-07-18, ~08:20Z)

*Kept transparently separate: §1–§6 above stand as written by the independent
reviewer on `04cf839`. Everything below was done and verified by the
coordinator after the reviewer flagged the HIGH finding mid-review.*

**The HIGH customer-facing defect is CLOSED on live.** `787056c` changes the
`PAYMENT_CONFIG.zelle` fallback from the `[Set VITE_ZELLE_HANDLE]` placeholder
to the real handle (`src/lib/payment.ts` — env still wins when set), and
replaces the shape-only PAYMENT_CONFIG test the review called out with two
behavioral pins (env wins; env-missing build still shows the real handle,
never a placeholder — `tests/unit/payment.test.ts`). The auto-deploy lane
itself then shipped the fix: its push-triggered build at **08:16:36Z** carries
the hardened fallback, and the live payment chunk (`payment-CS-JRhgG.js`,
reached from live entry `index-ByqYopos.js`) now contains `velariss.co` and
zero placeholder strings, with the publishable key still baked
(`sb_publishable_OZqMGcP7…`). Verified by direct curl of the live assets at
~08:19Z. The lane that broke the site is now structurally incapable of
re-breaking this surface — any build of `main` shows the real handle.

**What remains open (unchanged from §6):** the lane's provenance/ownership
(#1 — identify, then kill it or give it a full env; owner-side), the deploy
model of record (#2), and the carried crash-window / winner-path / E2E items.
A canonical `deploy.sh --frontend` run was NOT executed — this session's
permission mode blocks `wrangler deploy`; live is the auto-lane's build of
`fba4089`+`787056c` source, content-verified but still `Source: Unknown` in
the deployment record. CI green on the remediation push (run 29637150115).
