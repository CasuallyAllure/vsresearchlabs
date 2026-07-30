# Membership Execution Strategy — Remaining Roadmap (Phases 3 → 5)

**Status:** EXECUTED — this strategy governed Trains 1–3, all shipped (main history: PRs #25/#27/#28/#29/#30/#31 + the stabilization pass). Retained as the record of the execution model.
**Date:** 2026-07-28 · **Baseline:** Phases 0–2 merged & deployed (`main` = `b9cdf96`, migrations 070–073 applied).
**Companions:** `MEMBERSHIP_BLUEPRINT.md` (what to build) · `MEMBERSHIP_DATA_LAYER.md` (server map) · `docs/PHASE6_PROMOTIONS_BLUEPRINT.md` in the compliance track (copy-register authority for promo/loyalty surfaces).

---

## 0. Ground rules carried forward (non-negotiable)

1. **Lens, never a second store.** All remaining phases read/extend the existing customer/reward/discount records.
2. **Money-path changes are atomic:** any change to `effective_customer_discount()` ships in ONE PR with `accountDiscount.ts` + `memberPricing.ts` + `coupons.ts` mirrors and place-order + DB-tier tests.
3. **Shared repo tree belongs to the compliance session.** All membership work happens in isolated worktrees; the orchestrator never switches the shared tree's branch.
4. **Merges serialize.** Every PR lands as `main + 1` (rebase-then-merge, never force). `main` auto-deploys the frontend; DB pushes are explicit orchestrator actions.
5. **Migration numbers are pre-allocated** (see §2 registry) — the compliance track is presentation-only and writes no migrations, so membership owns 074+, but the orchestrator re-verifies before every push.
6. **Copy register:** all customer-facing membership copy is written under `PRODUCT_IDENTITY_STANDARD.md` / the Phase 1/2/5 research-supply register. Membership owns its copy (Phase 6 §10.4 default); early-access and customer-facing referral copy additionally get an explicit compliance pass before deploy (Phase 6 §10.5/§10.6 flags).

---

## 1. Dependency graph — remaining work

```
DONE: P0 (data layer) ─ P1 (control center + writable panels) ─ P2 (redemptions/invites/export)
                                        │
        ┌───────────────────────────────┼──────────────────────────────┐
        ▼                               ▼                              ▼
  WS-A Pricing core (074)        WS-C Vault + library          WS-F Consent + email_log (075)
  tier-aware 15/20 floor         (3b, content+UI, indep.)      (P4 gate for ALL sends)
  + mirrors + tests [MONEY]             │                              │
        │                        WS-D Reorder + priority               ▼
        ▼                        badge (3b, indep.)             WS-G Automation engine
  WS-B Portal tier                      │                       (edge fn + cron, ships DARK)
  presentation (3/3b)            WS-E Early access                     │
  [soft-dep on A for            (3b, needs D2 compliance         ┌─────┴─────┐
   accurate 20% display]         pass on visibility copy]        ▼           ▼
        │                                                  WS-H Kinds+templates   WS-I Automations
        │                                                  (incl. auto-Pro ⇐ A,D1)  admin sub-view
        └────────────────────────► deploy trains ◄───────────────┘
                                        │
                                        ▼
                              WS-J Referrals (076, P5)
                              [rails exist; customer-facing copy ⇐ D2]

  DEFERRED: WS-K cohort charts (n too small) · PARKED: WS-L subscribe-and-save (Zelle-only rails)
```

**Hard dependencies:** F→G→(H,I) · A→auto-Pro kind (in H) · D1→progress-gauge + auto-Pro thresholds.
**Soft dependencies:** A→B (display accuracy) · D2→E and →J's customer-facing copy.
**Fully independent of everything:** C, D. **Independent of each other:** the A track, the C/D ecosystem track, and the F/G automation track share no files → safe to build in parallel.

---

## 2. Migration & file-ownership registry (collision prevention)

| Number | Owner workstream | Contents |
|---|---|---|
| **074** | WS-A | tier-aware floor in `effective_customer_discount()` (member 15 / pro 20) |
| **075** | WS-F | `customer_profiles.marketing_opt_out` + `email_log` (unique (user_id, kind, period_key)) |
| **076** | WS-J | referral codes on coupon/affiliate rails |

File-ownership map (no two concurrent agents touch the same file):
- **WS-A:** `supabase/migrations/074*`, `src/lib/accountDiscount.ts`, `src/lib/memberPricing.ts`, `src/lib/coupons.ts`, place-order tests, DB-tier test.
- **WS-B/C/D/E (ecosystem agent):** `src/pages/account/**`, `src/components/account/**`, `src/config/tierBenefits.ts` (new), catalog visibility flags (E only), member-facing content surfaces.
- **WS-F/G/H/I (automation agent):** `supabase/migrations/075*`, `supabase/functions/member-automations/**` (new), `.github/workflows/` (one new scheduled workflow), `AccountProfile` opt-out toggle, `src/pages/admin/members/AutomationsView.tsx` (new sub-view file; one-line tab addition to `AdminMembers.tsx` is an orchestrator-applied patch at merge time to avoid cross-agent conflict).
- **WS-J (growth agent):** `supabase/migrations/076*`, referral portal card, admin referral surface.

---

## 3. Agent roster & responsibilities

| Agent | Role | Inputs | Outputs |
|---|---|---|---|
| **Orchestrator** (main context) | Sequencing, migration registry, merge decisions, rebases, deploy trains, DB pushes, prod smoke tests, owner reports. Never delegates merges. | Approved strategy + blueprints | PRs merged in order; deploy-train reports |
| **pricing-core** (builder, own worktree) | WS-A only — the money path, atomic | Blueprint §7, mirror-trap rules | 1 PR: 074 + mirrors + tests |
| **ecosystem** (builder, own worktree) | WS-B → D → C → E in sequence | Blueprint §1b/§4, tier config pattern, register authority docs | 2–3 PRs (B+D fast; C larger; E after D2) |
| **automation** (builder, own worktree) | WS-F → G → H → I in sequence | Blueprint §12, uptime.yml cron pattern, emailBrand module | 2 PRs (F+G engine; H+I kinds+view), all kinds DISABLED |
| **growth** (builder, spun up after T2) | WS-J | Blueprint §9/§13, coupons/affiliate rails (031) | 1 PR: 076 + surfaces |
| **Reviewers** (per PR) | `code-reviewer` + `security-reviewer`; `database-reviewer` on any migration PR | The PR diff | CRITICAL/HIGH findings must be resolved pre-merge |
| **CI** (hard gate) | `checks` + `e2e` + `integration` (real Postgres) | every push | must be green pre-merge |

**Concurrency cap: 2 builder agents at a time.** Merges serialize anyway (every PR must be `main+1`), the worktrees share a `node_modules` symlink (no parallel dependency changes), and review bandwidth in the main context is the real bottleneck. A third concurrent builder adds rebase churn, not speed.

## 4. Merge order & validation gates

**Merge order (strict):** A → B+D → C → F+G → H+I → E → J.

Per-PR gates (all automatic, no owner stop): tsc/lint/unit/build local → reviewer agents (fix CRITICAL/HIGH) → CI incl. real-Postgres tier → orchestrator rebase check (`main+1`).
Integration testing: every migration PR carries DB-tier tests (the 073 pattern); automation engine gets an idempotency DB-tier test (email_log unique constraint under concurrent send).
Architectural reviews: one at T2 boundary (before the automation engine merges — cron + secret + dark-launch posture) and one before J (referral rails reuse).

**Deploy trains (the only merge/deploy owner stops):**
- **Train 1:** A + B + D — pricing core + portal presentation + quick ecosystem wins. Deploy = merge + `db push` (074) + smoke.
- **Train 2:** C + F + G + H + I — vault/library + full automation stack **dark** (opt-out live, zero sends enabled). Deploy = merge + `db push` (075) + smoke.
- **Train 3:** E + J + owner flips automation kinds ON per template review. Deploy = merge + `db push` (076) + smoke.

## 5. Stop-condition policy (as directed)

Execution stops ONLY for: (1) true owner/business decision not covered here or by the blueprint; (2) legal/compliance decision; (3) production merge/deploy approval (= the 3 trains); (4) missing blueprint; (5) hard dependency block; (6) unresolvable verification-gate failure. **Phase completion is not a stop.** Between stops, the orchestrator proceeds continuously through build → review → CI → next workstream.

## 6. Owner decisions — batched NOW so they never block later

- **D1 — Pro gate number.** Data is too thin (n=2) for percentile gates. Recommendation: ship Phase 3 *without* the progress-to-Pro gauge; grant Pro manually; set a provisional gate only when auto-Pro is enabled in Train 3, revisiting `admin_member_spend_distribution()` then.
- **D2 — Compliance register pass.** Membership owns its copy (per Phase 6 §10.4) written under the research-supply register; early-access (E) and customer-facing referral copy (J) get an explicit compliance-register pass before their train deploys. (Phase 6 §10.6 assumed affiliates stay admin-only — J makes referral copy customer-facing, so this pass is genuinely required.)
- **D3 — Automation sends.** Everything ships dark: templates visible in the Automations sub-view, every kind OFF. Owner reviews copy in-app and flips kinds individually. This *is* the email-copy approval mechanism — no separate checkpoint.
- **D4 — Scope confirmation.** Park subscribe-and-save (Zelle-only rails) and defer cohort charts (meaningless at current n); auto-Pro + welcome sequence fold into the Phase 4 engine, so Phase 5 reduces to referrals.

## 7. Risk register (abridged — full reasoning in chat deliverable)

| Risk | Mitigation |
|---|---|
| Money-path mirror drift (074) | Atomic PR, mirror files enumerated in §2, place-order + DB-tier tests, database-reviewer |
| Automation double-sends | `email_log` unique (user_id, kind, period_key); DB-tier idempotency test; kinds individually toggleable; dark launch |
| Shared-tree collision with compliance session | Worktrees only; orchestrator never checks out shared tree; pre-push `git status` + migration-list checks |
| Migration number collision | §2 registry; compliance track writes no migrations (its §11 forbids them) |
| Copy-register regression (the compliance track's whole purpose) | §0.6 register rule; D2 passes on E/J; Phase 6 owns nothing in membership but its notes are input |
| Locked-layout drift | Sub-views additive only; roster markup untouched; 375px check per train |
| Duplicate systems | Referrals ride coupons+affiliate rails (031); welcome ≠ auth-confirmation email (one send, benefits orientation); no new stores |
| Tech debt carried | reconcile "clean" badge (deferred, small); targeted roster-row refresh (accepted); CLI version nag; worktree link-state copy for db push is manual by design |

---

*Approved ⇒ this document governs execution through the end of Phase 5. The orchestrator reports once per deploy train and at any stop-condition event.*
