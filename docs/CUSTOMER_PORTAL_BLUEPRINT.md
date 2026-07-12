# Customer Portal Blueprint — Account Center

Status: APPROVED FOR IMPLEMENTATION · Author: orchestrator session 2026-07-11
Scope: transform `/account` from a login page + read-only order list into a secure
customer account center: orders, order detail, invoices, payment/fulfillment status,
carrier tracking, reward points, lifetime discounts, business discounts.

Derived from a six-domain repository audit (auth/identity, orders/checkout,
invoices/tracking, discounts/coupons, Supabase infra/RLS, portal/admin frontend).
Nothing here is invented ahead of inspection; every reuse claim cites real files.

---

## 1. Current architecture (audited)

**Identity.** Two parallel auth contexts over one Supabase client
(`src/lib/supabase.ts`): `useCustomerAuth` (`src/lib/customerAuth.ts`) and
`useAdminAuth` (`src/lib/adminAuth.ts`). Customers get a `customer_profiles` row
(migration `028`, PK `user_id → auth.users`) via the `handle_new_customer()` trigger.
Admins live in `admin_users` (migration `003`) behind `is_admin()` SECURITY DEFINER —
the backbone of every admin RLS policy and RPC. A separate admin CRM table
`customers` (migration `004`, deduped by contact) has **no live link** to
`customer_profiles` (`customer_profiles.customer_id` exists but is never populated).
No business-account concept exists anywhere.

**Orders.** `orders` + `order_lines` (migration `003`, extended through `042`) are
admin-read-only via RLS, with two customer-facing exceptions added by `028`:
`"Customers read own orders"` / `"Customers read own order_lines"` keyed on
`orders.user_id = auth.uid()`. But **checkout never stamps `user_id`**
(`supabase/functions/place-order/index.ts:830-848`) — ownership is only claimed
retroactively by `link_my_orders()` on next sign-in. Buyer-facing order access today
is a 256-bit bearer token (`lookup_token`, `get_order_by_token`, migrations
019/021/039/041) surfaced on `/track`.

**Invoices.** One shared email template (`supabase/functions/_shared/invoiceEmail.ts`)
plus two hand-copied React re-implementations: admin `PrintableInvoice`
(`src/pages/admin/OrderView.tsx`) and `/track` `InvoiceDoc`
(`src/pages/TrackOrder.tsx`), plus a fourth independent receipt template
(`send-receipt`). No PDF service; print CSS (`.print-doc`) does invoice/receipt
downloads.

**Tracking/fulfillment.** `carrier`/`tracking_number`/`shipped_at`/`delivered_at`
on orders (migration `012`); status enum `pending_review → … → fulfilled` mapped to a
public presentation (`received/awaiting_payment/…/delivered`) in SQL and in
`src/lib/tracking.ts` (`statusPresentation`, `STATUS_STEPS`, `carrierTrackingUrl`).
Buyer double-confirm shipping shipped in migration `041` (`confirm_order_shipping`,
`ship_confirmed_at`, `ConfirmAddressCard`).

**Discounts.** Coupon engine (migrations `031`–`042`): `coupons`, `affiliates`,
`coupon_redemptions` (affiliate/commission ledger), `order_coupons` (per-order
itemized stack). Compounding model (flat + free-item first, percents on the
remainder) is hand-mirrored in **three places**: `place-order` TS,
`recompute_order_totals()` SQL (042), `src/lib/coupons.ts` preview. No rewards, no
lifetime/business/per-customer discount exists; `customer_profiles.tier` is cosmetic.

**Frontend portal.** `/account` (`src/pages/Account.tsx`) is a single unguarded page:
flip-card auth (`src/components/account/AuthCard.tsx`) or a read-only
`AccountDashboard` (greeting, address on file, display-only order list). No
sub-routes, no order click-through, no in-portal invoice/tracking, no profile edit UI
(`updateMyProfile` exists, uncalled).

**Testing.** None. No test script, no vitest config, no playwright config, no CI
workflows. `playwright` is an unused devDependency.

**Deploy reality.** Prod DB is applied through migration `040`; `041` and `042` are
pending. Deploy is manual (wrangler / supabase functions / supabase db push); nothing
in this project deploys on git push. **This blueprint's work must not be deployed or
pushed without explicit authorization.**

---

## 2. Target architecture

One canonical, database-enforced ownership chain:

