# Prepared Cart Blueprint — admin builds a member's cart, member checks out normally

**Status:** DRAFT FOR OWNER REVIEW (2026-07-30). Not approved; not scheduled.
**Baseline:** `feat/membership-x-ws3` (Train 2). Migrations 070–079 live in this tree. **`080` is claimed by the in-flight drift fix — this feature starts at `081`.**
**Prime directive:** the prepared cart is a **shopping list, not a quote**. It carries `(sku, dose, quantity)` and nothing else. The moment the member opens it, every price, discount, coupon and reward resolves through the paths that already exist. There is no second checkout, no second price, no second store.

---

## What we're building

The owner opens `/admin/members`, picks a member, and the expanded row grows one new action: **Build cart**. He picks compounds and doses the same way he does on the `+ New order` screen, writes an optional note, and sends it. The member gets a branded email, taps it, signs in, and lands on `/cart` with exactly those items already in the cart. From there nothing is special: the member discount applies, coupons apply, rewards points accrue on payment, the invoice is the same invoice. The only thing that changes about checkout itself is that a signed-in member's name, email, organization and shipping address are **already filled in** — editable, never forced.

---

## What already exists vs. what's new

| Piece | Status | Evidence |
|---|---|---|
| Member roster + expandable row + shared write panels | **Exists** | `src/pages/admin/AdminMembers.tsx:243-289` (rows), `:326-382` (`MemberExpand`) |
| Admin house-style atoms (`SubNav`, `Panel`, `RowAction`, `Chip`, `Tile`) | **Exists, reuse verbatim** | `src/pages/admin/members/ui.tsx:12-100` |
| `ConfirmModal` / `useConfirm` already wired into the expanded row | **Exists** | `AdminMembers.tsx:26`, `:327` |
| Compound → dose picker with public/priced filtering | **Exists but DUPLICATED TWICE** | `src/pages/admin/AdminNewOrder.tsx:72-111` is a near-verbatim copy of the *unexported* `ItemizedEditor` internals at `src/pages/admin/OrderView.tsx:1218-1250` (`function ItemizedEditor` declared at `OrderView.tsx:1183`, no `export`). A third consumer means a third copy unless it is extracted first. |
| Canonical price resolution | **Exists, mandatory** | `effectiveTierPriceCents` — `src/lib/pricing.ts:43` |
| Dose-safe cart line construction | **Exists, mandatory** | `variantProduct` — `src/lib/cartActions.ts:43` |
| "Map a stored list of lines back into the cart" | **Exists — this is the big reuse** | `src/lib/reorder.ts` (`planReorder`, pure), consumed at `src/pages/account/AccountOrderDetail.tsx:112-124` — already loops `variantProduct(item.product, item.dose)` → `addToCart` |
| Cart store + localStorage persistence | **Exists** | `src/hooks/useCart.ts:46-140`; persisted under `siteConfig.storage.cartKey` |
| Branded transactional email w/ admin gate + Resend | **Exists, copy structurally** | `supabase/functions/send-invite/{index,handler}.ts`; shell `_shared/emailBrand.ts:36,60`; better parameterized HTML shell at `supabase/functions/member-automations/templates.ts:64-104` |
| `email_log` with `unique (recipient, kind, period_key)` idempotency | **Exists** | `supabase/migrations/075_member_automations.sql:43-60` |
| Token-link email precedent (`?t=<token>`) | **Exists** | `_shared/invoiceEmail.ts:379,385`; `send-order-invoice/handler.ts:181-182` |
| Member discount / rewards / coupons on normal checkout | **Exists, untouched** | see *Rewards and discount: proof* below |
| Server-side price re-verification at checkout | **Exists, fail-closed** | `place-order/handler.ts:554-563`, `place-order/priceCheck.ts:1-10` |
| **Checkout prefill from profile** | **NEW (and overdue)** | `src/pages/CartPage.tsx:75` destructures only `{ user }` from `useCustomerAuth()`; `profile` is never read. Form state `CartPage.tsx:133-141` starts empty for everyone. Same at `src/layout/CartDrawer.tsx:86`, `:119-126`. |
| **`prepared_carts` table + token + 2 RPCs** | **NEW** | migration `081` |
| **Admin "Build cart" composer in the expanded row** | **NEW UI**, but ~all of its internals are extraction, not invention | |
| **`send-prepared-cart` edge function** | **NEW**, structural copy of `send-invite` | |
| **`/account/prepared` claim route** | **NEW**, small (≈80 lines) | |

