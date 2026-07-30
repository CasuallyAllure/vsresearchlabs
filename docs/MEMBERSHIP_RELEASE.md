# Membership Management — Release Record & Freeze Document

**Date:** 2026-07-30 · **Verdict:** READY TO FREEZE (after the stabilization pass in this document's PR).
**As-built companions:** `MEMBERSHIP_DATA_LAYER.md` (server map) · `MEMBERSHIP_BLUEPRINT.md` (historical design) · `MEMBERSHIP_EXECUTION_STRATEGY.md` (execution model record).

## 1. Architecture (one paragraph)
Membership is a **lens over the existing commerce records** — `customers` (CRM), `customer_profiles`, `orders`, `reward_ledger`, `reward_vouchers`, `customer_discounts` — plus three additive stores of its own: `member_invites` (funnel), `email_log`/`automation_settings` (automation), `member_referral_codes` (referrals). All statistics are computed server-side (`member_roster_base` + 13 admin RPCs, all `SECURITY DEFINER` + `is_admin()`-gated); the client renders a typed view-model and never estimates. Billing authority is `effective_customer_discount()` (tier-aware floor: member 15% / pro 20%), mirrored display-only in `memberPricing.ts`/`accountDiscount.ts`. Writes flow through single audited paths (the shared `accountPanels`, the void/toggle RPCs, the `member-automations` edge fn).

## 2. Feature inventory (post-stabilization status)
| Feature | Status |
|---|---|
| Admin Members center (Roster · Redemptions · Invites · Automations), KPI strip, needs-attention queue (deep-linked), server-paged roster, expandable rows w/ writable panels, timeline | COMPLETE |
| Member profiles / profile flags / rewards adjust / discounts (single write path, tier-floor callout) | COMPLETE |
| Voucher oversight + void (active-only, refund, audited) · reconcile cron (067) | COMPLETE |
| Invites: funnel stats, log, re-invite, bulk invite, conversion stamping | COMPLETE |
| Members export sheet (Reports) | COMPLETE |
| Portal: membership card, benefits page, rewards+redemption, Library (research documentation), reorder, referral card (auto-surfaces existing code), email-preferences toggle | COMPLETE |
| Pro pricing (20% floor) + priority chip (admin) | COMPLETE — Pro granted manually |
| Automations: 5 kinds, idempotent engine, daily cron, admin toggles + send log | **DISABLED BY DESIGN** (all kinds OFF) |
| Early access (member-first window) | **DISABLED BY DESIGN** (zero products tagged) |
| Referral point payouts | DEFERRED (documented future automation kind; uses are recorded) |
| Auto-Pro promotion / progress gauge | DEFERRED (needs a real spend distribution; `admin_member_spend_distribution()` is the dormant tool for setting gates) |

## 3. Stabilization pass (this PR) — bugs found by the release audit, all fixed
1. **Marketing opt-out toggle was missing** (approved WS-F item): column/SQL gating existed but no UI could write it → added to `CustomerProfile`/patch types + an Email-preferences section on the portal Profile page. *This was the hard blocker on ever enabling `winback`; now resolved.*
2. **Admin timeline could wedge on "Loading…"** — cancelled fetch left its in-flight claim; now released in `finally`.
3. **Free shipping keyed on the wrong flag** on portal order detail + Benefits (049 admin-extra column instead of membership itself) — every member's invoice/benefits now shows the truth.
4. **"Members $X · create a profile" chip shown to signed-in users** (understated Pro's rate) — chip is now guest-only, via a new zero-query `authPresence` store.
5. **Per-tile `useCustomerAuth()`** (WS-E regression): each catalog tile fired its own profile fetch + `link_my_orders` RPC for signed-in users — replaced with the shared presence store.
6. **15% offer card contradicted a Pro's 20% tier card** — offer card now renders for member tier only.
7. **DiscountsPanel could display a sub-floor rule as if it billed** — panel now states the tier floor and badges below-floor rules "bills N% (floor)".
8. **Early-access gating covered 2 of 6 terminal buy surfaces** — overlay, inventory modal, inventory row/table now gated identically (still dark).
9. Queue actions were disabled buttons styled as live — now real deep-links (segment/sort/sub-view); the one target-less kind renders as plain text.
10. Cleanup: dead `GhostAction`, stale docstrings/casts, referrals-block raw date, stray default export, portal reward vocabulary aligned to "units", doc status headers corrected, strategy doc committed.

## 4. Hidden features — why off, how on, launch-ready?
| Feature | Why disabled | How to enable | Ready? |
|---|---|---|---|
| **Automation kinds** (reward_ready, invite_followup, winback, discount_expiry, welcome) | Owner reviews templates before customers get email (decision D3) | Members → Automations → toggle per kind (audited). Recommend a `workflow_dispatch` dry-run first (per-kind candidate counts, zero sends) | Yes — engine cron-proven in prod; winback's opt-out prerequisite now exists. Enable `winback` only after this PR deploys |
| **Early access** | A capability, not a campaign — zero products tagged | Add the `early-access` tag to a product in the product data | Yes (all six buy surfaces gated; admin order review is the documented backstop) |
| **Referral issuance** | Nothing disabled — codes issue on first member request; zero issued yet | Member presses "Get referral code" | Yes; payouts deferred by design |

## 5. Known limitations (accepted at freeze)
- Sub-view lists cap at 200 rows (vouchers/invites) & 100 (email log) with no load-more — fine at current scale; add paging past ~200.
- Referral guest-contact self-use isn't blocked server-side (would touch KEYED `validate_coupon`); stats exclude the member's own contact.
- "Points/pts" (admin, emails) vs "units" (portal) vocabulary split remains outside the portal; portal itself is now consistent.
- `listMyOrderLines` (Library) is unpaginated; fine until a member has very large history.
- Pro tier is invisible to members (no upgrade path/marketing) — deliberate until tiering strategy matures; priority handling has no customer-visible confirmation.
- "Member since" = signup date, not first guest order.
- Duplicated helpers (copyText ×2, escapeHtml per-edge-fn ×9 repo-wide, isMissingBackend ×3, date formatters) — consolidation debt, no behavior risk.
- No component test renders `AdminMembers` itself (sub-views are covered); roster is exercised by e2e + prod smoke.
- Workers Builds deploys `main` without CI gating (repo-wide, pre-existing) — branch protection is the fix.

## 6. Operational notes
- **Deploys:** frontend auto on merge to `main`; `supabase db push` + `functions deploy` are manual. DB is forward-fix only.
- **Cron:** `member-automations.yml` daily 15:23 UTC (secret-gated, fails the run on any per-kind error); `uptime.yml` reconciles vouchers every 15 min (pager = failed run).
- **Secrets:** `AUTOMATIONS_CRON_SECRET` set in Supabase function env + GH Actions. Rotate by setting both again.
- **Money-path rule (permanent):** any change to `effective_customer_discount()` ships in one PR with the `memberPricing`/`accountDiscount`/`coupons` mirrors + place-order & DB-tier tests.

## 7. Launch checklist (owner)
1. Deploy this stabilization PR (merge → auto frontend; no migration in it).
2. Authenticated pass: Members center (4 tabs), a member row edit, portal Overview/Benefits/Rewards/Library/Profile (see the new email-preferences toggle), reorder an order.
3. When ready for email: dry-run automations, review each template in the Automations tab, flip kinds individually — `winback` last.
4. Optional: tag a product `early-access`; grant Pro to a first member.

## 8. Future roadmap (non-blocking)
Referral point payouts (automation kind) · auto-Pro + progress gauge (revisit `admin_member_spend_distribution` at ~30+ members) · cohort charts · sub-view paging · Pro discovery/upgrade surface · helper consolidation · subscribe-and-save (blocked on payment rails) · points expiry (deliberately rejected for now).
