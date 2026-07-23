# Membership System Blueprint

**Status:** DRAFT — awaiting owner approval. No implementation until approved.
**Date:** 2026-07-23
**Scope:** The complete member lifecycle — first signup through long-term retention — built on top of what already exists. Design goals: admin stays fast, clean, iPhone-375px-friendly; pricing authority stays server-side; every phase ships independently.

---

## 0. Ground truth — what "member" is today

A **member** is any customer with a portal auth account: a `customer_profiles` row (migration 028) soft-linked to their CRM `customers` row (migration 004) via `customer_profiles.customer_id`. There is no membership flag anywhere else.

Current member benefits (all live):
- **Automatic 15% discount floor** — `effective_customer_discount()` (migration 069), mirrored display-only in `src/lib/memberPricing.ts` and cart-preview in `src/lib/accountDiscount.ts`.
- **Free member shipping** — `free_shipping` flag (migration 049) + cart "Free — member".
- **Rewards** — 1 point per paid $1 (`reward_ledger`, 044/053), 300 pts → 40%-off-one-item voucher (`reward_vouchers`, 050/052/064), auto-applied server-side at checkout, reconciled by cron (`reconcile` fn + uptime.yml, 067).
- **Per-member custom discounts** — `customer_discounts` (045), lifetime/business scope, admin-assigned, ≥15% wins over the floor.
- **Portal** — `/account` with Overview, Orders, Rewards, Benefits, Profile tabs.

Reserved but inert: `tier = 'pro'` (label only), `status = 'waitlisted'` (informational only), `account_type = 'business'` + `business_name` (badge only).

### Standing constraints this blueprint honors
- **Admin lives on an iPhone at 375px** — compact grouped nav, no pill walls, single-column cards.
- **Only codes/ids travel from the client; all pricing math is server-authoritative.** Client mirrors (`accountDiscount.ts`, `memberPricing.ts`, `coupons.ts`) must be updated in the same PR as any server discount change — this is a known bug class.
- **No native dialogs** (iOS silently no-ops them) — in-app ConfirmModal only.
- **No-stack rule intact:** B2G1 vs account % — larger wins, tie → B2G1. Nothing here changes stacking order (flat/free → B2G1 → reward → account → coupon).
- **Cron = GitHub Actions** (uptime.yml pattern hitting edge functions), not pg_cron.
- **Deploys:** frontend auto on push to main; `supabase db push` and `supabase functions deploy` are manual — every phase below lists its deploy surface.
- **Design register:** 2026 glass (`.glass-panel` / `.glass-clear`), Lab theme default. Gold is the peptide/member accent (the existing gold member chip).
- Migration numbers below assume next free = **070**; verify against `supabase/migrations/` at implementation time.

---

## 1. Member hierarchy

**Purpose.** A ladder that gives customers a reason to sign up, then a reason to keep buying. Each rung must have *real, server-enforced* benefits — a tier that's only a label (today's "pro") erodes trust.

### The ladder

| Tier | Definition | What it unlocks | Status |
|---|---|---|---|
| **Guest** | CRM `customers` row only | None; sees gold "Members $X" chips as the nudge; earns *projected* points that convert on signup | Exists |
| **Member** | Linked `customer_profiles` | 15% floor, free shipping, rewards earn+redeem, portal, member education/COA access (§1b) | Exists (benefits layer to build) |
| **Pro** | `tier='pro'`, earned on trailing-12-month spend | 20% floor + priority fulfillment + early access to new compounds/restocks + full lab-transparency vault | Label only |
| *(Future) Partner/B2B* | `account_type='business'` + negotiated `customer_discounts` business scope | Named business rate, concierge reorder, team accounts (§13) | Schema exists |

### Tier qualification — research-backed, not arbitrary (revised after best-in-class review)

Benchmarks reviewed: Sephora Beauty Insider (annual $0/$350/$1,000), **Thorne** (trailing-12-month, tiers can drop — the closest analog: a supplement/health brand), Vitamin Shoppe ($0/$200/$700 + escalating earn), REI/Prime/Costco (flat-fee models, not applicable to us). The consumable-repeat-purchase consensus is unambiguous:

