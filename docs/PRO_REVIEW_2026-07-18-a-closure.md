# Pro Review — VS Research Labs, A-Closure Wave (verified 2026-07-18)

Independent, adversarial principal-engineer re-grade of the system **as
deployed**, grading the A-closure wave against the baseline's §5 path forward.
Lineage: `docs/SYSTEM_SCAN_2026-07-16.md` (D) →
`docs/SYSTEM_SCAN_INTEGRATION_2026-07-16.md` (B-) →
`docs/PRO_REVIEW_2026-07-16-post-deploy.md` (B) →
`docs/PRO_REVIEW_2026-07-17-b-plus.md` (B+) → `docs/PRO_REVIEW_2026-07-17-a-path.md`
(B+ held) → `docs/PRO_REVIEW_2026-07-17-money-path.md` (A- + addendum) →
`docs/PRO_REVIEW_2026-07-18-whole-surface-coverage.md` (**A- held — the
baseline for this review**).

Verified head: `5464bcd` (commits since baseline head `351e5e3`: `ca797ba`,
`b61248d`, `f7b9c67`, `6366e6a`, `d7dffcf`, `71d2e88`, `5464bcd` — 19 files,
+1,072/−41; the src/ delta is exactly three files: the hero idle gate, the
PAYMENT_CONFIG paypal removal, and nothing else). Gates re-run locally at
HEAD: `tsc -b` clean, `DENO_NO_PACKAGE_JSON=1 deno check supabase/functions/`
clean, `eslint .` **0 errors** (43 warnings, pre-existing), `npm run build` OK
(entry `index-L7sRG1Hu.js` — new canonical hash; the payment-source commits
moved it off the baseline's `B3IMHstd`), `vitest run --coverage` **926 passed
/ 21 skipped** (up from 890; the skips are the env-gated RLS suite,
unchanged), coverage **99.65 S / 96.89 B / 99.31 F / 99.82 L**, thresholds
97/97/94/96 pass, and `reconcilePlan.ts` is inside the coverage include
(100 S / 96 B). CI green on HEAD (run 29648484768: `checks` 1m37s + the new
`e2e` job 52s). The Playwright checkout journey re-run locally: **1 passed,
1.3s**, against money numbers I re-derived independently from source (§3.3).
Prod verified read-only: migrations local/remote in sync through **067**;
**reconcile ACTIVE v1**, place-order still v64; the reconcile probe returns
`{"ok":true,"clean":true,"repaired":0}` live; the manually dispatched uptime
run 29648542273 passed **all four probes** including the new payment-content
and reconciliation steps.

**And the deploy story finally has a floor.** The auto-build lane deployed
push 1 at **14:38:08Z** (entry `index-Bs8QUbcJ.js`, now live) — then push 2,
which carries the build-time env guard, produced **no deployment at all**
(re-checked 25+ minutes after the push, against the lane's five-for-five
56–110s historical lag). The guard fail-closed the rogue lane exactly as
claimed. Live is frozen at the 14:38 artifact — and `git diff
6366e6a..5464bcd -- src/` is **empty**, so the frozen artifact's source is
byte-identical to HEAD's src. Nothing user-facing is stranded (§3.6).

---

## 1. Overall grade: **A- (held — the gap is now narrow, named, and mostly owner-scope)**

The baseline stated the A bar exactly: (1) the auto-deploy lane fixed or
killed (owner-side), (2) the carried crash-window and winner-path items
closed, (3) the test story extended past the unit surface — `place-order/
index.ts` orchestration, the other edge functions, and at least one CI-run
E2E. Scored skeptically against that bar:

- **(1) is mitigated, not met.** The lane is not fixed and not killed — it is
  *dead-manned*: `scripts/viteEnvGuard.ts` makes any build lacking the env
  contract exit non-zero, with no opt-out, and I proved it empirically in
  both directions (`VITE_ZELLE_HANDLE="" npx vite build` → exit 1; the lane's
  push-2 build produced no deployment). This is a genuinely strong code-side
  answer to an owner-side problem: the lane that shipped placeholder text to
  buyers is now structurally incapable of shipping *any* artifact until its
  env is fixed. But the lane still exists, still fires on every push, is
  still `Source: Unknown` in the deployment record, and — new evidence this
  review — **deployed push 1 whose CI run had FAILED** (run 29648378635, e2e
  job red; the lane deployed it 60s later anyway). The lane is not CI-gated.
  Only the owner can convert "fail-closed" into "fixed."
- **(2) is half-closed, honestly.** The crash window between order persist
  and voucher consume **still exists** — no code moved in place-order — but
  it is now watched every 15 minutes by a reconciliation that detects all
  four mismatch states and auto-repairs the single deterministic,
  money-invisible one. I attacked the SQL and could not make it change a
  customer-billed amount (§3.4). That is mitigation-by-detection, which is
  the correct engineering trade for a sub-second window — but the winner
  path (a successful voucher consume) has *still* never executed in
  production, and `clean:true` is equally consistent with "no voucher ever
  consumed."
- **(3) is one-third closed.** A real, money-asserting Playwright checkout
  journey now runs as a hard CI gate — I re-derived every dollar figure from
  source and re-ran it locally (§3.3). But `place-order/index.ts` (1,540
  lines — the orchestration that moves all the money) is still executed by
  zero tests, the other ~3,470 edge-function lines likewise, and the RLS
  suite still env-skips.

Why A- and not A, stated plainly: of the three named A-blockers, none is
*fully* closed — one is owner-scope (the lane), one needs a prod exercise
(winner path) plus acceptance of "mitigated" as the crash-window end-state,
and one still excludes the single most consequential file in the repo from
any test execution. Why A- and not lower: every claim this wave made
verified clean under adversarial checking — the guard fail-closes
empirically, the live payment surface is byte-correct with zero placeholders,
the reconciliation is genuinely repair-safe, all four uptime probes pass on a
real run, and the live artifact's source is identical to HEAD's src. There is
no open customer-facing defect for the first time since the B+ era, and the
one HIGH from the baseline is closed at three independent layers (hardened
fallback, build guard, uptime content probe). The honest sentence: **A- with
the gap narrowed to owner-scope decisions plus two named code items
(place-order orchestration tests, winner-path exercise).**

## 2. Scorecard

| # | Domain | Scan (D-era) | B | B+ | A- | A- (baseline) | NOW | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | F | B | A- | A- | A- | **A-** | 0 | Held. Reconciliation adds a 15-min invariant watch on the reward seam (repair proven money-invisible, §3.4); but the winner path has still never run in prod and index.ts orchestration is still untested — the same two items that kept this at A- before. |
| 2 | Security & authz | D | B+ | B+ | A- | A- | **A-** | 0 | Held. New public endpoint is GET/HEAD-only (405 verified live), id-free, and the underlying RPC is revoked from anon (42501 verified live, §3.4). Public-repo CI env assessed: all three values appear verbatim in every live-served asset — bundle-public by design, safe (§3.5). |
| 3 | Data integrity | B- | B+ | B+ | B+ | B+ | **A-** | +0.5 | The baseline's open item for this row — the order-persist→voucher-claim crash window — is now detected within ≤15 min across a 4-state taxonomy, with the deterministic state auto-healed idempotently. Window mitigated, not eliminated; detect-only states still need a human. |
| 4 | Testing | D+ | C+ | B- | B+ | A- | **A-** | 0 | Held. 926 tests (+36), all behavioral on sampling (§3.2); a real CI E2E now asserts exact checkout money. Not A: place-order/index.ts still executed by nothing, other edge fns untested, RLS env-skipped, E2E ends at cart totals by design. |
| 5 | CI/CD & release hygiene | D | B | B+ | B+ | B- | **B+** | +1 | The env guard empirically fail-closes any mis-configured build lane (no opt-out); CI gains a hard-gate e2e job and builds with the real env for byte-reproducibility; uptime now asserts payment-surface *content*. Not A-: the lane is still unowned and CI-ignoring, deploys are still untagged `Source: Unknown`, and the deploy model of record is still undecided. |
| 6 | Dependencies | B | B | B | B | B | **B** | 0 | Unchanged; wrangler 4.86 vs 4.112 via npx; dependabot minor/patch PR still pending, CI-green. |
| 7 | Performance | C+ | C+ | C+ | B | B | **B+** | +0.5 | The 955KB/255KB-gz hero chunk no longer contends with first paint — idle-gated (rIC + 200ms Safari fallback, Expand bypass), verified present in the LIVE Landing chunk. Honest limit: the chunk is deferred, not shrunk — every landing visitor still downloads it post-idle (§3.7). |
| 8 | Accessibility | C+ | B | B | B+ | B+ | **B+** | 0 | Untouched this wave. |
| 9 | Frontend quality | C+ | B- | B- | B | B | **B** | 0 | One small, well-tested component change (idle gate); no broader movement. |
| 10 | Observability | D | B- | B- | A- | A- | **A** | +0.5 | The baseline's exact named gap — "a content assertion on the payment surface" — is closed and proven in a live run (all 4 probes green, run 29648542273), and the reconciliation probe wires money-integrity mismatches into the same pager. The probe now watches correctness, not just liveness. |
| 11 | `video/` workspace | B | B+ | B+ | B+ | B+ | **B+** | 0 | Untouched. |

Arithmetic: three rows up, none down, nothing below B, no open HIGH or
MEDIUM-live finding for the first time in the lineage. The overall stays A-
because the three named A-blockers each retain a live remainder (§1) — but
this is the first review where the remainder is fully enumerable in one
sentence.

## 3. Adversarial verification

### 3.1 The build-time env guard — verified in code and empirically

Read whole (`scripts/viteEnvGuard.ts`, 138 lines; wired as a plugin in
`vite.config.ts`). Two gates: a `config`-hook throw when any of
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_ZELLE_HANDLE` is
missing, empty, whitespace-only, or set verbatim to a `[Set …]` placeholder
(via `loadEnv`, so process env and `.env` resolve in Vite's own order); and a
`generateBundle` scan that fails the build if any emitted text asset
(js/mjs/css/html/svg/json/txt/webmanifest) matches `/\[Set [A-Z0-9_]+\]/`.
`apply: 'build'` — dev and vitest untouched. I searched for an opt-out:
there is none; no env var, no flag, no conditional.

Empirical, both directions:
- `VITE_ZELLE_HANDLE="" npx vite build` → **exit 1**, with the guard's own
  message naming the var and the Cloudflare fix location.
- `npm run build` (repo `.env`) → exit 0, entry `index-L7sRG1Hu.js`.

Test quality (`tests/unit/viteEnvGuard.test.ts`, 139 lines): non-tautological
— fixed expected literals, the exact incident byte-pattern as a fixture, a
false-positive regex check (`[Setting]`, lowercase, non-placeholder brackets),
multi-var reporting, scannable-extension boundaries. One borderline pin: the
`REQUIRED_VITE_VARS` list asserted against a literal copy of itself — a
change-detector, not a behavior test, acceptable. The plugin *wiring* (the
throw actually failing a real `vite build`) is not unit-tested — my empirical
run covers it, but nothing in CI exercises the failure direction (CI only
proves the passing direction). Noted as INFO.

### 3.2 PayPal dead code — gone

`grep -rn paypal src/` → zero hits. `PAYMENT_CONFIG` is `{ zelle }` only,
fallback the real handle (baseline addendum's `787056c`, unchanged). The
`[Set VITE_PAYPAL_HANDLE]` literal that the old code would have baked into
every payment chunk regardless of Zelle config no longer exists in source —
and the guard's bundle scan would now catch any regression of the class.

### 3.3 The CI E2E — real money assertions, independently re-derived

`ci.yml` now has an `e2e` job (chromium, `npm run test:e2e`, hard gate). CI
green on HEAD `5464bcd` (run 29648484768, e2e 52s). **Push 1's run
29648378635 FAILED on the e2e job** — the dev server lacked the bundle-public
env the portal-smoke flip card needs; `5464bcd` fixed it by giving the job
the same env as the build step. Two honest observations from that failure:
the e2e lane caught a real config divergence on its first run (good), and
the auto-deploy lane deployed that CI-red push anyway (bad — §4 #1).

The money math, re-derived from source rather than trusted:
`src/lib/pricing.ts` — `hashKey('rs-bpc157-5mg')` = 3,810,154,988; mod 6 =
**2**; perMg = 7+2 = **$9/mg**; 10mg tier = `Math.round(20 + 10×9)×100` =
**11,000¢ = $110.00**. `src/lib/shipping.ts:19` — `GUEST_SHIPPING_CENTS =
999`. So unit $110.00, ×2 = $220.00 subtotal, $9.99 shipping, **$229.99
total** — exactly what `tests/e2e/checkout-journey.spec.ts` asserts, with
each row scoped to its own container so $220.00 cannot cross-match Subtotal.
Determinism is enforced, not assumed: Turnstile, PostgREST, and edge-function
routes are all aborted, so admin price overrides can never load and the
formula path is forced on any machine. Ran it locally (`PORT=5198`): **1
passed, 1.3s**. Verdict: this genuinely asserts money, not page loads — it
also pins the disclaimer gate staying closed and `Place Order` disabled.
Honest limit: the journey ends at cart totals by design (offline → no
Turnstile token → submit gated); the server-side money path has no E2E.

On committing the three env values to a **public** repo (`gh repo view` →
PUBLIC): I fetched the live payment chunk and entry — all three values
(Supabase URL, `sb_publishable_…` key, `info@velariss.co`) appear verbatim in
assets served to every anonymous visitor. They are bundle-public by design;
committing them discloses nothing the site itself does not. Residual caveat:
key rotation now requires a CI edit too (drift risk, INFO), and the
publishable key's safety rests on RLS — which is the existing, separately
reviewed posture.

### 3.4 The crash-window close — SQL attacked, repair confirmed money-invisible

Migration 067 read whole and adversarially, alongside its dependencies:

- **The one-directional gap check is justified.** The claim that Σ coupon
  rows may legitimately exceed `orders.discount_cents` rests on
  `recompute_order_totals` capping the discount at the subtotal — verified:
  the current definition lives in **052** (`v_discount := least(greatest(
  v_flat + v_pct_used, 0), v_subtotal)`, line 93). Only `discount_cents >
  Σ rows` is treated as a mismatch. Correct.
- **The corroboration matches place-order's actual math.** 067 recomputes
  `round(percent/100.0 × max(unit_price_cents)) ±1¢`;
  `place-order/orderTotals.ts:164` computes `Math.round(maxUnit ×
  percent/100)`, then caps at the remaining subtotal. When that cap bit (a
  heavily discounted cart), the gap will be *smaller* than 067's expectation,
  corroboration fails, and the order lands in `uncorroborated` — **the
  conservative direction**: the repair declines rather than mislabels. A
  bounded false-negative in the repair path, never a wrong write.
- **The repair cannot change a customer-billed amount.** It inserts one
  `order_coupons` row whose `discount_cents` equals the order's own existing
  gap; `orders.discount_cents`, `total_cents`, and `invoice_amount_cents` are
  never touched. The effect is that invoices itemize a discount the customer
  already received, and a future `recompute_order_totals` no longer silently
  drops the reward — the exact failure the comment names.
- **States A/C/D are detect-only in code, not just in comments** — each path
  only appends to an array; the single `INSERT` is unreachable without
  voucher linkage + positive gap + ±1¢ corroboration + `p_repair`.
- **Disjointness holds where it matters.** A excludes voucher-linked orders
  (handled in the loop); D requires a reward row where B/C require its
  absence. One cosmetic overlap: an order with a reward row, a gap, and no
  used voucher lands in both A and D, double-counting in `mismatches` — both
  detect-only, so the worst case is a slightly inflated pager count. INFO.
- **Permissions/injection posture:** no dynamic SQL, typed boolean arg,
  `security definer` with `set search_path = public`, execute revoked from
  public/anon/authenticated. Verified **live**: a direct PostgREST RPC call
  with the publishable key → `42501 permission denied` (HTTP 401).
- **The public unauthenticated `p_repair=true` trigger:** the session's
  safety argument holds under attack — idempotency is real (`unique(order_id,
  code)` exists, migration 036 line 38, + `ON CONFLICT DO NOTHING`), the
  write is corroborated and money-invisible, the scan is 60-day bounded, and
  the response (`{ok,clean,repaired,ts}`) leaks no ids or amounts. The
  residue is load, not integrity: an unauthenticated GET that triggers a
  definer scan of 60 days of orders on every call, with no rate limit. A
  hostile caller can make the DB re-verify itself in a loop. LOW/INFO —
  bounded by the 60-day window and Supabase's own function throttling, but
  worth remembering if order volume grows.
- **The function + probe:** `reconcile/index.ts` is GET/HEAD-only (POST →
  405, verified live), `verify_jwt = false` documented in `config.toml`;
  `reconcilePlan.ts` fails loudly on RPC error or malformed summary (503,
  `clean:false`). One deliberate fail-open nuance: an `ok:true` summary with
  garbage counts (`mismatches: NaN/'many'`) sanitizes to 0 → `clean:true` —
  pinned in the tests as intended, only reachable if our own migration
  returns garbage. INFO. Live probe: `{"ok":true,"clean":true,"repaired":0}`.
  `uptime.yml`'s fourth step greps `"clean":true`; the dispatched run
  29648542273 passed all four steps in 4s.

**The honest grade of this item:** the crash window is *mitigated by
detection and bounded repair*, not eliminated — the sub-second gap between
order insert and voucher consume still exists, and a crash there still
produces a mismatch; what changed is that the mismatch now pages someone
within 15 minutes instead of persisting silently, and the one
deterministically safe state heals itself. For a Zelle-invoice shop, that is
a proportionate close. It does not retroactively exercise the winner path,
which remains prod-unexecuted.

### 3.5 Gates and CI at HEAD — all green, one wobble on record

`tsc -b` clean; `deno check` clean; **926 passed / 21 skipped** (claim: ~926
— exact); coverage 99.65/96.89/99.31/99.82 over thresholds 97/97/94/96;
`reconcilePlan.ts` inside the include at 100 S / 96 B; eslint 0 errors;
build reproducible. CI on HEAD green with both jobs; the push-1 CI failure
(e2e env, §3.3) was fixed within the hour and is the only red run. Uptime:
scheduled runs green through 13:50Z (still the old 2-probe file — scheduled
runs use main's copy, so the 4-probe version takes effect from the next
tick), plus the 4-probe dispatched run green at 14:42Z.

### 3.6 Live state — frozen at last-good, and last-good equals HEAD's src

`wrangler deployments list`: latest deployment **2026-07-18T14:38:08Z**
(push 1); nothing after, re-checked 25+ minutes post-push-2 against the
lane's five-for-five 56–110s history. The guard fail-closed the lane — the
lane's env still lacks `VITE_ZELLE_HANDLE`, proven by the live artifact
itself: the live payment chunk (`payment-DBItke3q.js`, fetched whole) bakes
an env object *without* `VITE_ZELLE_HANDLE`, falling through to the hardened
fallback — **`info@velariss.co` present, zero `[Set ` strings**. The live
Landing chunk (`Landing-BlDuBz3X.js`) contains `requestIdleCallback` — the
hero idle gate is live. And `git diff 6366e6a..5464bcd -- src/` is
**empty**: the three post-freeze commits touch only the guard, CI, docs, and
tests. Live source == HEAD source today.

Is "frozen at last-good" acceptable? As a stopgap, yes — it is strictly
better than every alternative the lane offered: live is content-correct,
provably matches HEAD's src, and cannot be overwritten by a broken build.
What breaks if the owner never acts: (a) the *next* src change never reaches
live via push — silent staleness, with no alarm (the uptime probe checks
correctness of what is serving, not freshness); (b) the lane burns a failed
build on every push, forever; (c) the deployment record stays `Source:
Unknown` — the live entry `index-Bs8QUbcJ.js` differs from the canonical
`index-L7sRG1Hu.js` only because the lane's env-less build routes the handle
through the fallback instead of baking the env var (content-equivalent on
the payment surface, verified byte-level), but that equivalence had to be
established by hand and will not hold for arbitrary future diffs. The manual
lane (`deploy.sh --frontend`) still works and — because the auto-lane now
fails — will no longer be overwritten 60 seconds later. The repo's
documented deploy model is, for the first time since 07-17, true again *in
effect*. It is still not a decision; it is a dead-man switch.

### 3.7 The hero idle gate — honest partial credit

`CompoundVisualizerFrame.tsx`: `ready` starts false (true when `expanded`),
set via `requestIdleCallback` with cleanup, `setTimeout(200ms)` fallback for
Safari, and the Expand button sets `ready` synchronously before `onExpand()`
— the user never waits on the gate. Pre-ready renders the same fallback the
Suspense boundary shows, so the gate is visually free. The four tests are
behavioral (captured-idle-callback stubbing, Safari deletion, bypass) with
the carousel mocked at the chunk seam so three.js never loads in tests.

Does this honestly address the carried perf finding? Partially, and the
claim was framed honestly: the finding's *bite* was 955KB contending with
landing first paint, and that contention is gone — the dynamic import now
fires in an idle slot after paint, verified present in the live chunk. But
the chunk is deferred, not shrunk: every landing visitor still downloads
255KB gz moments later, on mobile data too. The carried polish item narrows
to "split/shrink the three.js payload"; it does not close.

## 4. Findings this review (severity-ranked)

**#1 — MEDIUM (carried, reshaped): the auto-deploy lane is dead-manned, not
dealt with.** The guard converts the lane from "ships broken builds" to
"ships nothing" — verified empirically in both directions. But the lane
still exists, fires and fails on every push, is unowned and untagged, and
this review adds a new fact: **it deployed push 1 whose CI run was red**
(run 29648378635 failed at 14:37; the lane deployed at 14:38). Any future
decision to give the lane a full env must also confront that it ignores CI.
Owner decision required: kill it (manual model of record becomes true), or
adopt it (full env + CI gating + retire `deploy.sh --frontend` + update
`ci.yml`/`ROLLBACK.md`). Until then every push burns a failed build and no
push deploys — acceptable only as long as everyone remembers it.

**#2 — MEDIUM (carried, narrowed): the money orchestration is still executed
by zero tests.** `place-order/index.ts` (1,540 lines: auth, idempotency
replay, DB write sequencing, voucher claim ordering, rollback-on-race) is
deno-checked only; the other ~3,470 edge-function lines likewise; the RLS
suite still env-skips. The new E2E is real but deliberately ends at cart
totals. The unit surface is saturated and the client money path is E2E'd —
the remaining test risk is concentrated in exactly one file, and it is the
file that moves the money.

**#3 — INFO (carried): the reward-voucher winner path has never executed in
prod.** `clean:true` from the reconciler is consistent with "everything
healthy" and with "no voucher ever consumed." One test voucher through the
consume path (prod, owner-supervised) would retire this permanently; the
reconciler would now catch any fallout within 15 minutes, which makes the
exercise cheaper than it has ever been.

**#4 — INFO: reconciliation nits, none blocking.** (a) A/D state overlap can
double-count one order in `mismatches` (pager says 2, human finds 1); (b)
`asCount` sanitization means an `ok:true` RPC summary with garbage counts
reads clean — fail-open, reachable only if migration 067 itself regresses;
(c) the public probe has no rate limit on a definer scan (load, not
integrity); (d) the guard's failure direction is proven by my empirical run
but exercised by no CI step (CI only builds the passing direction).

**#5 — INFO: freshness is now the unwatched dimension.** The uptime probe
asserts the live payment surface is *correct* but nothing asserts it is
*current* — with the lane fail-closed, a future src fix that never gets
manually deployed would serve stale-but-green forever. Cheap close: a probe
step comparing the live entry hash against an expected value updated at
deploy time, or simply the owner acting on #1.

**#6 — INFO (carried): hero chunk deferred, not shrunk** (§3.7); wrangler
4.86 pin and the dependabot PR also carry.

## 5. Path forward (ordered, concrete)

1. **Owner: decide the lane** (#1) — kill it or adopt it (env + CI gate).
   Either resolution, plus one canonical `deploy.sh --frontend` run to put a
   provenance-known artifact live, closes the largest remaining non-code
   item. ~30 min + decision.
2. **Run the winner path once in prod** (#3) — one test voucher through
   checkout under supervision; the reconciler is the safety net. ~30 min.
3. **Test place-order/index.ts orchestration** (#2) — extract-and-test the
   write-sequencing/idempotency-replay spine the way priceCheck/orderTotals/
   rewardVoucher already were, or stand up a Deno test harness for the
   handler. This is the last named code-scope A item. ~1–2 days.
4. **Cheap hardening while there:** a CI step exercising the guard's failure
   direction (build with a var unset, assert non-zero — 5 lines); the
   freshness probe (#5); the A/D double-count dedupe if the pager ever
   confuses (#4a).
5. Carried polish: hero payload shrink/split, wrangler pin, dependabot PR.

Items 1–3 are the full A. Items 1–2 are hours, not days, and are the same
two items every review since the money-path wave has named. Nothing shipped
in this wave needs revisiting — every claim verified clean, several under
deliberately hostile reading.

---
*Verification footprint: read-only except this file. Ran `git log/diff/show/
rev-parse`; `npx tsc -b`; `DENO_NO_PACKAGE_JSON=1 deno check
supabase/functions/`; `npx vitest run --coverage` (+ a count-only re-run);
`npx eslint .`; `npm run build` (pass direction) and `VITE_ZELLE_HANDLE=""
npx vite build` (fail direction, exit 1); `PORT=5198 npx playwright test
tests/e2e/checkout-journey.spec.ts` (1 passed); an independent Node
re-derivation of the formula price; `gh run list` / `gh run view` (CI runs
29648484768 + failed 29648378635, uptime run 29648542273 with per-step
detail) / `gh repo view` (visibility); `supabase migration list` (067
synced); `supabase functions list` (reconcile ACTIVE v1, place-order v64);
`npx wrangler deployments list` ×2 (latest deploy 14:38:08Z, re-checked
25+ min after push 2); `curl` of the live HTML, live entry
`index-Bs8QUbcJ.js`, live `payment-DBItke3q.js` (read whole — real handle,
zero placeholders), live `Landing-BlDuBz3X.js` (idle gate present), the
reconcile probe (GET → clean:true; POST → 405), and a direct anon-key RPC
attempt (42501 denied). Read whole: viteEnvGuard.ts + tests, migration 067,
052's recompute cap, orderTotals.ts reward math, rewardVoucher.ts,
reconcile/index.ts + reconcilePlan.ts + tests, checkout-journey.spec.ts,
CompoundVisualizerFrame.tsx + tests, ci.yml, uptime.yml, payment.ts,
pricing.ts, shipping.ts, .env.example, config.toml, playwright.config.ts.
No order placed, no DB write, no deploy, no `lookup_order` call. The only
prod-touching calls were idempotent GET probes and one intentionally denied
RPC. No tracked file modified except this report.*
