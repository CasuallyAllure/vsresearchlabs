# Pro review — full-A verdict (2026-07-18, evening wave)

**Verdict: A.** The lineage's first full A: D → B- → B → B+ → A- (×3 held) → **A**.

The prior review (PRO_REVIEW_2026-07-18-a-closure.md) held A- and reduced the
remainder to one sentence: *lane ownership (owner-scope) + place-order
orchestration tests / winner path (code-scope)*. This wave closed the entire
code-scope remainder and converted the owner-scope item from an unmanaged hole
into an explicit, documented, merge-gated operator tradeoff. Every claim below
was verified against the live state this session, not taken from the diff.

State of record: main = `9a41fe4` (CI run green: `checks` ✓, `e2e` ✓),
DB at migration 067, **place-order v65 ACTIVE**, live site 200 serving
`/assets/index-BjnlEAnl.js` (hash unchanged across the push — the build is
byte-reproducible and no frontend source changed).

---

## 1. What this wave shipped (all verified)

### 1.1 Branch protection on `main` — ACTIVE

Verified by API read-back (`gh api repos/CasuallyAllure/vsresearchlabs/branches/main/protection`):

```json
{"strict": true, "contexts": ["checks", "e2e"], "enforce_admins": false,
 "conversation_resolution": true, "force_pushes": false, "deletions": false,
 "approvals": 0}
```

Every PR — dependabot included — now requires BOTH CI jobs green on an
up-to-date branch plus conversation resolution before merge. `enforce_admins`
is deliberately false: the solo operator keeps the direct-push hatch
(documented in ROLLBACK.md §branch-protection). This is the exact configuration
of record from ROLLBACK.md, applied with a JSON `--input` body (the doc's old
`-f restrictions=null` form would have sent the string `"null"`).

### 1.2 The checkout orchestration is no longer executed by zero tests

The last code-scope A-blocker. `place-order/index.ts` (1,528 lines, the
entire money orchestration, previously covered by `deno check` alone) was
extracted **verbatim** into `handler.ts` — a Deno-free
`createOrderHandler(cfg, deps)` factory with every runtime seam injected
(supabase `createClient`, Resend `fetch`, turnstile, telemetry, CORS).
Behavior preservation was verified structurally, not asserted: a diff of the
old `index.ts` against `handler.ts` shows the whole decision body
byte-identical — the only changes are the header, imports, the factory
wrapper, and config indirection that rebinds the same identifier names.
`index.ts` is now a ~60-line Deno shim (env reads + `Deno.serve`) with no
decisions in it.

Six orchestration suites (99 tests, `tests/unit/placeOrderHandler.*.test.ts`)
drive the REAL handler offline through a scriptable supabase mock
(`tests/helpers/placeOrderHarness.ts`), asserting on observable behavior only
(responses, recorded queries/RPC args, captured emails/alerts):

| Suite | Pins |
|---|---|
| request | method/env gates, invalid JSON, turnstile 403, validation hand-off, idempotency short-circuit, rate-limit 429 + LIKE-escape, full happy guest checkout (rows + both emails + exact totals) |
| pricing | P0-1 fail-closed price authority: catalog-read 503, mismatch/zero/unknown/dose-unresolved 409s with exact buyer copy, malformed-sku containment out of `.in()`, formula-priced lines proceed UNVERIFIED with order_events + ⚠-flagged business email |
| member | P0-5: session-only member resolution (typed contact ≠ account email still member-priced), anon-key bearer rejected without a getUser call, getUser error/throw → guest, account-discount RPC contract incl. bounds, reward voucher claim **win** and **lose** with rollback re-persist + alert stages |
| promos | wholesale case pricing + "final price" exclusivity (codes → 400, account/reward/B2G1 suppressed, fast forced off), bundle 20%/pair + exclusivity, B2G1 live/expired/excluded/read-error, coupon validate 502/400/members-only, percent-after-flat re-scaling math, free_item append vs free-existing-unit, redemption-race rollback (survivor repricing, free-line delete, coupon_rollback alert) |
| persistence | inquiry/order insert 502s + alert stages, the 23505 idempotency insert race (stateful two-lookup pin), order_lines/coupon-row failures non-fatal, buyer re-read/send/throw failures alerting while checkout stays 200, exact success-response key contract |
| emails | brand-stamp vs text mark, 24HR/Standard tags + split-shipment notice, ship-to block presence/absence, organization/notes rows, HTML escaping of buyer-controlled fields, payment-code block |

**Coverage (measured, 1,018 passing / 21 skipped):** whole gated surface
**99.86% lines / 99.50% statements / 94.70% branches / 99.39% functions**;
`handler.ts` itself **100% lines / 100% functions / 98.89% statements /
88.3% branches** — the branch residue is `??` fallbacks on defensive
defaults, individually inspected. The CI ratchet was RAISED: lines 97→**98**,
statements 97→**97.5**, functions 96→**97** (branches hold at 94; the floor
is 94.70 and a 0.3-point margin is the razor-thin brittleness this lineage
already rejected once). All five gates green locally and in CI on `9a41fe4`.

### 1.3 place-order v65 deployed + probed