**Honest split:** roughly **60–65% reuse**. The genuinely new code is one table, two RPCs, one edge function, one small claim page, and one admin panel. The two hardest-looking parts — dose-safe line construction and "does checkout still work normally" — are **already solved** and require no new code at all.

---

## Workstreams

Independently shippable. **WS-1 ships first and alone**: it is small, it improves every member order immediately, and a link that drops someone into a cart and then makes them retype their shipping address defeats the entire point of the feature.

| WS | What | Files touched | Tier | Gate |
|---|---|---|---|---|
| **WS-1 Checkout prefill** | Read `profile` (not just `user`) in both checkout forms and prefill name / email / organization / address. **Populate-then-leave-alone:** prefill only fields that are still empty, only once per profile arrival (a `prefilledRef`), never on re-render. Submit continues to read form state exclusively. | `src/pages/CartPage.tsx` (`:75`, `:133-141`), `src/layout/CartDrawer.tsx` (`:86`, `:119-126`), new `src/lib/checkoutPrefill.ts` (pure mapper `CustomerProfile + User → prefill fields`) | **Sonnet** | Unit tests on the pure mapper (empty profile, partial profile, `address_line2` present/absent, non-US country); component test proving an edited field is **not** re-clobbered and that the submitted payload equals the edited value, not the profile value |
| **WS-2 Extract the dose picker** | Lift the compound/variant index + dependent selects out of `AdminNewOrder.tsx:72-111` into a shared `src/components/admin/VariantPicker.tsx`. Repoint `AdminNewOrder`. Do **not** touch `OrderView`'s copy in this WS (money-adjacent, separate PR). | `AdminNewOrder.tsx`, new `VariantPicker.tsx` | **Haiku** (mechanical) · Sonnet review | `/admin/orders/new` behaves byte-identically; existing tests green |
| **WS-3 Data layer (081)** | `prepared_carts` table + `admin_create_prepared_cart` + `claim_prepared_cart`. Revoke-then-grant throughout. Add both to the `functionGrantHardening` allowlist. | `supabase/migrations/081_prepared_carts.sql`, `tests/integration/functionGrantHardening.test.ts` | **Sonnet** build · **database-reviewer + security-reviewer required** | Real-Postgres DB-tier tests: wrong user cannot claim; expired cannot claim; revoked cannot claim; anon cannot execute either RPC |
| **WS-4 Admin composer** | "Build cart" `RowAction` in `MemberExpand` → inline `Panel` with `VariantPicker` rows + qty + note + Send. `ConfirmModal` on send (never `window.confirm`). | `AdminMembers.tsx` (`MemberExpand`, `:326-382`), new `src/pages/admin/members/PreparedCartPanel.tsx` + `usePreparedCart.ts` | **Sonnet** | Members layout unchanged when the panel is closed; 375px renders without horizontal scroll |
| **WS-5 Email** | `supabase/functions/send-prepared-cart/{index,handler}.ts`, structural copy of `send-invite`. `requireAdmin`. Resend. Logs `email_log` kind `prepared_cart`, `period_key = 'pc-' || cart id`. | new function dir, `docs/SUPABASE_SECRETS.md` note | **Sonnet** | Unit tests on the Deno-free handler factory (repo convention — see `tests/unit/sendInviteHandler.test.ts`) covering: no admin → 401, no `RESEND_API_KEY` → 500, Resend failure → 502, duplicate send → skipped |
| **WS-6 Claim route** | `/account/prepared` inside `AccountLayout` (so the signed-out state reuses the existing `AuthCard` for free — `AccountLayout.tsx:102-109`). Read token from the **hash**, capture to a ref on first mount, `claim_prepared_cart`, add lines via `variantProduct`, `history.replaceState` to scrub, `navigate('/cart')`. | new `src/pages/account/AccountPreparedCart.tsx`, `src/App.tsx` (one route line after `:108`) | **Sonnet** | E2E: signed-out click → auth card → sign in → lands on `/cart` with the right lines and correct prices; URL contains no token afterwards |