1. **Gate on trailing-12-month paid spend — a rolling window, not lifetime, not calendar-year.** Lifetime spend is for slow-cycle goods (cars, appliances); for a reorder business it lets top tiers overfill and never empty, so status stops signaling *current* value and the incentive to keep buying dies. Rolling (any consecutive 12 months) also avoids the "January cliff" where a calendar reset demotes everyone at once. Thorne — our nearest analog — uses exactly this.
2. **Status can drop, but softly: qualify-then-hold 12 months, then one-step demotion with a warning.** A tier that can't be lost means nothing; but a slow quarter shouldn't instantly demote. Hold the earned tier for 12 months, step down one level at a time, and warn first ("you're $X from keeping Pro") — the warning itself drives a retention purchase.
3. **Set the dollar gates from percentiles of our own spend distribution, then round to clean display numbers.** Target shares: **Pro ≈ top 30–40% of active members** (must feel *achievable* to an engaged buyer), **VIP flag ≈ top 5–10%** (must feel *exclusive*). Guardrail: if the top bucket captures >15% of members it isn't exclusive enough; <3% and no one strives for it.
4. **Validate reachability:** confirm a normal repeat buyer can actually climb given our price points and reorder cadence in 12 months — a gate they can't reach is dead weight.

**Do not lock the dollar numbers now.** They are a *derived output of Phase 0*: the first analytical query against the new `admin_member_roster` view pulls the trailing-12-month spend distribution and reports the natural cluster breakpoints. We set Pro/VIP gates from that real curve before Phase 3 builds the tier logic. (Placeholder for wireframe/illustration only, clearly marked as such: Pro ~$1,500 trailing-12mo, VIP flag ~$4,000 — to be replaced by the percentile read.)

### Pro tier — the one real pricing decision
- **Benefit:** tier-aware discount floor (Member 15% / Pro 20%). One migration makes `effective_customer_discount()` read `customer_profiles.tier`; a higher assigned `customer_discounts` rule still wins. Non-discount Pro perks (priority fulfillment badge, early access, vault) are gated in app code off the tier, not the pricing function.
- **Granting (staged):** Phase 3 — manual via the existing admin tier toggle (`CustomerAccountPanels.tsx`) so we grant the first Pros deliberately and watch behavior. Later — an automation flips tier when trailing-12mo spend crosses the derived gate, with a congratulation email, plus the demotion-warning flow from qualification rule #2 (§12).
- **No self-serve upgrade, no paid subscription** on Zelle-only rails; paid membership stays a future idea (§13).

**Exists:** tier column + admin toggle + "Pro member" portal label. **Build:** tier-aware floor migration + client mirrors, trailing-12mo spend calc (a column in the Phase 0 view), portal benefits presentation (§4), roster tier column (§3), later auto-promote/demote automation. **Dependencies:** the percentile read (Phase 0) informs the gates before this builds. **Order:** Phase 3 (pricing) → automation in Phase 4+.

---

## 1b. Member ecosystem — benefits beyond discounts

**Purpose.** Ray's directive: membership should feel like an *ecosystem*, not a coupon. The research is blunt on why this matters commercially — **access, education, and community benefits drive retention and LTV harder than deeper discounts, and standalone "status" (a badge for its own sake) barely moves anything.** Discounts also train price-sensitivity and compress margin; every extra point of discount is margin gone. The winning structure is a **transactional floor (what we have) + an experiential/access layer on top (what we build)** — and as the program matures, shift the mix toward access, not deeper discounts.

Crucially for us: the highest-ROI benefits (low operational cost, high perceived value) are exactly the ones that fit a **lab-research-supplier + education-institution** identity. We largely already produce the raw material.

### The benefits ladder (mapped by fit + cost)

| Benefit | Category | Why it fits us | Cost / value | Tier |
|---|---|---|---|---|
| **Lab-transparency vault** — member-facing COAs, purity/batch/testing data per compound & per order | Knowledge + trust | Turns a compliance artifact into a *benefit*; differentiates on credibility not price; the invoice already carries a "Purity" line, and `/research` + `CompoundIntelligenceOverlay` already exist | **Low cost, high value** | Member (basic) / Pro (full batch history) |
| **Early access** — new compounds, restocks, limited batches visible to members first | Access / discovery | The single most-wanted loyalty benefit in the research; costs nothing but sequencing; pairs with the existing landing `MemberAccessGate` and a product visibility window | **Low cost, high value** | Member (restocks) / Pro (new compounds) |
| **Member research library** — protocols, dosing/handling references, compound deep-dives, citation-backed briefs | Knowledge / content | Directly on-brand for the education-institution positioning; keeps the brand in-inbox between orders without a sales ask; `/research` is the seam | **Low cost, high value** | Member |
| **Saved protocols + one-tap reorder** | Service | Drives reorder *cadence* (the consumable LTV lever) off existing order history; low complexity | Low cost | Member |
| **Priority fulfillment** — priority within the existing 24-hour lane + an order badge | Service | Concrete, felt every order; the 24-hour shipping tier already exists | Medium | Pro |
| **Reorder-cadence bonus** — escalating point multiplier for uninterrupted reorders | Value / retention | The research's "middle path" for buyers who won't commit to a subscription; keeps consumable cadence without auto-ship | Low cost | Member+ |
| **Community** (later) — a members channel / cohort touchpoints / ambassador status | Community | Among the strongest loyalty determinants; builds an emotional + switching moat | Medium | Member |
| **Subscribe-and-save** (future, §13) | Value / LTV engine | Subscribers can be worth ~8–9× a one-time buyer, but the research warns: don't lean on discount alone — wrap it in early access + bonus points, and add winback | Medium | All |