```
auth.users ──1:1── customer_profiles (portal identity; account_type individual|business)
    │                    │ (soft link, backfilled)
    │                    └── customer_id → customers (admin CRM, unchanged)
    ├──1:N── orders.user_id            (stamped at checkout + link_my_orders backfill)
    │           ├── order_lines        (customer read-own via parent order)
    │           ├── order_coupons      (customer read-own via parent order)  ← NEW policy
    │           └── order_events       (stays admin-only)
    ├──1:N── reward_ledger             (append-only signed entries)          ← NEW
    └──1:N── customer_discounts        (admin-managed rules: lifetime|business) ← NEW
```

Portal reads go through **RLS-scoped selects + one authenticated RPC**
(`get_my_order`) that reuses the proven `get_order_by_token` payload shape. The
token path stays for guests/email links; the authenticated path never widens any
anon surface. All writes remain SECURITY DEFINER RPCs. No service-role material
ever enters `src/`.

### 2.1 Canonical customer identity model

- **Canonical portal identity = `auth.users.id`**, materialized as
  `customer_profiles.user_id`. Every customer-owned record keys on it.
- **Business customers are customer_profiles with `account_type = 'business'`**
  (new column) + `business_name`. No separate org/membership system (YAGNI: one
  login per business today; a future multi-seat model can add a join table without
  breaking this).
- **Admin CRM `customers` stays** as the operational contact book. New:
  `handle_new_customer()` and `link_my_orders()` backfill
  `customer_profiles.customer_id` by matching `lower(contact)`, so admin sees one
  linked identity. CRM is never a security boundary.