The extraction changes the deployed function's source (same behavior), so the
function was redeployed (v64 → **v65 ACTIVE**, verified via
`supabase functions list`) and probed live with side-effect-free requests:
OPTIONS → 204 with CORS; malformed JSON POST → 400 `"Invalid JSON body."`;
empty POST → 403 `"Missing verification token."` (Turnstile gate fires first —
the secret is set in prod; matches the tested gate order). No migration was
needed; deploy order (CI green → function deploy → probe) followed
ROLLBACK.md.

### 1.4 Fresh latent findings (pinned as current behavior, not fixed)

The suites surfaced and PINNED four quirks worth knowing:
1. The losing side of the 23505 idempotency race leaves its own orphan
   REVIEWING inquiry row (no order attached).
2. Duplicate responses report `invoiceEmailSent` optimistically ("sent on the
   original attempt" is assumed, not checked).
3. "Order placed" success telemetry only logs when the business email
   succeeds — a buyer-invoice-only success is alert-visible but not
   success-logged.
4. `p_applied_codes` is passed to `validate_coupon` as a live array reference
   (harmless against real Postgres, a footgun for arg-retaining telemetry).

None is a money-integrity defect; all are now regression-locked.

---

## 2. Scorecard (11 domains)

| # | Domain | Prev | NOW | Δ | One-line justification |
|---|--------|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | A- | **A** | +0.5 | Both named blockers closed: the orchestration that computes every charged cent is now directly executed by 99 behavioral tests (fail-closed price gate, exclusivity, rollback repricing, claim win/lose all pinned to exact cents). Remaining: one live-fire voucher-win order in prod — operational, owner-scope. |
| 2 | Security & authz | A- | **A-** | 0 | Held. The auth gates are now directly tested (anon-key bearer, session-only membership, members-only codes, HTML escaping) and merges are CI-gated, but the surface itself didn't change; RLS suite still Docker-skipped. |
| 3 | Data integrity | A- | **A-** | 0 | Held. Every rollback/race branch is now regression-locked (23505 race, redemption rollback, reward rollback + alert stages); the crash-window reconciliation from the prior wave stands. Orphan-inquiry quirk newly documented, not yet cleaned up. |
| 4 | Testing | A- | **A** | +0.5 | The named not-A reason ("place-order/index.ts executed by nothing") is gone: handler at 100% lines via a real orchestration layer, ratchet raised to 98/97.5/94/97, 1,018 tests. Remaining for A+: sibling edge fns, RLS-in-CI, mock-vs-real RPC depth. |
| 5 | CI/CD & release hygiene | B+ | **A-** | +0.5 | The merge path is now hard-gated (checks+e2e strict + conversation resolution, no force-push/deletions, verified by API read-back) and the hatch is a documented decision rather than an accident. Not A: direct pushes still auto-deploy ~90s ahead of CI by owner choice, and deploys remain untagged. |
| 6 | Dependencies | B | **B** | 0 | Untouched; dependabot PRs now at least have a real merge gate. |
| 7 | Performance | B+ | **B+** | 0 | Untouched this wave. |
| 8 | Accessibility | B+ | **B+** | 0 | Untouched this wave. |
| 9 | Frontend quality | B | **B** | 0 | Untouched this wave (bundle hash unchanged — byte-reproducible build confirmed live). |
| 10 | Observability | A | **A** | 0 | Held. Every alertOperator stage in the money path is now test-pinned (stage names + ctx payloads), so telemetry can't silently rot; the business-email-gated success log is documented. |
| 11 | `video/` workspace | B+ | **B+** | 0 | Untouched. |

Three rows up, none down, nothing below B, no open HIGH/MEDIUM finding.

## 3. Why A, honestly

The A- was held three times because named blockers retained live remainders.
Those blockers are now, verifiably: **orchestration tests** — closed (this
wave's whole point, 100% line coverage on the extracted handler, verified
byte-identical); **winner path** — the code path is executed under test with
exact money assertions (claim win AND lose); what has never happened is a real
voucher win in production, which is a 5-minute owner action, not code;
**lane ownership** — the merge path is now protected and the direct-push
window is an explicit, documented solo-operator tradeoff (`enforce_admins:
false` chosen, not defaulted), defense-in-depth behind it (env-guard
fail-closed builds, e2e money assertions, content-asserting uptime probes,
15-min reconciliation, documented rollback verbs).

A grade is for the state of the system, not the ceremony around it: the money
path is fail-closed, reconciled, alarmed, and now regression-locked end to
end. That is an A system with named A+ work, not an A- system with excuses.

## 4. What remains (exact, scoped)

**Owner-scope (operational):**
1. Live-fire one real reward-voucher **win** order in prod and watch it settle
   (the last "never executed in prod" item).
2. Decide the direct-push deploy window: keep it (it is now documented as the
   accepted tradeoff) or route all changes through PRs and flip
   `enforce_admins` on.
3. Deploy provenance: Workers deploys still say `Source: Unknown` — tag them.

**Code-scope (A+ material, no A impact):**
4. Orchestration-style suites for the sibling edge fns (send-order-invoice,
   reconcile handler, notification fns) — the harness pattern now exists.
5. RLS suite into CI (needs Docker in the runner) — the one skipped file.
6. Handler branch residue (88.3% → the `??` fallbacks) and a real-Postgres
   integration tier for validate_coupon/redeem_coupon semantics.
7. Clean up the 23505 orphan-inquiry quirk (or document it as intended
   history).

— Reviewed against live state 2026-07-18 by the session's skeptical
principal-engineer pass; every number in this doc was re-measured, not
carried forward.
