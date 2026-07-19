# Pro review — A+ wave verdict (2026-07-18, night wave)

**Verdict: A — with Testing and Pricing & money integrity at A+.** Not a full
A+. The lineage: D → B- → B → B+ → A- (×3 held) → A → **A with two A+
domains**.

The full-A verdict (PRO_REVIEW_2026-07-18-full-a-verdict.md) named the A+
material in §4. This wave shipped **every code-scope item on that list**, and
the re-grade below was performed by an independent skeptical pass that
re-measured everything — coverage re-run, extraction diffs re-checked against
the pre-wave tree, CI runs and branch protection read back from the API, live
prod probed. **Zero mismatches between claims and measurements.**

State of record: main = live = **`e34391a`** (CI green: `checks` ✓ `e2e` ✓
`integration` ✓), DB at migration 067 (no new migrations), **all 14 edge
functions redeployed, place-order v66 ACTIVE**, live site 200 serving
`/assets/index-BjnlEAnl.js` (hash unchanged across the wave — byte-reproducible
build held), `/version.json` on the live origin reporting the deployed commit.

---

## 1. What this wave shipped (all independently verified)

### 1.1 Real-database integration tier — the money RPCs against actual SQL

`tests/integration/` (8 suites) drives validate_coupon, redeem_coupon,
consume_reward_voucher, reconcile_reward_vouchers, recompute_order_totals,
create_order_from_inquiry, and the 035 idempotency index against a REAL local
Supabase Postgres. These prove what the mock tier structurally cannot:

- **consume_reward_voucher under a genuine two-client concurrent race** —
  exactly one winner, voucher pinned to the winner's order, verified by DB
  re-read.
- redeem_coupon atomic last-use: the loser writes **zero rows**.
- The orders idempotency partial unique index actually raising **23505**.
- create_order_from_inquiry fail-closed: unpriced SKU → raise → **order row
  rolled back**, inquiry stays OPEN.
- validate_coupon: every rejection reason with exact buyer copy, Postgres
  rounding pinned to the cent (12345 × 10% → 1235), the full 057
  combinability matrix.
- recompute_order_totals: the 052 worked example, free-item offset, cap,
  member free shipping.

New CI job **`integration`** boots the stack in the runner (Docker exists
there; the Mac does not — local enablement documented in
docs/INTEGRATION_TESTS.md), installs **hosted-parity default privileges before
migrations** (the prod project carries the hosted platform's legacy wide-grant
baseline; the migrations' explicit revokes assume it — probed and reconstructed
2026-07-18), then applies the chain via `supabase migration up`. Result in CI:
**91/91 passed, zero skips**, with loud-fail env derivation so the job can
never silently self-skip green. Two replay landmines were defused en route:
021 needed a drop-before-recreate (016's 13-column lookup_order was only ever
removed from prod out-of-band during the exposure hotfix), and the coupon
seeds needed `defaultToNull:false` (the PostgREST bulk-insert NULL trap).

### 1.2 RLS suite in CI — the IDOR class closed

`tests/rls/moneyIsolation.test.ts`: anon and cross-customer reads blocked on
orders / order_lines / order_coupons / inquiries / reward_vouchers /
reward_ledger / customer_discounts / customer_profiles / coupons /
coupon_redemptions / affiliates; money-field writes and voucher forgery
rejected with state re-read; service-role-only RPCs denied to anon AND authed;
the anon `lookup_order` contract pinned as a **sorted-keys equality on exactly
its 7 declared columns** (the 016→018 lesson, now regression-locked in CI).
The portal RLS suite — written 2026-07-13 but never once executed (no local
Docker) — now runs green in CI too. Because the bootstrap restores prod's
permissive grant baseline first, every denial is proven against the world
where **RLS is the only defense** — the correct adversarial setup.

### 1.3 Every edge function is now shim + directly-tested handler

The 13 remaining functions got the place-order treatment: decision bodies
extracted **verbatim** (re-grade sampled three against `git show f7cb9da:`,
whitespace-insensitive diff — only imports/env-consts/factory wrapper differ)
into Deno-free `handler.ts` factories with injected seams, `index.ts` reduced
to dumb cold-start shims. **289 new orchestration tests** across three
harnesses pin: admin-gate and turnstile ordering, every validation rejection
with exact copy, token semantics on the public mark-payment-claimed endpoint
(31-char fail-closed boundary, no-leak redirect contract), the two public
probes' response-shape invariants ({ok,db,ts} / {ok,clean,repaired,ts} on
every path, mismatch ids provably absent), rate-limit windows, SSRF host
fences, HTML escaping, and email payloads. Eighteen fresh quirks were pinned
as current behavior and documented in the suite comments (gate-before-method
401s, send-delivered's missing env guards, send-inquiry's case-sensitive rate
bucket, the dead ship-to email block, and more) — a follow-up menu, not
defects fixed silently.

### 1.4 The four pinned quirks from the A verdict — closed

1. **Orphan inquiry on the losing 23505 race: FIXED** — the loser deletes
   exactly the inquiry row it created; delete failure is non-fatal + alerted
   (`race_inquiry_cleanup`).
2. **Success telemetry un-gated: FIXED** — "Order placed" logs whenever the
   checkout itself succeeds, independent of email outcomes.
3. **p_applied_codes live reference: FIXED** — defensive copy per call,
   snapshot pinned by test.
4. **invoiceEmailSent optimism: DOCUMENTED, not fixed** — nothing persisted
   knows the real outcome; honesty requires a schema column (out of scope by
   design; commented at both sites).