- **Ownership stamping**: `place-order` accepts an optional `Authorization` bearer
  (the customer's session JWT), resolves it with the anon client
  (`auth.getUser()`), and stamps `orders.user_id` **only when the verified auth
  email equals the order's `buyer_contact`** (case-insensitive). Mismatch → order
  is created unowned (guest semantics preserved) and remains claimable by
  `link_my_orders()` later. This keeps the same email-verification trust anchor
  as 028.

### 2.2 Security invariants (non-negotiable)

1. Customers can never read or infer another customer's rows — enforced in
   Postgres (RLS / RPC predicates), never only in the client.
2. `tier`, `status`, `account_type`, `customer_id` on `customer_profiles` are
   **not customer-writable** (fixes the audited privilege-escalation hole).
3. Reward balances and discounts are computed **only** from server-side data by
   SECURITY DEFINER code; clients send no amounts, only identifiers.
4. `reward_ledger` is append-only (no UPDATE/DELETE policies or grants);
   corrections are compensating entries.
5. No anon-facing surface is widened: `lookup_order` stays status-only,
   `get_order_by_token` grants unchanged, `validate_coupon` unchanged.
6. No service-role key, Resend key, or Turnstile secret in `src/` (currently
   clean; must stay clean).
7. Email confirmation must be ON in the Supabase dashboard — it is the trust
   anchor for `link_my_orders` and checkout stamping. Not repo-verifiable; must
   be behaviorally verified (signUp returns no session) and documented.

---

## 3. Database design

### 3.1 New/changed tables

**`customer_profiles` (alter)**
```sql
alter table customer_profiles
  add column account_type text not null default 'individual'
    check (account_type in ('individual','business')),
  add column business_name text;
```
Plus a `BEFORE UPDATE` trigger `guard_customer_profile_columns()`: when
`not is_admin()` and the row is being updated by its owner, force
`new.tier = old.tier`, `new.status = old.status`, `new.account_type = old.account_type`,
`new.business_name = old.business_name`, `new.customer_id = old.customer_id`.
(Trigger, not policy, so the existing self-update UX for name/phone/address keeps
working with zero client changes.)

**`reward_ledger` (new)**
```sql
create table reward_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  order_id     uuid references orders(id) on delete set null,
  kind         text not null check (kind in ('earn','reversal','adjustment')),
  points       integer not null check (points <> 0),   -- signed
  note         text,
  created_by   uuid references auth.users(id),          -- admin actor or null=system
  created_at   timestamptz not null default now()
);
create index reward_ledger_user_idx on reward_ledger (user_id, created_at desc);
create unique index reward_ledger_earn_once
  on reward_ledger (order_id, kind) where kind in ('earn','reversal');
```
- Accrual rule (deterministic): **1 point per whole dollar of
  `invoice_amount_cents`** (`floor(cents/100)`), written by
  `mark_order_paid()` for owned orders (`user_id is not null`), guarded by the
  partial unique index so re-marks can't double-earn.
- Reversal: `cancel_order()` / `revert_order_status()` out of `paid`+ insert a
  compensating `reversal` row (negative of the earn) if an earn exists and no
  reversal yet.
- Manual: `admin_adjust_reward_points(p_user_id, p_points, p_note)` —
  `is_admin()`-gated, points ≠ 0, note required.
- Balance = `sum(points)`; exposed via `get_my_reward_summary()` RPC (balance +
  entries) or a plain RLS select. Balance can go negative only via admin
  adjustment (allowed, visible).
- Redemption/spending is **out of scope** (portal shows balance + history only).

**`customer_discounts` (new)**
```sql
create table customer_discounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  scope        text not null check (scope in ('lifetime','business')),
  percent      numeric(5,2) not null check (percent > 0 and percent <= 100),
  label        text not null,                -- shown on invoices, e.g. 'Lifetime 10%'
  active       boolean not null default true,
  starts_at    timestamptz,
  expires_at   timestamptz,
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index customer_discounts_user_idx on customer_discounts (user_id) where active;
```
- One rules table serves both frameworks; `scope` separates them.
- `scope='business'` rows are valid only for profiles with
  `account_type='business'` (enforced in the RPCs and in effective-discount
  resolution, not a hard FK check, so demoting an account merely disables the rule).
- Admin CRUD via `is_admin()` RPCs (`admin_set_customer_discount`,
  `admin_deactivate_customer_discount`); customer has SELECT-own RLS only.

### 3.2 How customer discounts hit an order (key design decision)

**Applied customer discounts are materialized as `order_coupons` rows** with
synthetic codes (`ACCT-LIFETIME`, `ACCT-BUSINESS`), `kind='percent'`. Rationale:
the entire existing invoice pipeline — itemized "Discounts applied" blocks on all
three invoice surfaces, `recompute_order_totals()` (042), per-line allocation
(`src/lib/lineDiscounts.ts`) — already renders and recomputes `order_coupons`
rows. Reusing it means **zero changes** to invoice rendering, admin recompute
keeps working when admins edit lines, and the discount audit trail is the same
table for every discount source. `coupon_id` stays null for synthetic rows; a
`source` column (`'code' | 'account'`) added to `order_coupons` distinguishes them
and blocks admin "remove coupon" from silently deleting an entitlement (admin uses
a dedicated toggle instead).

### 3.3 Discount precedence & stacking (deterministic, centralized)

Extends the shipped compounding model (042 + place-order pass structure):

1. **Pass 0 — free items**: `free_item` coupon codes zero their matching line
   (existing behavior).
2. **Pass 1 — flat**: `fixed` coupon codes reduce the base
   (`flat = min(Σ fixed, subtotal)`); `baseAfterFlat = subtotal − flat`.
3. **Pass 2 — percents on `baseAfterFlat`**:
   a. **Account discount first**: the customer's single best active discount —
      `max(percent)` across qualifying `customer_discounts` rows. **Lifetime and
      business discounts never stack with each other**; the better one wins.
   b. **Coupon percents** then apply, scaled on the same `baseAfterFlat`
      (existing compounding math, unchanged).
4. Total discount capped at subtotal; total ≥ 0. Shipping is never discounted.

The resolution "which account discount applies" lives in **one** SQL function
`effective_customer_discount(p_user_id)` (returns scope, percent, label or null),
called by `place-order` (via service role) and available to
`recompute_order_totals` — so checkout and admin recompute cannot drift on
*eligibility*, and the percent math itself flows through the already-aligned
`order_coupons` machinery. The cart preview (`src/lib/coupons.ts`) gains the same
rule fed by a portal-visible RLS select.

### 3.4 New/changed RLS policies

| Table | Policy | Predicate |
|---|---|---|
| `order_coupons` | `"Customers read own order_coupons"` SELECT | `exists (select 1 from orders o where o.id = order_coupons.order_id and o.user_id = auth.uid())` |
| `reward_ledger` | `"Customers read own reward entries"` SELECT | `user_id = auth.uid()` |
| `reward_ledger` | `"Admins read all reward entries"` SELECT | `is_admin()` |
| `customer_discounts` | `"Customers read own discounts"` SELECT | `user_id = auth.uid()` |
| `customer_discounts` | `"Admins manage customer discounts"` ALL | `is_admin()` |

Writes on both new tables: **no INSERT/UPDATE/DELETE policies for authenticated**;
`revoke all on ... from anon, authenticated` then `grant select` back (repo's
established hardening idiom, cf. 031/036). All mutations via SECURITY DEFINER RPCs
with `revoke execute ... from public, anon` (+ `authenticated` where admin-only…
every admin RPC keeps the internal `is_admin()` raise).

### 3.5 New RPCs (all SECURITY DEFINER, `set search_path = public`)

| RPC | Grant | Purpose |
|---|---|---|
| `get_my_order(p_order_number text) → jsonb` | authenticated | Same jsonb shape as `get_order_by_token` (041) — status mapping, lines, coupons, ship fields, totals, paid — but predicate `orders.user_id = auth.uid()`; returns null-shape `{found:false}` on miss (no oracle). Includes `lookup_token`? **No** — portal links to `/track?t=` are unnecessary; portal renders its own doc. |
| `get_my_reward_summary() → jsonb` | authenticated | `{balance, entries[]}` for `auth.uid()` (entries also directly selectable via RLS; RPC keeps one round-trip + computes balance server-side). |
| `admin_adjust_reward_points(p_user_id uuid, p_points int, p_note text)` | authenticated (is_admin gate) | Manual credit/debit, note mandatory. |
| `admin_set_customer_discount(p_user_id uuid, p_scope text, p_percent numeric, p_label text, p_expires_at timestamptz default null)` | authenticated (is_admin gate) | Upsert-style: deactivates prior active row of same scope, inserts new. |
| `admin_deactivate_customer_discount(p_id uuid)` | authenticated (is_admin gate) | Soft off. |
| `effective_customer_discount(p_user_id uuid) → jsonb` | **service_role only** (revoked from all) | Single source of eligibility truth (checks active, window, business↔account_type). |
| `admin_set_profile_flags(p_user_id uuid, p_tier text, p_status text, p_account_type text, p_business_name text)` | authenticated (is_admin gate) | The only path that changes guarded profile columns. |

### 3.6 Required migrations (dependency-ordered)

Prod is at `040`; `041`/`042` are pending. New work starts at `043` and must apply
**after** 041+042 (043's trigger hooks assume 042's `recompute_order_totals`; the
portal's `get_my_order` mirrors 041's payload).

| # | File | Contents |
|---|---|---|
| 043 | `043_portal_identity_hardening.sql` | `customer_profiles` add `account_type`/`business_name`; `guard_customer_profile_columns()` trigger; `admin_set_profile_flags`; backfill `customer_profiles.customer_id` from CRM by contact + extend `handle_new_customer()`/`link_my_orders()` to keep it fresh; customer SELECT policy on `order_coupons`; `get_my_order()`. |
| 044 | `044_reward_ledger.sql` | `reward_ledger` + RLS + grants; earn/reversal hooks into `mark_order_paid`, `cancel_order`, `revert_order_status` (redefine, preserving current behavior + appending ledger logic); `get_my_reward_summary`; `admin_adjust_reward_points`; backfill earn rows for historical owned+paid orders (idempotent via the partial unique index). |
| 045 | `045_customer_discounts.sql` | `customer_discounts` + RLS + grants; `effective_customer_discount`; admin CRUD RPCs; `order_coupons.source` column (default `'code'`); `recompute_order_totals` aware of `source='account'` rows (treats them as percent rows in pass 2a, before code percents — deterministic ordering by `source desc, code`). |

Each migration is additive + idempotent (`if not exists` / `create or replace`,
matching house style). Rollback notes embedded per file. **Applying to prod is a
separate, explicitly-authorized manual step** (`supabase db push`), as is
redeploying `place-order`.

---

## 4. Frontend design

### 4.1 Portal page structure (new routes, all lazy, under one guard+layout)

```
/account                     → AccountLayout (guard: useCustomerAuth; logged-out → AuthCard)
  index                      → Overview: greeting, tier/account badges, reward balance card,
                               active-discount card, 3 most recent orders, address on file
  /account/orders            → Order history (all owned orders; OrderStatusChip; empty state)
  /account/orders/:orderNumber → Order detail: status step bar, payment status, lines,
                               itemized discounts, carrier + tracking link (or empty state),
                               address, Invoice/Receipt document + print/download
  /account/rewards           → Balance + full ledger history (earn/reversal/adjustment rows)
  /account/benefits          → Active lifetime/business discounts + "how discounts apply"
                               explainer (precedence copy) 
  /account/profile           → Edit name/phone/address (wires existing updateMyProfile)
```

- **`AccountLayout`** mirrors `AdminLayout`'s pattern: slim bar + `PillTabs`
  sub-nav; mobile-first (375px), works in light/dark via tokens only.
- **Guard**: layout-level (like `AdminGate` but customer-flavored) — children render
  only with `user && profile`; logged-out shows `AuthCard` in place. `/account`
  remains a public route path (no URL change, no SEO/backward-compat break).
- **Data access pattern**: existing house style — plain supabase-js in
  `useEffect` with a `cancelled` flag; no react-query.
- **Reuse**: extract `InvoiceDoc` + print CSS out of `TrackOrder.tsx` into
  `src/components/order/InvoiceDocument.tsx` consumed by BOTH `/track` and the
  portal (removes one of the audited duplications; `OrderView`'s
  `PrintableInvoice` consolidation is deferred — admin surface, higher risk).
  Promote `OrderStatusChip` from `AdminOrders.tsx` to `src/components/ui/`
  (re-export from the old location to avoid touching admin imports). Reuse
  `statusPresentation`/`STATUS_STEPS`/`carrierTrackingUrl` from `src/lib/tracking.ts`
  verbatim. Forms use `Field`/`PasswordField`/`Button`; confirmations use
  `useConfirm` (never native dialogs — iPhone admin/user constraint).

### 4.2 Backend service structure

- **`src/lib/accountData.ts`** (new): typed wrappers — `listMyOrders()`,
  `getMyOrder(orderNumber)`, `getMyRewardSummary()`, `listMyDiscounts()`,
  reusing the `OrderInvoice` type from `src/lib/tracking.ts`.
- **`place-order` edge function (edit)**: read optional `Authorization` bearer →
  `auth.getUser()` → stamp `user_id` on email match; fetch
  `effective_customer_discount(user_id)` via service client → apply as pass-2a
  percent → insert synthetic `order_coupons` row (`source='account'`). Coupon email
  fix rides along: pass `coupons` into `buildInvoiceHtml/Text` (audited drift #1).
- **`src/lib/placeOrder.ts` (edit)**: attach the current session's access token
  header when signed in.
- **Cart preview (`src/lib/coupons.ts`, edit)**: accept an optional account-discount
  input so the drawer/cart totals match the invoice for signed-in customers.

### 4.3 Admin capabilities (new)

In `AdminCustomerDetail` (linked-profile section appears when
`customer_profiles.customer_id` matches):
- View linked auth profile (tier/status/account_type/business_name) and change via
  `admin_set_profile_flags` (ConfirmModal-gated).
- Reward panel: balance, ledger, `admin_adjust_reward_points` form (note required).
- Discounts panel: active lifetime/business rules, set/deactivate via RPCs.

---

## 5. Risks

**Security risks (and dispositions)**
- Tier/status self-escalation (audited, real): fixed by 043 trigger. Must land
  **before** any perk keys off tier — and rewards/discounts do, so 043 precedes 044/045.
- Post-review CRITICAL (found by the security pass, fixed): the 043 guard was
  initially `BEFORE UPDATE` only, but 028's INSERT policy lets a customer create
  their own profile row with arbitrary guarded columns via a direct PostgREST
  POST (bypassing the app, which always sends `full_name`). Closed by adding a
  `BEFORE INSERT` guard branch (defaults guarded columns) + a partial unique
  index on `customer_id` (blocks admin-panel impersonation via a spoofed CRM
  link). Both in 043.
- Unverified-email account claiming: `link_my_orders`/stamping trust auth email;
  email confirmation ON in dashboard is load-bearing. Verified behaviorally in tests;
  called out in the final report as a deployment gate.
- New surfaces must not become oracles: `get_my_order` returns `{found:false}`
  uniformly; reward/discount RPCs never accept amounts from clients (points/percent
  only via admin-gated RPCs).
- Anon surface unchanged — explicitly re-checked at security review (no new grants
  to `anon`, no widening of `lookup_order`/`get_order_by_token`).

**Backward-compatibility risks**
- Redefining `mark_order_paid`/`cancel_order`/`revert_order_status` (044): ledger
  logic is appended inside; existing signatures, grants, and behavior preserved;
  guarded by the earn-once index. Admin flow regression-tested.
- `recompute_order_totals` change (045) must preserve 042 results exactly when no
  `source='account'` rows exist (unit-tested against 042's worked examples).
- `place-order` edit risks checkout — mitigations: auth stamping is strictly
  additive (absent/invalid header ⇒ exact current behavior); idempotency untouched;
  guest checkout path untouched.
- Uncommitted local diffs in working tree are responsive-CSS only (audited);
  workstreams must not revert them — no `git checkout --`/stash of user files.
- `/track` keeps working for guests (token path untouched); `InvoiceDoc` extraction
  is a pure move + prop-pass, verified visually on /track after.
- Prod is at 040: nothing in this work may be pushed/applied without authorization;
  all migrations inert as files.

---

## 6. Testing plan

Infrastructure to add (none exists): **Vitest** (`npm t`) for unit tests; a
**pgTAP-free SQL/RLS harness** = Vitest integration suite running against a local
`supabase start` stack (Docker) using two seeded customers + one admin, asserting
cross-customer denial at the PostgREST layer; **Playwright** (dep already present)
config + smoke journeys against `npm run dev` pointed at the local stack. If Docker
is unavailable on this machine, DB-level tests are written anyway, marked as the
verification gate, and reported as *deferred-blocked* — prod must not be used as a
test bed.

Minimum matrix (maps to the required list):
1. Unit: discount precedence math (free/fixed/percent/account-discount compounding,
   lifetime-vs-business best-of, caps), reward accrual math (`floor(cents/100)`),
   `couponBreakdown` parity fixtures.
2. RLS/integration: customer A reads own order ✓ / customer B's order ✗ (select +
   `get_my_order` both); same for order_lines, order_coupons, reward_ledger,
   customer_discounts; customer cannot UPDATE `tier/status/account_type`; ledger
   UPDATE/DELETE denied for everyone but definer paths; anon gets nothing new.
3. Flow: login; order history; order detail (paid + unpaid, tracked + untracked
   empty state); invoice view/print; reward earn on mark-paid; reversal on
   cancel/revert; admin manual adjustment; lifetime discount at checkout; business
   discount isolation (individual account gets none); precedence (code + account
   discount together); mobile 375px render; existing admin order flow + guest
   checkout unchanged.
4. Static gates every workstream: `tsc -b`, `vite build`, `eslint`.

---

## 7. Implementation phases & one-day priority plan

Phases (dependency order — matches the mandated priority):
- **P1 Identity & ownership** (043 + place-order stamping) → everything depends on it.
- **P2 Secure order/invoice/tracking access** (`get_my_order`, portal routes
  orders/detail, InvoiceDoc extraction).
- **P3 RLS verification** (test harness + isolation suite) — gate before features.
- **P4 Rewards** (044 + /account/rewards + admin adjustments).
- **P5 Discount frameworks** (045 + checkout/preview integration + /account/benefits).
- **P6 Admin panels + polish** (AdminCustomerDetail sections, profile edit page,
  empty states, mobile pass).

**One-day priority plan** (if only one day exists): morning — 043, place-order
stamping, `get_my_order`, order history + detail pages with invoice/tracking;
afternoon — RLS isolation tests + fixes; ship rewards ledger (044) if green;
defer discounts, admin panels, profile edit. Security and data integrity are never
traded for feature count.

## 8. Acceptance criteria (explicit)

- AC1: A signed-in customer sees exactly their own orders at /account/orders (RLS
  select), including guest orders placed earlier with their (verified) email.
- AC2: Order detail shows payment status, fulfillment status step bar, itemized
  lines and discounts, and totals matching the emailed invoice to the cent.
- AC3: Invoice/receipt document renders in-portal and prints (print CSS) without
  the lookup token; /track token flow still works unchanged.
- AC4: Carrier + tracking number display with a working deep link
  (`carrierTrackingUrl`); orders without tracking show a designed empty state
  (incl. `hand_delivered` no-link case).
- AC5: Customer B (authenticated) receives zero rows / `{found:false}` for
  customer A's order via table select AND `get_my_order`; anon receives nothing
  new anywhere. Proven by automated tests, not inspection.
- AC6: Reward balance = Σ ledger; earn exactly once per paid owned order
  (1 pt/$); reversal on cancel/revert; admin adjustment with mandatory note;
  customer sees balance + full history; ledger rows immutable.
- AC7: Active lifetime/business discounts visible at /account/benefits with an
  accurate "how discounts apply" explanation; business discounts never apply to
  individual accounts (and vice versa); best-of rule between the two scopes.
- AC8: Checkout for an entitled signed-in customer applies the account discount
  as pass-2a percent, itemized on all invoice surfaces; cart preview matches
  billed totals; guest checkout byte-for-byte behavior unchanged.
- AC9: Customer cannot change own tier/status/account_type (trigger blocks;
  test proves).
- AC10: `tsc -b`, `vite build`, eslint, and the full test suite pass; existing
  admin order flow and /track verified working post-change.