**Deploy trains:** T1 = WS-1 alone (no migration, benefits every member order). T2 = WS-2 (pure refactor). T3 = WS-3 + WS-4 + WS-5 + WS-6 together (the feature is not useful in pieces).

---

## Data model

### Migration `081_prepared_carts.sql`

```sql
create table if not exists prepared_carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  lines       jsonb not null,                    -- [{sku, dose, quantity}] — NO PRICES
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  revoked_at  timestamptz,
  first_opened_at timestamptz,
  last_claimed_at timestamptz,
  claim_count integer not null default 0
);
create unique index if not exists prepared_carts_token_key on prepared_carts (token);
```

**`lines` stores no money.** This is not a stylistic choice — it is forced by `place-order`:

> `verifyLinePrices` rejects the *entire order* (HTTP 409) when a line's `unitPriceCents` is not byte-identical to the live catalog price — `place-order/handler.ts:554-563`, policy stated at `place-order/priceCheck.ts:1-10` ("FAIL CLOSED … to the cent, no tolerance").

A baked-in negotiated price would therefore not produce a discount; it would produce an order the member **cannot place**. A negotiated price must travel as a **coupon code** — the only client-supplied discount channel the server accepts (`handler.ts:703-706`, `:870-881`). If the owner wants a bespoke price on a prepared cart, the answer is "attach a coupon code", not "type a number".