**Design rule this encodes:** keep the 15/20% discount as the *floor*, and spend new investment on the access/knowledge/community layer — higher perceived value, lower margin cost, and a perfect fit for a research supplier.

### Build note
None of the top-quadrant benefits need new pricing logic — they're **gates in app code off `tier` + a `member_content`/COA surface**, driven by config (a `tierBenefits.ts`, mirroring the existing `memberOffers.ts` pattern). They slot into the portal (§4) and don't touch the money path. **Order:** the vault + early-access + library land in a dedicated **Phase 3b (ecosystem)** right after the tier goes real, since Pro is what makes the top rungs meaningful. Each benefit is independently shippable — this is the most modular part of the system.

**Exists:** COA/purity data surfaces, `/research`, `CompoundIntelligenceOverlay`, `MemberAccessGate`, order history, 24-hour lane, `memberOffers.ts` config pattern. **Build:** tier-gated visibility, a member content/vault surface, `tierBenefits.ts`, reorder action, priority badge. **Dependencies:** real tier (§1) for the Pro-gated rungs; nothing for the Member-level rungs.

---

## 2. Data foundation (prerequisite for everything)

**Purpose.** Every gap found in the audit traces to one root cause: the admin UI computes member facts client-side from capped queries (500 customers, 5,000 orders, `floor($paid/100)` points *projection* instead of the real ledger). Fix the data layer once; every surface after that is presentation.

### To build (all migration 070-range, admin-only via `is_admin()`)

1. **`admin_member_roster` view/RPC** — one row per member joining:
   - `customer_profiles` (user_id, tier, status, account_type, free_shipping, created_at = **join date**)
   - `customers` (display name, contact, org, CRM status, notes-exists flag)
   - orders aggregate (lifetime paid cents, paid-order count, **last order date**, member-era vs guest-era split)
   - `reward_ledger` real balance (sum of points — kills the projection lie)
   - effective discount (reuse `effective_customer_discount()`) + active custom rules count
   - voucher counts (active/used)
   - **computed segment** (§8) as a column
   - Server-side sort + paging (50/page) + search — removes the 500-row cap and the 5,000-order client aggregation.
2. **`admin_member_stats()` RPC** — the KPI strip numbers (§7) in one call.
3. **`member_invites` table** (§9) — invite tracking.
4. **`admin_member_activity(customer_id)`** — timeline UNION view (§10).

**Exists:** all source tables. **Build:** the four objects above. **Dependencies:** none — pure additive migration; watch the migration-replay trap (021 precedent) and keep functions `SECURITY DEFINER` + admin-gated like existing 043–045 RPCs. **Order:** **Phase 0 — first thing built.** Nothing user-visible; zero UI risk.

---

## 3. Admin "Members" control center

**Purpose.** A **flagship admin surface** — the screen Ray opens every morning to read the health of the business at a glance, then act. Not a table with filters: a cockpit. Health and "what needs me today" sit above the fold; the roster and management live below; routine work happens inline with no page-loads. This is designed to be the daily home of the console, not a sub-report.

**Visual reference:** an interactive desktop + mobile wireframe of this entire section (Cockpit / Roster / Redemptions / Invites / Analytics / Referrals / Automations, including the expandable inline-management row) is published for review — see the wireframe link accompanying this blueprint. It is structure + workflow only, not final visual design; it renders in the console's glass/lab register with gold as the member accent.

### The Cockpit (default sub-view) — "understand the business in one glance"
Ordered by what the owner needs first:
1. **KPI strip** — the §11 numbers with a sparkline trend and a period-over-period delta each, health-colored. Program vitality in one row.
2. **"Needs attention" action queue** — the single highest-value element. Every item is a segment or threshold made *actionable*: at-risk VIPs, reward credits ready to nudge, discounts expiring, invites outstanding >7d, reconcile status. Each row deep-links into the filtered roster or relevant sub-view. This is what turns the roster from a list into a to-do list.
3. **Segment mix + member-vs-guest revenue** — the shape of the base and proof the program is paying for itself.

