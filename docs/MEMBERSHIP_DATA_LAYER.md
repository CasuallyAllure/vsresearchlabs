# Membership Data Layer — Architectural Map

**Status:** Phase 0 built 2026-07-23 — migration files + edge change + tests written, **not yet applied to prod** (`supabase db push` + `supabase functions deploy` are manual; CI's real-Postgres tier is the gate). Local DB validation was not possible in the authoring environment (no Docker); the integration suite runs in CI.

This is the complete map of every server-side object the membership system adds. Companion: [MEMBERSHIP_BLUEPRINT.md](MEMBERSHIP_BLUEPRINT.md) (the phased plan) and `src/pages/admin/membersView.ts` (the client view-model contract).

## First principles (enforced here)
- **A lens, never a second store.** Every object reads the existing `customers`, `customer_profiles`, `orders`, `reward_ledger`, `reward_vouchers`, `customer_discounts`, `audit_log` records. Nothing here owns customer, reward, or discount state. The Customers section / CRM remain the source of truth.
- **No duplicated business logic.** Discount math comes from the canonical `effective_customer_discount()` (069). Points come from the real `reward_ledger`. Per-member aggregation lives in ONE view (`member_roster_base`) that every read function reuses.
- **Server-side truth only.** Every statistic is computed in Postgres. No client estimation (the old `floor($paid/100)` projection is retired).
- **Expansion by jsonb.** Every function returns `jsonb`, so new fields append without a signature change — the UI evolves without a data-layer redesign.
- **Admin-gated SECURITY DEFINER**, mirroring `admin_adjust_reward_points` (044): `if not is_admin() then raise …`, `revoke … from public, anon; grant … to authenticated`.

---

## Migration 070 — `member_invites.sql` (invite funnel)

### Table: `member_invites`
One row per invitation sent. The top of the member funnel, previously unrecorded.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `contact_key` | text not null | `lower(btrim(email))` — joins `customers.contact_key` |
| `email` | text not null | as-sent, for display |
| `customer_id` | uuid → customers(id) on delete set null | CRM link, resolved at write |
| `points_promised` | int not null default 0, ≥0 | snapshot |
| `channel` | text not null default 'email' | check `email\|mailto\|copy` |
| `sent_by` | uuid → auth.users on delete set null | admin actor (null for system) |
| `sent_at` | timestamptz not null default now() | |
| `converted_user_id` | uuid → auth.users on delete set null | stamped on signup |
| `converted_at` | timestamptz | null until converted |
| `metadata` | jsonb not null default `{}` | **open extension point** (campaign, template, automation kind) |
| `created_at` | timestamptz not null default now() | |

Indexes: `contact_idx (contact_key)`, `sent_at_idx (sent_at desc)`, partial `open_idx (contact_key) where converted_at is null`.
RLS: admin read only (`using (is_admin())`); `revoke all from anon, authenticated; grant select to authenticated` (RLS narrows to admins). No client writes — definer functions only.

**Deliberately no referral columns.** Referrals will reuse the existing coupon + affiliate-ledger infra (migration 031), not this table — no duplicate systems. `metadata` covers future per-invite attributes.

### Functions
| Function | Sec | Grant | Purpose |
|---|---|---|---|
| `record_member_invite(p_email, p_points, p_channel, p_sent_by) → uuid` | definer | service_role only | The single write path. Resolves `customer_id` from `contact_key`, inserts the row. Called by the `send-invite` edge fn. |
| `admin_log_member_invite(p_email, p_points, p_channel) → uuid` | definer | authenticated (admin-gated) | Thin admin wrapper for the UI's mailto/copy channels; calls `record_member_invite` with `auth.uid()` and writes a `member.invited` audit entry. |

### `link_my_orders()` — extended (not duplicated)
Re-created verbatim from its current (053) body with **one appended block** (`NEW (070)`) that stamps the earliest still-open invite for the signing-up email as converted. Reuses the existing signup/login funnel — no new trigger, no second signup path. Reproduced in full because Postgres replaces functions whole.

---

## Migration 071 — `membership_admin_surface.sql` (admin read surface)

### View: `member_roster_base` (internal, no grants)
The single per-member aggregation, read only by the definer functions below (revoked from anon/authenticated). Reuse-over-duplication: roster, stats, and distribution all share it.

Per member (excludes `admin_users`) it computes: identity (from `customer_profiles` + linked `customers`), `spend_cents` + `ttm_spend_cents` (trailing 12mo) + `paid_orders` + `last_order_at` (orders attributed by owned `user_id`, falling back to CRM `contact_key` only for unlinked orders — no double-attribution), `points_balance` (real `reward_ledger` sum), `active_vouchers`, `discount` (jsonb from `effective_customer_discount()`), computed `segment`, `reward_ready`, `vip`, `spend_percentile`.

**Segment thresholds (defined once, here):** `new` = joined <30d with ≤1 paid order · `active` = paid order within 60d · `at-risk` = 60–120d · `dormant` = else. **VIP** = top ~10% by trailing-12mo spend via `percent_rank()` (data-driven, no hardcoded dollar). **Reward-ready** = balance ≥300 with no active voucher.

### Functions (all definer, admin-gated, `revoke public,anon; grant authenticated`)
| Function | Returns | Purpose | Reads |
|---|---|---|---|
| `admin_member_stats()` | jsonb | KPI strip in one call | `member_roster_base`, `orders` (90d member/guest split), `member_invites` |
| `admin_member_roster(p_segment, p_sort, p_search, p_limit, p_offset)` | jsonb `{rows,total,limit,offset,…}` | paged/filtered/sorted roster; row keys are the exact `MemberRow` view-model fields (camelCase) | `member_roster_base` |
| `admin_member_activity(p_customer_id)` | jsonb `{events,…}` | merged timeline — **UNION over existing tables, no events table, no new write path** | profiles, orders, reward_ledger, reward_vouchers, customer_discounts, member_invites, audit_log |
| `admin_member_spend_distribution()` | jsonb | trailing-12mo percentiles (p50–p95) + suggested Pro/VIP gates, so Phase 3 tier thresholds come from behaviour not guesses | `member_roster_base` |

`admin_member_stats()` KPI keys: `membersTotal, newThisMonth, segments{new,active,atRisk,dormant,vip}, atRisk, vip, pointsLiability, activeVouchers, rewardReady, memberRevenueSharePct, memberAovCents, guestAovCents, invitesSent, invitesConverted, inviteConversionPct, generatedAt`.

---

## Edge function — `send-invite` (invite logging)
`handler.ts` gains an **optional** `recordInvite({email, points})` dep (Deno-free; injected like `requireAdmin`), called best-effort after a successful send — a logging failure is swallowed and never fails the email. `index.ts` wires it via a service-role client calling `record_member_invite`. Backward-compatible: the existing 25-test unit suite passes unchanged (dep is optional). **Requires redeploy** (`supabase functions deploy send-invite`) after the migrations are applied.

---

## Client wiring — DONE (2026-07-23)
Demo data is **deleted** (`membersPreviewData.ts` removed; `AdminMembersPreview.tsx` → `AdminMembers.tsx`). The page renders only the `MembersViewData` contract, filled live by `src/pages/admin/useMembersData.ts`:

| Contract | Source |
|---|---|
| `stats` | `admin_member_stats()` — formatted into the 6 approved tiles |
| `queue` | `admin_member_attention()` — server owns the counts, client owns the wording |
| `members` + `total` | `admin_member_roster(p_segment,p_sort,p_search,p_limit,p_offset)` — **server-side** filter/sort/search/paging (50/page, "Load more") |
| expanded row (`useMemberDetail`) | `admin_member_activity()` (timeline) + existing admin `reward_ledger` read (recent points) + `customer_discounts` (expiry) — lazy per row, cached |

Roster row → `MemberRow`: `id`(customer_id, null when unlinked), `userId`, `name`, `contact`, `org`, `tier`, `accountType`, `businessName`, `freeShipping`, `status`, `spendCents`, `ttmSpendCents`, `paidOrders`, `points`, `rewardReady`, `effectivePercent`, `discountLabel`, `discountScope`, `discountExpiresIso`, `joinedIso`, `lastOrderIso`, `segment`, `vip`, `spendPercentile`.

**Degradation:** if migrations 070–072 aren't applied, any missing-relation/function error resolves to a calm "data layer not migrated yet" panel (same posture `CustomerAccountPanels` takes for 043–045) — the page never crashes.

**Inline editing deliberately deferred.** The write RPCs stay in `CustomerAccountPanels` on the customer detail page — one audited, confirm-guarded path. The Members expanded panels are read-only mirrors and "Open full customer profile →" is the edit route, so **no write logic is duplicated**. Extracting those three panels into shared writable components is the remaining Phase 1 step (it refactors the discount/rewards money path and deserves its own change + tests).

---

## Dependencies (existing objects reused — none duplicated)
`is_admin()` (003) · `log_audit()` (004) · `customers` + `customer_with_history` (004) · `customer_profiles` (028/043/049) · `admin_users` (003/004) · `orders` (003 + …) · `reward_ledger` (044/050) · `reward_vouchers` (050) · `customer_discounts` (045) · `effective_customer_discount()` (069) · `link_my_orders()` (028→043→053, extended here) · `handle_new_customer()` (028/043, unchanged).

## Tests
`tests/integration/membershipAdminSurface.test.ts` (Vitest + local `supabase start`, loopback-guarded, self-skips without env). Covers: anon denial on every `admin_member_*`; roster shows the real ledger balance (350) not the projection (210); spend/segment/tier/effective %/reward-ready; segment + search filters; stats aggregation; distribution percentiles; activity UNION; and the full invite→signup→conversion-stamp path. Runs in CI via `npx vitest run tests/integration tests/rls`.

## Not done in Phase 0 (by design)
- Applying migrations to prod (`db push`) and redeploying `send-invite` — manual.
- Phase 1 UI wiring (the `useMemberRoster()` hook, deleting `membersPreviewData.ts`).
- Voucher void RPC + redemptions view (Phase 2), tier-aware floor (Phase 3), automations (Phase 4).

## Deliberate expansion points
`member_invites.metadata` jsonb · all functions return jsonb (append fields freely) · tier passed through as data (a new tier = one check-constraint change, no code here) · `member_roster_base` is the single place to add a computed column (a benefit flag, a new segment) · if the view gets slow at scale, promote it to a scheduled materialized view — function signatures don't change.