**Token generation follows the one pattern this repo has:** the concatenated-`gen_random_uuid()` column default from `supabase/migrations/019_order_lookup_token.sql:30-33`. That is ~244 bits of entropy (two UUIDv4s at 122 bits each — 019's comment claims 256; it is wrong, and this document will not repeat it). There is no `pgcrypto` in the tree and no shared token helper anywhere in `src/` or `supabase/functions/_shared/`.

**RLS + grants — revoke BEFORE grant, always:**

```sql
alter table prepared_carts enable row level security;
create policy "Admins read prepared carts" on prepared_carts for select using (is_admin());
revoke all on prepared_carts from anon, authenticated;   -- MUST come first
grant select on prepared_carts to authenticated;         -- RLS narrows to admins
```

The `revoke all` is not defensive politeness. This schema carries a bootstrap `ALTER DEFAULT PRIVILEGES … grant all on tables to anon, authenticated, service_role`, so a bare `create table`/`create view` is born **fully writable by anon**, and `grant select` is a no-op on top of it. This was a live, empirically-proven vulnerability last week: `POST /rest/v1/public_variant_overrides` returned 201 and wrote `price_cents = 1` into `product_variant_stock`; `GET /rest/v1/customer_with_history` returned every customer's name, email, phone and order history despite RLS. Read `supabase/migrations/078_view_grant_hardening.sql:4-41` before writing a line of `081`. The canonical fixed form is `078:75-76`, `:84-85`, `:97-98`. `081` must also leave `admin_audit_public_view_write_grants()` (`078:146-169`) returning zero rows — `tests/integration/viewGrantHardening.test.ts` asserts it.

### RPCs

**`admin_create_prepared_cart(p_user_id uuid, p_lines jsonb, p_note text) returns jsonb`**
`security definer set search_path = public, auth`. Guard: `if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;` (the form used at `041_admin_orders_ship_confirm.sql:55-58`). Validates every line has a non-empty `sku` and `quantity > 0`; rejects an empty array. Writes `created_by = auth.uid()`, calls `log_audit('member.prepared_cart.created', ...)`. Returns `{cart_id, token}`.

**`claim_prepared_cart(p_token text) returns jsonb`**
`security definer set search_path = public, auth`. **Authenticated only, and bound to the owner:**

```sql
where pc.token = v_token
  and pc.user_id = auth.uid()      -- ← the token alone is NOT sufficient
  and pc.revoked_at is null
  and pc.expires_at > now()
```

This is the single most important design decision in the feature, and it is a deliberate *departure* from `/track`'s bearer token. `confirm_order_shipping` (`041:177-185`) and `get_order_by_token` (`041:306`) treat the token as the whole credential: possession is authorization, there is no expiry, no consumption, no revocation. That is defensible for an order-status page. It is **not** defensible here, because the emailed link is delivered to an inbox and the token would ride in the URL across a sign-in.

By requiring `auth.uid() = user_id`, a leaked token is worth nothing without the member's session. Belt and braces, per the constraint that the token must not leak:

1. **Hash fragment, not query param.** `/account/prepared#t=<token>`. A fragment is never sent to a server and never appears in a `Referer` header. `/track?t=` is a query param (`src/pages/TrackOrder.tsx:68-72`) with **no** `replaceState` scrubbing anywhere — do not copy it.
2. **Capture to a ref on first mount, then scrub** with `history.replaceState` before any navigation (precedent: `src/hooks/useCompoundShareRoute.ts:90`). Capturing first matters because the sign-in flow may rewrite the URL underneath the component.
3. **Bound to the user** (above), so even a total failure of 1 and 2 is not a compromise.

Errors return `{ok:false, reason}` rather than raising — the `041:148-153` convention, so there is no error-shape oracle distinguishing "wrong token" from "wrong user" from "expired".

Grants, in the `079` canonical form (full named-parameter signatures, three-role revoke, then narrowest grant):

```sql
revoke execute on function admin_create_prepared_cart(p_user_id uuid, p_lines jsonb, p_note text) from public, anon, authenticated;
grant  execute on function admin_create_prepared_cart(p_user_id uuid, p_lines jsonb, p_note text) to authenticated;

revoke execute on function claim_prepared_cart(p_token text) from public, anon, authenticated;
grant  execute on function claim_prepared_cart(p_token text) to authenticated;   -- NOT anon
```

`revoke execute` is mandatory and separate from the table channel: PostgreSQL's own built-in default for a new function is `EXECUTE TO PUBLIC`, *and* the CI/hosted bootstrap adds `alter default privileges … grant all on functions to anon, authenticated, service_role`. `079_function_grant_hardening.sql:34-56` found **70 of 80** public routines anon- or authenticated-callable, including `_apply_order_stock` (anon could drain inventory) and `log_audit` (anon could forge the audit trail). `079:88-105` documents that the prospective `alter default privileges … revoke execute` is a **no-op** — ALTER DEFAULT PRIVILEGES can only add, never subtract. **The real guard is the test.** Both new functions must be added to the allowlist in `tests/integration/functionGrantHardening.test.ts:48-54` or CI fails by name; `claim_prepared_cart` goes in the *authenticated* list, never `ANON_CALLABLE`.

No throttling is proposed. `get_order_by_token` has none either (`079:125` states the bet explicitly), and here the token is additionally useless without the matching session. If a future variant of this feature ever drops the `user_id` binding, the reusable throttle is `lookup_order_bump` + `lookup_order_attempts` (`066:33-56`), which takes an arbitrary bucket string and window.

---

## The four owner defaults

Written as decided-unless-objected.

**1. The link expires in 14 days.**
Long enough to survive a weekend, a vacation, and a "I'll do it Monday"; short enough that a stale list doesn't resurface at prices from a month ago. Prices are resolved at open time, not at build time, so an old link is never *wrong* — it's just stale in composition. `expires_at timestamptz not null default now() + interval '14 days'`.
*If the owner disagrees:* it is a column default and a single `claim_prepared_cart` predicate. Changing it to 30 days or "never" is a one-line migration; making it *per-cart* means adding a duration control to the composer — slightly more work, still small.

**2. The link is reusable.**
The member opens the email on a phone, then finishes on a laptop. Single-use would strand them, and the failure mode is silent and infuriating. We record `claim_count`, `first_opened_at`, `last_claimed_at` for visibility instead of consuming the row. Re-claiming is idempotent in intent but **additive in effect** — see default 3.
*If the owner disagrees:* add `consumed_at` and a `claim_count = 0` predicate. But then also add a member-facing "this link was already used" screen, or support gets the call.

**3. Prepared items are ADDED to whatever is already in the cart, never wiped.**
The cart is the member's own property; silently deleting something they added themselves is the kind of thing that loses trust permanently. The claim screen shows what was added and what was already there before it hands off to `/cart`. Re-claiming the same link adds the same items again — the cart store dedupes by `product.id` and increments quantity (`src/hooks/useCart.ts:51-64`), so a double-open **inflates quantity**. WS-6 must therefore guard: if `claim_count > 0`, show "this cart was already loaded — load it again?" and require a tap rather than auto-adding.
*If the owner disagrees:* replacing the cart is easier to implement (`clear()` then add) but needs a `ConfirmModal` warning about the items being discarded. Never do it silently.

**4. Prices are re-verified server-side at checkout.**
This is not a choice we are making — it is already true and enforced fail-closed (`place-order/handler.ts:554-563`). The design consequence is that the prepared cart stores no prices at all, and the member is quoted the live price at open time and billed the live price at submit time. If the price moved between building the cart and the member opening it, the member sees the new price. There is no "locked-in price" and building one would require touching the money path.
*If the owner disagrees* and wants a genuinely held price: the honest mechanism is a **coupon code** attached to the prepared cart (server-priced via `validate_coupon`, `031_coupons_affiliates.sql:145`), not a stored number. That is a real but contained addition: one nullable `coupon_code` column plus auto-applying it on claim.

---

## Rewards and discount: proof, not assumption

**Headline: yes — a normally-checked-out prepared cart accrues points and receives the member discount with zero special handling, because nothing in the money path knows or asks how the cart lines got there.** There is no cart table, no provenance field, no source flag anywhere in the payload (`place-order/handler.ts:456`; per-line inputs are only `sku, name, category, quantity, unitPriceCents, note, fast`).

The chain, traced:

1. **Identity.** `place-order` reads the `Authorization` bearer and, when it is not the anon key, round-trips it through `auth.getUser()` → `stampedUserId` (`handler.ts:607-632`). The client attaches this automatically via `supabase.functions.invoke` (`src/lib/placeOrder.ts:97-105`).
2. **Member discount.** `effective_customer_discount(p_user_id => stampedUserId)` (`handler.ts:639-641`), live definition `supabase/migrations/074_tier_discount_floor.sql:32` (which supersedes 069). Keyed **solely on the user id** — member floor 15%, pro 20%, a higher admin rule wins (`074:58-83`). Applied in `computeOrderTotals` (`handler.ts:1000-1011`) and materialized as an `order_coupons` row with `source='account'` (`handler.ts:1216-1226`).
3. **`orders.user_id` stamp.** `handler.ts:1111`.
4. **Points.** Awarded not at placement but when the admin marks the order **paid**: `mark_order_paid()` mints `reward_ledger(kind='earn')` at `floor(invoice_amount_cents / 100)` — `supabase/migrations/044_reward_ledger.sql:113-127` — guarded by `if v_user_id is not null` (`044:119`) and made earn-once by the unique index at `044:53-54`.

**The single precondition is that `orders.user_id` is not null**, which follows from the member being signed in — which this feature guarantees, since `claim_prepared_cart` cannot even run without a session.

**Three things that WOULD break it, loudly:**

- **If the member checks out signed out.** No JWT → no `stampedUserId` → no discount, no free shipping, and **no points ever**, because `mark_order_paid` short-circuits on a null `user_id` and a later `link_my_orders()` claim (`028_customer_accounts.sql:153-179`) does not retroactively mint points. WS-6 must land the member in an authenticated session and the cart page must not encourage signing out.
- **If a prepared line carries a baked price.** 409, whole order refused (see Data model). Hence: no prices in `lines`.
- **If a prepared line loses its dose.** `priceCheck` resolves the dose out of the product *name* (`priceCheck.ts:17-21`); a line named "BPC-157" with no dose resolves to nothing → `dose_unresolved` → 409. Hence `variantProduct` is non-optional.

Two more behaviors worth stating so nobody is surprised: **B2G1 and the account discount never stack** — the server computes both and zeroes the loser, tie goes to B2G1 (`handler.ts:970-993`; client mirror `src/lib/b2g1Preview.ts:154-166`) — and **wholesale or bundle pricing nulls the account discount outright** (`handler.ts:822-842`, `:848-859`). A prepared cart of five-packs will therefore show no member-discount row. That is correct existing behavior, not a bug introduced here.

---

## Checkout prefill (WS-1), specified

**Confirmed:** `src/pages/CartPage.tsx:75` is `const { user } = useCustomerAuth();` — `profile` is available on the same object (`src/lib/customerAuth.ts:45,54`) and is never destructured. Form state initializes empty at `CartPage.tsx:133-141`. `src/layout/CartDrawer.tsx:86` has the identical omission with its own form at `:119-126`. Signed-in members retype their address on every single order.

Available fields — `CustomerProfile`, `src/lib/customerProfile.ts:14-34`: `full_name`, `phone`, `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`, `business_name`, `account_type`. Email comes from `user.email`.

| Form field | Source |
|---|---|
| `name` (`CartPage.tsx:133`) / `firstName`+`lastName` (`CartDrawer.tsx:119-120`) | `profile.full_name` (drawer splits on the last space) |
| `contact` / `email` | `user.email` |
| `organization` | `profile.business_name` |
| `shipStreet` / `street` | `[address_line1, address_line2].filter(Boolean).join(', ')` — neither form has a line-2 input today |
| `shipCity`, `shipState`, `shipZip` | `city`, `state`, `postal_code` |
| `phone` | **not collected at checkout today** — do not add a field in this WS |

**Rules, in order of importance:**

1. **Prefill populates state; it never bypasses state.** The submitted payload already reads only the state variables (`CartPage.tsx:200-208`), so "what is saved is whatever is in the form at submit" is true *by construction* the moment prefill writes into `useState` and nowhere else. Any implementation that reads `profile` inside `handleSubmit` is wrong and must be rejected in review.
2. **Fill only empty fields, only once.** A `prefilledRef` guard plus an "is this field still empty" check. Someone shipping one order to a different lab must be able to clear a field and have it stay cleared.
3. **Everything stays editable.** No `readOnly`, no `disabled`, no "use my saved address" toggle that hides the values.
4. **`ship_country` is hard-coded `'US'`** at `CartPage.tsx:208`. If `profile.country` is set and is not US, prefilling a US-only payload would silently mis-ship. In this WS: prefill the address, and if `profile.country` is present and not `US`, surface it in the form rather than swallowing it. Fixing the country field properly is out of scope — flag it, don't hide it.
5. **The pure mapper lives in `src/lib/checkoutPrefill.ts`** so both forms share one behavior and the tests are cheap.

**Noted, not fixed here:** `CartDrawer` is mounted permanently inside `GlobalHeader` (`src/layout/GlobalHeader.tsx:121`), so on `/cart` there are **two** `useCustomerAuth()` instances live at once, each independently running `getSession → loadMyProfile() → link_my_orders()` (`customerAuth.ts:86-104`). That is the exact per-instance-fetch trap `authPresence.ts:2-14` was written about, at a smaller scale. WS-1 does not make it worse, but it also does not fix it. The clean fix is a single provider above both, mirroring `src/lib/accountSession.ts` — propose it as its own workstream, do not smuggle it into WS-1.

---

## Open questions for the owner

Only decisions the code cannot answer.

1. **Should a prepared cart be able to carry a negotiated price?** As designed it cannot — prices are always live catalog prices, because `place-order` refuses anything else. If the owner wants "I'll do these three at a special number", the answer is a coupon code attached to the cart. Is that acceptable, or is a per-cart price genuinely needed? (It changes the shape of the feature.)
2. **Can the owner see and revoke a prepared cart after sending it?** The table supports it (`revoked_at`). Is a "Sent carts" list worth a sub-view, or is fire-and-forget enough for the current member count?
3. **What should the member see if the link has expired or was revoked?** "This prepared order is no longer available — contact us", or a self-service "ask for a new one"?
4. **Does the member get a notice when the owner builds them a cart, if they never open the email?** There is no follow-up automation proposed. Adding one means registering a sixth automation kind, which touches four places (`member-automations/templates.ts:18,26,112`, `075:216`, plus a seed row at `075:85-87`) — real work, probably premature.
5. **Copy and subject line for the email.** The register is research-supply, not retail ("Your lab's prepared order is ready to review", not "We picked these for you!"). Owner's call on wording.

---

## Risks and traps

Every item below traces to an incident this project has already paid for once.

| Trap | Concrete form here | Guard |
|---|---|---|
| **Bare `add()` drops the dose → $0 order lines (production incident)** | Claiming a prepared cart must construct every line with `variantProduct(product, dose)` — `src/lib/cartActions.ts:43`. The header comment at `cartActions.ts:1-24` is the incident write-up. Copy the loop already proven at `AccountOrderDetail.tsx:117-122`. | Test asserting every claimed line's `product.id` contains `::<dose>` and `name` contains `— <dose>`; plus a `dose_unresolved` end-to-end case |
| **Formula-only pricing ignores admin overrides (two separate price bugs)** | The composer's variant list and the claim path must both resolve through `effectiveTierPriceCents` (`src/lib/pricing.ts:43`), never `tierPriceCents` (`pricing.ts:28-36`), which is still the placeholder hash formula `perMg = 7 + (hash % 6)` and mints synthetic money for any variant lacking an override. `AdminNewOrder.tsx:78` already drops null-priced variants — keep that filter. | Review gate: any diff importing `tierPriceCents` into new code is rejected |
| **Client-supplied prices** | `lines` jsonb carries no price field. A "unit price" input in the composer must not exist. | Schema shape; DB-tier test rejecting a line object containing a price key |
| **Coupon pricing from the client** | Only a coupon **code** ever travels (`CartPage.tsx:215`, `CartDrawer.tsx:215`; server re-resolves at `handler.ts:870-881`). If option 1 above is approved, the prepared cart stores a `coupon_code text`, never a percent or an amount. | `src/lib/coupons.ts:112-115` states the rule |
| **`ALTER DEFAULT PRIVILEGES` → anon-writable new relation** | `081`'s table must `revoke all from anon, authenticated` **before** granting. Pattern: `078:75-76`. Bug class explained at `078:4-41`; it was live in production last week. | `admin_audit_public_view_write_grants()` returns zero rows; `tests/integration/viewGrantHardening.test.ts` |
| **Same bug class for functions** | Both new RPCs need `revoke execute … from public, anon, authenticated` in full-signature form, then the narrowest grant. `079` found 70/80 routines exposed. The prospective ADP revoke is a documented **no-op** (`079:88-105`) — the test is the guard. | `tests/integration/functionGrantHardening.test.ts:48-54` allowlist |
| **Token in history / `Referer`** | Hash fragment (`#t=`), captured to a ref on first mount, `history.replaceState` scrub before navigating, **and** `user_id`-bound claiming so the token is not a bearer credential. Do **not** copy `/track?t=` (`TrackOrder.tsx:68-72`) — it is a query param with no scrubbing. | E2E asserts `location.href` contains no token after claim |
| **Native dialogs silently no-op on iOS** | The composer's send confirmation and the "already loaded — load again?" prompt use `ConfirmModal`. `useConfirm` is already imported in `MemberExpand` (`AdminMembers.tsx:26`, `:327`). Zero `window.confirm` / `window.prompt`. | Lint/grep gate in review |
| **Leaf components calling `useCustomerAuth()`** | `AccountPreparedCart` renders under `AccountLayout` → it must read `useAccountSession()` (`src/lib/accountSession.ts:46`), never call the hook again. The rationale — three instances on `/account/profile`, each re-running `loadMyProfile` + `link_my_orders` — is at `accountSession.ts:1-23`. | Review gate |
| **Members layout is locked** | The blueprint of record states the roster layout is unchanged (`docs/MEMBERSHIP_EXPERIENCE_BLUEPRINT.md:33`). "Build cart" is a `RowAction` inside the already-expanded row and a `Panel` in the existing grid — no new page, no new nav entry, no restyling. | Owner visual check at 375px |
| **Coverage ratchet** | `vitest.config.ts:53` — `lines 99 / statements 98.5 / branches 95.5 / functions 98.5`. Every new module ships with tests. Never lowered. | CI |
| **Migration numbering** | `081`. `080` is claimed by the in-flight drift fix (it is not in this worktree — do not "helpfully" take it). The sequence is not dense: `032, 033, 060, 062` are absent (`065:5` explains one). Run `supabase migration list` before pushing. | |
| **Stale doc comment (found in passing)** | `place-order/handler.ts:27-33` still claims a price mismatch "does not block the order… it flags the business email". That has not been true since the fail-closed change at `:545-563`. Anyone reading the header for this feature gets the wrong answer. Worth a one-line comment fix in its own PR. | |
| **Two copies of the dose picker, about to become three** | `AdminNewOrder.tsx:72-111` ≈ `OrderView.tsx:1218-1250` (`ItemizedEditor`, unexported at `:1183`). WS-2 exists specifically so this feature does not add a third. | WS-2 gates WS-4 |

---

## Test plan

**Unit**
- `checkoutPrefill` mapper: null profile · profile with only `full_name` · `address_line2` present and absent · non-US `country` · empty strings vs nulls.
- `claim → cart lines`: given `[{sku, dose, quantity}]` and the catalog, assert each produced line came through `variantProduct` — `product.id` ends `::<dose>`, `product.name` contains `— <dose>`, `priceCents` equals `effectiveTierPriceCents(product, dose)`. **This is the `$0`-line regression test**; a bare `add()` implementation fails it.
- Unknown sku / unpriced dose / `quantity <= 0` → skipped and reported, never added as a priceless line (mirrors `planReorder`'s `skipped` contract, `src/lib/reorder.ts:38`).
- `send-prepared-cart` handler factory (Deno-free, per `tests/unit/sendInviteHandler.test.ts`): 401 without admin · 500 with no `RESEND_API_KEY` · 502 on Resend failure · duplicate `email_log` insert → skip, not double-send.

**Integration (real Postgres — the tier CI requires)**
- `admin_create_prepared_cart`: non-admin → raises · empty `lines` → raises · line without `sku` → raises · success writes `created_by` and an `audit_log` row.
- `claim_prepared_cart` — **the token gate, proven closed four ways**:
  1. correct token, **wrong** signed-in user → `{ok:false}`, no lines returned;
  2. correct token, **anon** (no session) → RPC not executable at all (grant-level);
  3. correct user, **expired** cart → `{ok:false}`;
  4. correct user, **revoked** cart → `{ok:false}`.
  Plus: all four failures return the **same** `reason` shape, so nothing distinguishes "wrong token" from "wrong user".
- Grant hardening: `prepared_carts` appears with no write privileges for anon/authenticated in `admin_audit_public_view_write_grants()`; both RPCs appear in the correct allowlist bucket in `functionGrantHardening.test.ts` and `claim_prepared_cart` is absent from `ANON_CALLABLE`.

**E2E (Playwright)**
- Admin builds a two-line cart for a roster member → email function invoked with the right recipient and a link containing `#t=`.
- Signed-out member opens the link → `AuthCard` → signs in → lands on `/cart` with both lines at the **live catalog prices**, and `location.href` contains no token.
- Member with three existing cart items claims a two-line prepared cart → cart has five lines, none of the original three removed (default 3).
- Second claim of the same link prompts before adding again; declining leaves the cart unchanged.
- Full checkout of a claimed cart → order created with `user_id` set, an `order_coupons` row with `source='account'` present, and after `mark_order_paid` a `reward_ledger` `earn` row equal to `floor(invoice_amount_cents / 100)`. **This is the owner's core requirement, asserted end to end.**