### Placement
New route `/admin/members`, added to the existing grouped commerce nav in `AdminLayout.tsx` (compact dropdown — not a new pill). The Customers tab stays as the all-contacts CRM; Members is the program view. The member filter on Customers can remain but link across ("View in Members →").

### Architecture (top to bottom, single column at 375px)

1. **Stats strip** — glass tiles from `admin_member_stats()`: members total · new this month · member revenue share · points liability · active vouchers (count + $ exposure) · at-risk count. Tap a tile → filters the roster where meaningful (e.g. at-risk).
2. **Segment chips** — All / New / Active / At-Risk / Dormant / VIP (§8). Server-side filter param, not client filtering.
3. **Roster** — server-paged list from `admin_member_roster`. Row: name + tier badge (gold member / distinct pro) · real points balance · lifetime paid · effective % · last order · join date. Sort: recent / spend / points / joined.
4. **Expandable rows** — tap → row expands inline with the three existing management panels (rewards adjust, discounts, profile flags) plus notes. **This is a refactor, not new code:** extract the panels already living in `src/pages/admin/CustomerAccountPanels.tsx` into shared embeddable components consumed by both the detail page and the roster row. "Full profile →" still deep-links to `/admin/customers/:id` for order/inquiry history.
5. **Sub-views** (secondary tabs within Members, dropdown at 375px): **Redemptions** (§6) · **Invites** (§9) · later **Automations** (§12).

**Exists:** every management RPC and panel; admin layout/nav pattern; audit logging. **Build:** route + page, stats strip, roster list, panel extraction, segment chips. **Dependencies:** Phase 0 data layer. **Order:** **Phase 1** — this is the visible payoff and the owner's daily surface; everything later plugs into it.

### Prototype status & production data handoff (2026-07-23)
The approved layout is built and live behind the admin gate at `/admin/members` (`AdminMembersPreview.tsx`), reusing the real admin components. It renders a single typed view-model, `MembersViewData` (`membersView.ts`) — the stable contract between layout and data. Today that view-model is filled by `membersPreviewData.ts`: fabricated, anonymized demo records (fictional names, reserved `.example`/`.invalid` emails, `isDemo: true`) that carry a visible demo banner + per-row "demo" tag and keep every control disabled. **No real customer data, no sample dataset that could drift from production.**

**Definition of done for the real page (Phase 1, on the Phase 0 views):**
- Replace the `membersPreviewData` import with a `useMemberRoster()` hook returning `MembersViewData` from `admin_member_stats()` + `admin_member_roster` — **delete `membersPreviewData.ts` entirely**; keep `membersView.ts`.
- The view-model reads the **existing** records — `customer_profiles`, CRM `customers`, `orders`, `reward_ledger`, `customer_discounts` — showing real balances, discounts, order history, join dates, statuses, and segments. It does **not** create a second customer store; the Customers section and CRM stay the source of truth (Members is a lens over them).
- `isDemo: false` removes every demo affordance automatically; re-enable the disabled controls behind real permissions; the profile link points at the real `/admin/customers/:id`.
- Acceptance: no hardcoded sample name, metric, activity item, or voucher remains anywhere in the members surface.

---

## 4. Customer/member portal experience

**Purpose.** The portal already answers "what did I order / what are my points." The upgrades make membership feel like a *status*: what tier am I, what do I get, what's next.

**Exists (strong):** `/account` shell with auth guard + flip-card signup (`AccountLayout.tsx`, `AuthCard.tsx`); Overview dashboard with tier line, reward tracker, discounts card, recent orders; full order detail with tracking + printable invoice; Rewards page with ledger + one-tap redemption; Benefits page listing custom discounts + explainer; Profile editing (guarded columns protected).

**Build (small, high-polish):**
1. **Membership card on Overview** — "Member since {join date}" + tier + concrete benefit list driven by a single `src/config/tierBenefits.ts` (mirrors §1 ladder; one editable config like `memberOffers.ts`).
2. **Progress-to-Pro** — once Pro is real (§1): a quiet gauge "lifetime $X of $2,500 toward Pro (20%)", reusing the `RewardTracker` hairline-gauge pattern.
3. **Email preferences toggle** in Profile (marketing opt-out — required by §12 before any non-transactional email goes out).
4. **Signed-in nav state** — `NavDrawer.tsx` account entry currently identical for guests and members; show signed-in caption (and optionally points balance chip). Small, but makes membership visible on every page.