Handler branch residue worked 88.3% → **96.03%**; the 16 remaining legs are
individually justified unreachable-defensive fallbacks. Money math bit-for-bit
unchanged — every pre-existing money assertion passes unmodified.

### 1.5 Release provenance + gates

`/version.json` (commit, shortCommit, branch, source, buildTime) is emitted at
build and served by the live origin; `<meta name="release">` stamps the HTML.
Hashed assets stayed **byte-identical** (verified across consecutive builds
and against the live bundle) — the stamp lives outside the fingerprinted
files, so hash-comparison provenance checks still work. Coverage ratchet
raised **98/97.5/94/97 → 99/98.5/95.5/98.5** (measured floor 99.77 L / 99.24 S
/ 96.32 B / 99.29 F across 1,353 tests; uniform ~0.8-point margin — deliberate,
not razor-thin). Branch protection now requires **all three** contexts
(`checks`, `e2e`, `integration`), strict, read back from the API.

---

## 2. Scorecard (11 domains)

| # | Domain | Prev | NOW | Δ | One-line justification (measured) |
|---|--------|:---:|:---:|:---:|---|
| 1 | Pricing & money integrity | A | **A+** | +0.5 | Every layer proven: mock orchestration (exact cents), real-Postgres atomicity/races (voucher exactly-one-winner, 23505, conversion rollback), RLS, live probes, reconcile clean in prod. Remainder is owner-scope live-fire only. |
| 2 | Security & authz | A- | **A** | +0.5 | Money/PII RLS + service-role-only RPC rejection + the 7-column lookup contract now execute in CI against real Postgres under prod-parity grants; portal suite runs at last. Not A+: no external pentest; grant parity is reconstruction, not read-back; `any` seams. |
| 3 | Data integrity | A- | **A** | +0.5 | The constraints the money path rests on (035, 064, 061) proven against real Postgres incl. concurrency; orphan-inquiry fixed with alert-on-failure. Not A+: forward-fix-only DB posture; invoiceEmailSent honesty needs schema. |
| 4 | Testing | A | **A+** | +0.5 | All three named A+ items shipped and verified: real-DB tier hard-gated in CI (91/91, loud-fail), RLS in CI, every deployed decision body under direct test (verbatim-checked); 1,353 tests, raised uniform-margin ratchet. |
| 5 | CI/CD & release hygiene | A- | **A** | +0.5 | Three required strict contexts (API read-back); provenance verifiable end-to-end (live commit == HEAD, byte-identical bundle). Not A+: this very release deployed 53s before its own CI went green; lane metadata still untagged. |
| 6 | Dependencies | B | **B** | 0 | Unmoved: 0 prod vulns, but 22 outdated incl. majors (eslint 10, Tailwind 4, TS 7) and no currency policy; dependabot merges now hard-gated at least. |
| 7 | Performance | B+ | **B+** | 0 | Untouched; bundle hash byte-identical. |
| 8 | Accessibility | B+ | **B+** | 0 | Untouched. |
| 9 | Frontend quality | B | **B** | 0 | Untouched (only the release meta injection). |
| 10 | Observability | A | **A** | 0 | Success-log blind spot closed, every alert stage test-pinned, release stamp live. Not A+: pager is grep+email; no metrics/retention story. |
| 11 | `video/` workspace | B+ | **B+** | 0 | Untouched. |

Five rows up, none down, two domains at A+, nothing below B, no open
HIGH/MEDIUM finding.

## 3. Why A-with-two-A+-domains, honestly

This wave did what it said, verbatim — the verbatim part was checked with
diffs, not trust. The two domains that define this business — the money path
and the test system that guards it — are now A+ on evidence: the semantics
mocks structurally cannot prove (row-lock races, 23505, RLS under prod-parity
grants) are proven in CI against real Postgres, and the assertions are the
deep kind, down to sorted column keys and half-away-from-zero cents. But A+
for the *system* requires near-flawless evidence across the board, and the
board still carries a B-tier frontend/dependency/performance flank that no
wave has moved since spring, a deploy lane that demonstrably shipped this very
release 53 seconds before its own CI went green, and a flagship discount that
has never once won in production. That is an A system with two A+ domains and
a short, honest list — not an A+ system.

## 4. What separates the system from A+ (exact, scoped)

**Owner-scope (operational):**
1. Live-fire one real reward-voucher **win** order in prod (semantics now
   proven against real Postgres; prod occurrence count is still zero).
2. The direct-push deploy window — re-confirmed open this wave (deploy 53s
   ahead of `integration` green): gate the Workers lane on CI / flip
   `enforce_admins`, or keep it as the standing documented tradeoff.
3. Workers deploy-lane tagging (`/version.json` mitigates; the lane's own
   metadata still reads `Source: Unknown`).
4. Production track record over calendar time; load testing has never run.
5. A dependency currency policy (the majors backlog).

**Code-scope (small, named):**
6. The 14 Deno shims execute only under `deno check` — the wiring layer is
   the one remaining untested surface (dumb by design; wiring bugs are
   prod-only).
7. One-time read-back of prod's actual default privileges to convert the
   hosted-parity bootstrap from reconstruction to fact.
8. Type-tighten the `any`-typed injection seams; `version.json` branch reads
   "HEAD" on the auto-lane; invoiceEmailSent honesty needs a schema column
   (068+ candidate).
9. The five untouched domains (Dependencies B, Frontend B,
   Performance/Accessibility/video B+) each need their own measured wave — a
   system isn't A+ while half its scorecard sits at B/B+.

— Re-graded against live state 2026-07-18 by an independent skeptical
principal-engineer pass; every number in this doc was re-measured, not
carried forward. Zero discrepancies found between the wave's claims and the
measurements.
