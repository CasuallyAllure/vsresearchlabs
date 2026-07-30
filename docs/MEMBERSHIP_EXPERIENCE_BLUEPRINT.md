# Membership Experience Blueprint — Post-Freeze Refinement (UI ↔ Backend Synergy)

**Status:** APPROVED FOR EXECUTION (owner, 2026-07-30). Governs the next membership work cycle.
**Baseline:** the frozen membership program (`MEMBERSHIP_RELEASE.md` is the as-built record; main ≥ `b4ef111`). Migrations 070–076 live. **Next free migration: 077.**
**Prime directive:** shrink the distance between a fact changing in the database and a human seeing it — without the UI ever holding a fact of its own. And on design: **instrument, not boutique.**

---

## Design direction (owner's words, translated)
The portal currently reads like a consumer-retail app ("big pills… Abercrombie & Fitch… looking at stuff") rather than a serious research-supply account console. Most traffic is **mobile**. Target register:

- **Compact & data-forward.** Dense tabular rows, mono/tabular figures, hairline dividers — the existing *admin Members* idiom (`members/ui.tsx` SubNav/Tile/rows) is the reference register, not the boutique card spreads.
- **Quiet controls.** Replace oversized pill strips/buttons on the portal with the compact segmented-control + quiet-row-action grammar already proven in the admin (SubNav / RowAction). Buttons default `sm`.
- **Keep the tokens.** Glass surfaces, gold accent, lab theme, category colors stay — this is a density/seriousness pass, NOT a re-skin. `docs/DESIGN_2026_BLUEPRINT.md` still governs; "institutional ≠ visually dead" still applies.
- **Mobile-first:** design at 375–430px first; ≤430px gets reduced decorative padding, no horizontal scroll, thumb-reachable actions, visible tab overflow affordance.

## Workstreams (with executor model tiers — conserve tokens)

| WS | What | Files/objects | Tier | Gate |
|---|---|---|---|---|
| **WS-1 Portal data layer** | One auth/profile provider at the portal root + stale-while-revalidate cache for profile/rewards/orders — kill the per-page refetch (each portal page currently re-runs getSession+loadMyProfile). Reuse/extend `src/lib/authPresence.ts` thinking; consider a light query-cache, no heavy dependency without need. | `AccountLayout`, `customerAuth`, portal pages | **Sonnet** build · **Opus-tier review** (auth) | tests + no behavior change to auth flows |
| **WS-2 URL-addressable admin state** | `view/segment/sort/search` → `useSearchParams` on `/admin/members`; queue deep-links + automation emails can link straight to filtered views; back/bookmark/share work. | `AdminMembers.tsx` | **Haiku** (mechanical) · Sonnet review | existing behavior identical when params absent |
| **WS-3 Early-access admin control** | Migration **077**: `product_flags` (sku pk, early_access bool, updated_by/at) + `admin_set_product_flag` (is_admin, audited) + admin-readable select; catalog gate reads the flag (keep the tag as OR-fallback); per-SKU toggle in the existing Inventory admin editor. Kills the last code-file switch. | 077, `earlyAccess.ts`, AdminInventory | **Sonnet** build · **database-reviewer + security-reviewer** | DB-tier tests in CI; ships with zero flags set |
| **WS-4 Generated DB types in CI** | `supabase gen types typescript` committed + a CI step that regenerates and fails on diff — schema↔client drift becomes impossible by construction. | CI workflow, `src/types/supabase.ts` | **Sonnet** | CI green on clean repo |
| **WS-5 Mobile register pass** | The design workstream. AccountLayout PillTabs → compact segmented strip (admin SubNav grammar, w/ overflow affordance); portal cards → denser instrument rows (Overview, Rewards, Benefits, Library, order detail); button-size audit (`sm` default on portal); ≤430px padding scale-down. NO token/color changes, NO new visual language. Read `docs/DESIGN_2026_BLUEPRINT.md` + repo design skills first. | `src/pages/account/**`, `src/components/account/**`, `PillTabs` (portal usage only — check other consumers before touching the shared component; fork-lite via props, don't break admin) | **Sonnet** build | **OWNER VISUAL APPROVAL before merge** (screenshots/preview at 375px + desktop, light+dark) — design taste is an owner gate |
| **WS-6 Events + in-portal notices** *(DEFERRED — revisit ≥~30 members)* | Outbox/events table written at mutation time → in-portal notification feed (reuse automation copy), Supabase Realtime for live admin roster, later phone push. Needs its own design doc first. | — | — | blocked: scale + design doc |

**Deploy trains:** T1 = WS-1+2+4 (no migration, low risk) → T2 = WS-3 (077) + WS-5 (owner visual gate). WS-6 not scheduled.

## Standing constraints (unchanged from the frozen program — violations = rework)
1. Lens, never a second store; server-side truth only; single audited write paths.
2. Money path untouchable here — any `effective_customer_discount()` change = atomic PR w/ `memberPricing`/`accountDiscount`/`coupons` mirrors + place-order & DB-tier tests (no WS above touches it).
3. Members admin **layout is locked**; WS-2 changes state plumbing only.
4. No native dialogs (iOS) — ConfirmModal only. Leaf-component auth = `authPresence`, never `useCustomerAuth` (per-instance fetch trap).
5. Coverage ratchet 99/98.5/98.5/95.5 — new modules ship WITH tests; never lower the ratchet.
6. CI gates: checks + e2e + real-Postgres integration; migrations forward-fix only; `db push`/fn deploys are manual, `main` auto-deploys frontend un-gated.
7. Shared repo tree may belong to another session — work in worktrees (`vsrl-membership-p1` exists), commit explicit paths, never stash/`add -A`; exclude `.codex/`, `AGENTS.md`, `Social Media/`.
8. Copy register: research-supply voice (PRODUCT_IDENTITY_STANDARD / Phase-6 authority); portal reward vocabulary is "units".
9. Migration registry: **077 = WS-3**; verify `supabase migration list` before any push.

## Execution model (token-conscious)
- **Orchestrator** (main context): sequencing, merges (`main+1`, never force), DB pushes, smoke tests, owner reports. Keeps decisions; delegates all file-heavy work.
- **Builders:** Haiku for mechanical/codemod work (WS-2), Sonnet for feature work (WS-1/3/4/5). One worktree per concurrent builder; max 2 concurrent; builders never commit.
- **Reviewers:** code-reviewer per PR; +security/database on WS-3; Opus-tier judgment reserved for auth (WS-1) and anything money-adjacent.
- **Stops:** owner decisions not covered here · WS-5 visual approval · production deploy approvals (per train) · unresolvable gate failures. Phase completion is NOT a stop.
- **Per-train report:** workstreams, commits/PRs, CI, reviewer results, risks, remaining roadmap — one message.