**Dependencies:** #1/#4 none; #2 needs Phase 3 tier work; #3 needs the 070-range `marketing_opt_out` column and gates Phase 4. **Order:** #1 and #4 ride along Phase 1–2 as polish; #2 in Phase 3; #3 at the start of Phase 4.

---

## 5. Rewards and points lifecycle

**Purpose.** Points are the retention engine and a real liability on your books — the lifecycle must be visible and trustworthy end-to-end: earn → balance → redeem → consume → reconcile.

**Exists (nearly complete — this system is in good shape):**
- **Earn:** `floor(invoice_cents/100)` per paid order; double-earn blocked by partial unique index; guest history backfilled at signup by `link_my_orders()` (053).
- **Balance/statement:** portal `RewardTracker` + full ledger page; admin per-member panel with manual credit/debit (mandatory note, audit-logged).
- **Redeem:** 300 pts → 40%-off-highest-line voucher (`redeem_reward` RPC); server applies + atomically consumes at checkout (`consume_reward_voucher`, 064); percent fence (052) keeps it inside the coupon rules.
- **Integrity:** reconcile cron auto-repairs drift (067 + uptime.yml).

**Build:**
1. **Truthful admin surfaces** — roster shows real ledger balance; stats strip shows total outstanding points (liability). *(Phase 0/1 — already covered by §2/§3.)*
2. **Reward-ready notification** — email when a member crosses 300 (§12).
3. **Points expiry — decision explicitly deferred.** Not recommended now: expiry adds a ledger kind, a sweep job, reconciliation cases, and customer-anger risk, for a program still growing. Revisit when liability warrants it. The append-only ledger design makes it addable later without rework.

**Dependencies:** none new. **Order:** #1 Phase 0–1; #2 Phase 4.

---

## 6. Voucher and redemption management

**Purpose.** Today redemptions are a black box to the admin — `reward_vouchers` has **no admin view**. You can't see who redeemed, what's outstanding, or void a problem voucher.

**Exists:** the full voucher machine (issue 050, fence 052, consume 064, reconcile 067) and the customer-side display. Missing is *only* the admin window into it.

**Build:**
1. **Redemptions sub-view** in the Members center: all vouchers with member, status (active/used), issued date, used-on order (link), plus totals (outstanding count + $ exposure at current catalog prices).
2. **`admin_void_voucher` RPC** (070-range) — voids an active voucher **and appends a compensating `reward_ledger` adjustment returning the 300 points** (or explicitly not, per a required reason note), audit-logged, ConfirmModal-guarded. This is the one genuinely new server verb in the whole blueprint — keep it tiny and reconciliation-aware (must not create a new drift state for 067; add the void case to the reconcile function's known-good states in the same migration).
3. **Reconcile visibility** — show last uptime-probe reconcile status ("clean" badge) on the sub-view header, so voucher health is visible where vouchers are managed.

**Dependencies:** Phase 0–1 shell (the sub-view lives inside the Members center). **Order:** **Phase 2.**

---

## 7. Lifetime and business discounts

**Purpose.** The pricing lever for individual relationships — already the most complete subsystem. This blueprint mostly *presents* it better and wires it into tiers.

**Exists:** `customer_discounts` (045) with lifetime/business scope, label, expiry; `effective_customer_discount()` with the 15% floor (069); admin assign/deactivate panel; portal Benefits page; invoice labeling; cart preview mirror; the B2G1 no-stack gate.

**Build:**
1. **Tier-aware floor** (15/20) — the §1 migration. The only change to discount *math* in this blueprint.
2. **Roster column** — effective % per member at a glance (§2 view computes it), so custom rules and floors are visible without opening anyone.
3. **Expiry surfacing** — roster/detail flag for rules expiring within 30 days; later an automation nudge (§12) to renew or let lapse deliberately.

**Trap to honor:** every change to `effective_customer_discount()` ships in the same PR as updates to `accountDiscount.ts`, `memberPricing.ts` (`MEMBER_DISCOUNT_PERCENT` becomes tier-aware for display), and `coupons.ts` preview — plus place-order tests, mirroring the existing B2G1-vs-account test pattern.

**Dependencies:** #1 is standalone; #2–3 need Phase 0. **Order:** #2 Phase 1; #1 Phase 3; #3 Phase 4.

---

## 8. Member segmentation

**Purpose.** Turn the roster into a to-do list. A segment is only useful if it implies an action.

### Segments (computed, never stored)

| Segment | Definition (defaults — tune later) | Implied action |
|---|---|---|
| **New** | Joined <30d, no paid order *since joining* | Welcome nudge; watch conversion |
| **Active** | Paid order within 60d | None — protect the experience |
| **At-Risk** | Last paid order 61–120d ago | Win-back touch (§12) |
| **Dormant** | >120d (or member-era orders = 0 after 30d) | Stronger offer or let go |
| **VIP** | Trailing-12-month spend in the top ~5–10% (the Pro-grant watchlist) | White-glove; Pro upgrade |

VIP uses the **same trailing-12-month percentile** as the tier gate (§1), so "VIP" and "Pro-eligible" stay coherent — not a separate lifetime number. Computed as a `CASE` column in `admin_member_roster` — one source of truth; thresholds as named constants in the migration, documented here. **Never** a stored field to sync. VIP overlaps lifecycle segments (a VIP can be at-risk — that's your most urgent row); roster shows lifecycle segment + a VIP flag rather than forcing one bucket.

**Exists:** all inputs (join date, order dates, spend). **Build:** the CASE logic + segment chips + stat-tile counts. **Dependencies:** Phase 0 view. **Order:** ships *with* Phase 0/1 — it's a column and a chip row, and it's the highest-leverage feature-per-line-of-code in the blueprint.

---

## 9. Invite and referral tracking

**Purpose.** Invites are the top of the member funnel and currently fire-and-forget — no record of who was invited, when, or whether they converted. You cannot measure the funnel you can't see.

### Invite tracking — build
1. **`member_invites` table** (070-range): contact_key, email, sent_at, sent_by, points_promised, delivery channel (edge/mailto/copy), converted_user_id, converted_at.
2. **Write on send** — `send-invite` edge function inserts a row (currently writes nothing); the admin `InviteSheet`'s mailto/copy paths log via a small RPC so all three channels are counted.
3. **Conversion stamping** — extend `link_my_orders()` (053) to stamp `converted_*` when a signup matches an open invite. One function alteration, no new trigger.
4. **Invites sub-view** in Members center: sent / converted / conversion rate; outstanding invites with "re-invite" action.
5. **Bulk invite** — "Invite all guests with unclaimed points" (the list AdminCustomers already computes per-row), ConfirmModal with recipient count, throttled sends.

### Referrals — future phase, ride existing rails
A member-refers-member program should **reuse the coupon + affiliate ledger infrastructure (031)**, not a new system: each member gets a referral code (a `coupons` row tagged to them), redemptions land in the affiliate ledger, payout = reward points (an `adjustment` ledger entry). All server-side, all existing verbs. Design decision recorded now; build later (§13 ordering).

**Exists:** send-invite fn, InviteSheet, signup deep-link, link_my_orders, coupons/affiliate ledger. **Build:** items 1–5. **Dependencies:** table before stamping before sub-view; bulk invite wants the Phase 1 shell. **Order:** table + stamping in **Phase 0** (start capturing data immediately — the funnel numbers only exist from the day logging starts); sub-view + bulk in **Phase 2**.

---

## 10. Member activity timeline

**Purpose.** One merged, chronological answer to "what's the story with this member?" — replacing mental joins across four panels.

**Design: a UNION view, not an events table.** `admin_member_activity(customer_id)` merges what's already recorded: profile created (joined) · orders placed/paid/fulfilled · reward ledger entries (earn/adjust/redeem/reversal) · vouchers issued/used · invites sent/converted (§9) · discount rules assigned/deactivated · admin actions from the existing audit log (004) scoped to that customer. Zero new write paths, zero backfill, zero drift — the history appears fully populated on day one. An events table is only warranted if timeline queries ever get slow; the view can be swapped for a materialized one later without UI changes.

**Surface:** a Timeline section on `/admin/customers/:id` and inside the expanded roster row (latest 5 + "full timeline"). **Portal-facing timeline: skip** — Orders + Rewards ledger already tell the customer their own story.

**Exists:** every source table. **Build:** the view + one list component (row: icon · one-line description · relative date · deep-link). **Dependencies:** invites rows exist only after §9 logging starts (another reason Phase 0 includes the table). **Order:** **Phase 2.**

---

## 11. Member analytics and KPIs

**Purpose.** Five numbers that tell the owner whether the program is working, on one strip, on a phone — not a BI suite.

### The KPI set (all from `admin_member_stats()`)

| KPI | Why it matters | Source |
|---|---|---|
| Members total + new this month | Growth | `customer_profiles.created_at` |
| Invite conversion rate | Funnel efficiency | `member_invites` (§9) |
| Member revenue share (90d) | Is membership driving revenue? | orders × user_id presence |
| Member vs guest avg order value | The 15% must be paying for itself in basket size/frequency | orders aggregate |
| Points liability + voucher exposure | Real money promised | ledger sum + active vouchers |
| At-risk count | Churn early-warning | segment counts (§8) |

**Reports integration:** add a **Members export sheet** to `AdminReports.tsx` (join date, tier, spend, real points, effective %, segment, last order) — the current Customers export omits every member field. Trend charts (cohort curves, retention) are deliberately future (§13): capture-now/chart-later, since all inputs are timestamped already.

**Exists:** raw data. **Build:** stats RPC (Phase 0), strip (Phase 1), export sheet (Phase 2). **Dependencies:** invite-rate needs §9 logging history — it will read low until data accumulates; label it accordingly. **Order:** as listed.

---

## 12. Notifications and automation

**Purpose.** The retention layer — the right email at the right lifecycle moment, without the owner doing anything manually. Everything rides the existing Resend + `_shared/emailBrand.ts` branding and the GitHub-Actions-cron → edge-function pattern (uptime.yml precedent). **No new infrastructure kinds.**

### Compliance gate (build first, blocks everything else here)
- `marketing_opt_out` on `customer_profiles` + portal Profile toggle (§4) + unsubscribe link in every non-transactional template. Transactional email (order lifecycle, reward-ready) is fine; win-back and offers are marketing and legally need opt-out.
- **`email_log` table** — (user_id, kind, period_key, sent_at) with a unique constraint = idempotency. A cron that can't double-send is the difference between automation and an incident.

### Automations, in value order
1. **Reward-ready** — balance crossed 300: "your 40% credit is ready." Transactional-adjacent, directly revenue-driving.
2. **Invite follow-up** — invited, not converted after 7d, one reminder max (needs §9).
3. **At-risk win-back** — entered At-Risk (§8): one quiet, on-brand note (member benefits recap; optionally a `memberOffers.ts` offer). Marketing → opt-out gated.
4. **Discount-expiry notice** — custom rule expiring in 14d (customer notice + admin flag §7).
5. **Welcome sequence** — day-0 benefits orientation for new members (signup confirmation exists; this is the "here's what membership gets you" beat).

**Mechanism:** one `member-automations` edge function (verify_jwt=false + secret, like `reconcile`), invoked by a scheduled workflow, evaluating segments/thresholds server-side, checking `email_log`, sending via Resend. One function, one cron, N automation kinds — each individually toggleable via env/config.

**Admin visibility:** an Automations sub-view (sends by kind, last run, per-kind toggle) — can trail the first automations by a phase.

**Exists:** Resend, brand module, templates to crib from, cron pattern, segment inputs. **Build:** opt-out column + toggle, email_log, the edge function, workflow, templates. **Dependencies:** §8 segments, §9 invites, opt-out before any marketing send. **Order:** **Phase 4** — deliberately after the admin can *see* members (Phases 0–2), because automation without observability is how programs silently misfire.

---

## 13. Future expansion (fits the architecture; explicitly not now)

1. **Referral program** — §9 design; coupons + affiliate ledger rails. *(First candidate after Phase 4.)*
2. **Auto-Pro promotion** — automation flips `tier` at the VIP threshold + congratulation email; manual grant Phase 3 proves the tier first.
3. **Store credit** — a second append-only ledger cloning the `reward_ledger` pattern for refunds-as-credit and goodwill; place-order applies like the reward slice.
4. **Member early access** — product flag + members-only visibility window; pairs with the existing entrance `MemberAccessGate`.
5. **Cohort/retention charts** —month-over-month retention curves on top of §11's capture-now data.
6. **B2B team accounts** — multiple logins per business profile; `account_type='business'` is the seam.
7. **Paid membership** — blocked on payment rails (Zelle-only, no recurring); revisit only if card processing lands.
8. **White-label reuse** — the entire system keys off migrations + `siteConfig`/`emailBrand` overrides, so it ports to the white-label framework; keep tier names/thresholds in config, not copy, as built.

---

## 13b. Modularity principles (so we never redesign)

Ray's requirement: every major feature must be expandable later without a redesign. The architecture already leans this way; making it explicit as rules the build must follow:

1. **The Members center is a shell + pluggable sub-views.** Each sub-view (Cockpit, Roster, Redemptions, Invites, Analytics, Referrals, Automations) is an independent panel mounted into one route. Adding a sub-view = adding a tab + a panel, never touching the others. The wireframe already reserves the Referrals and Automations slots though they build later.
2. **Data layer is composable views/RPCs, not bespoke queries.** Everything reads from `admin_member_roster` / `admin_member_stats` / `admin_member_activity`. A new column (a new benefit's state, a new metric) is added to a view; every surface that needs it picks it up. No surface computes its own member facts (the bug we're removing).
3. **Benefits and tiers live in config, not code branches.** `tierBenefits.ts` + `memberOffers.ts` (pattern exists) mean adding a perk or rotating an offer is a config edit. Tier *names and thresholds* are config/constants, not copy — which is also what makes the whole system white-label-portable (§13.8).
4. **One segment definition, one place.** The `CASE` in the roster view is the sole source of segment truth; automations, KPIs, chips, and the action queue all read it. Change a threshold once.
5. **Automations are pluggable kinds behind one function + one idempotency table.** Adding an automation = adding a kind + a template, not new infrastructure.
6. **The activity timeline is a UNION view, not a new write path.** New event types appear by adding a `SELECT` branch — no backfill, no new logging code, no drift.
7. **Pricing changes ship with their mirrors.** The one hard rule the money path imposes: any change to `effective_customer_discount()` ships in the same PR as `accountDiscount.ts` / `memberPricing.ts` / `coupons.ts` + place-order tests. This is a constraint, not a limit on modularity — it keeps the seam honest.

The test for any future addition: *does it slot into an existing shell/view/config, or does it force a structural change?* If the latter, the seam is wrong — revisit before building.

---

## 14. Implementation order — the phase plan

Each phase is independently shippable and leaves the system consistent. DB + edge deploys are manual — each phase lists its surface.

| Phase | Contents | Deploy surface | Risk |
|---|---|---|---|
| **0 — Data foundation** ✅ BUILT 2026-07-23 | Roster view/RPC, stats RPC, `member_invites` + send-logging + conversion stamping, timeline view, spend-distribution RPC | migrations 070+071 + send-invite redeploy | None visible; pure additive. **Files written, not yet pushed** (manual `db push` + `functions deploy`; CI real-Postgres tier gates). Full map: [MEMBERSHIP_DATA_LAYER.md](MEMBERSHIP_DATA_LAYER.md) |
| **1 — Members control center** | Route + nav, stats strip, segmented roster, inline expandable management (panel extraction), portal polish (member-since card, nav signed-in state) | Frontend only | Low; new page, refactored panels shared with existing detail |
| **2 — Visibility completion** | Redemptions sub-view + void RPC + reconcile badge; Invites sub-view + bulk invite; timeline surfaced in detail + rows; Members export sheet | 1 small migration (void) + frontend | Void RPC touches reward integrity — extend 067 reconcile knowledge in same migration; test like 064 |
| **3 — Pro tier goes real** | Percentile read of trailing-12mo spend → set gates; tier-aware 15/20 floor migration + client mirrors + tests (same PR); portal tier card + progress-to-Pro; manual grants to first Pros | 1 migration + frontend | **Highest care: pricing path.** Mirror-sync trap; place-order test coverage mandatory |
| **3b — Member ecosystem** | Lab-transparency vault + early-access gating + member research library + reorder action + priority badge; `tierBenefits.ts` config | Frontend + 1 small content/visibility migration | Low; app-code gates off tier, no money-path change; each benefit independently shippable |
| **4 — Automation** | Opt-out + email_log migration; `member-automations` fn + scheduled workflow; reward-ready → invite follow-up → win-back → expiry notice → tier promote/demote warning; Automations sub-view | 1 migration + 1 new fn + 1 workflow + frontend | Medium; idempotency table + per-kind toggles contain blast radius |
| **5 — Growth layer** | Referral codes on coupon/affiliate rails; auto-Pro; subscribe-and-save + reorder-cadence bonus; welcome sequence; cohort charts | Per-item | Scoped when reached |

**Dependency spine:** Phase 0 → everything. §9 invite logging sits in Phase 0 *specifically because funnel data only exists from the day capture starts* — every week of delay is a week of unmeasurable invites. The trailing-12-month **spend distribution read is an early Phase 0 output** and sets the tier/VIP percentile gates before Phase 3 hard-codes them. Phase 3 (pricing) is sequenced after the admin can see members, so tier grants are informed; 3b (ecosystem) follows immediately because Pro is what makes the top benefit rungs meaningful. Phase 4 is last of the core because automation needs segments (0), observability (1–2), and consent (its own gate).

---

*Companion docs: DESIGN_2026_BLUEPRINT.md (visual register) · PRO_REVIEW_2026-07-18-a-plus.md (test/CI bar: money-path changes need real-Postgres tier coverage) · ROLLBACK.md (edge fns roll back by deploying old source forward; DB is forward-fix only — another reason migrations here are small and additive).*
