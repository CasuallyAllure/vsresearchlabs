# Real-Database Integration Tier

The suites in `tests/integration/` and `tests/rls/` run against a **real local
Supabase stack** (Postgres + PostgREST + GoTrue via `supabase start`). They
exist to prove the semantics that the mock-based unit suites structurally
cannot:

| Suite | Proves |
| --- | --- |
| `tests/integration/validateCoupon.test.ts` | Every `validate_coupon` rejection reason, Postgres discount rounding, and the 057 write-time combinability resolution (exclusive / no-codes / no-promos / no-account flags) against real coupon rows. |
| `tests/integration/redeemCoupon.test.ts` | `redeem_coupon` is service-role-only; the atomic last-use race (max_uses=1 → second caller gets `exhausted` and writes **nothing**); once-per-contact re-check; affiliate commission math and `commission_percent` override. |
| `tests/integration/orderIdempotency.test.ts` | The 035 partial unique index actually raises SQLSTATE 23505 on a duplicate `idempotency_key` and exempts null keys — the constraint place-order's dedupe contract rests on. |
| `tests/integration/consumeRewardVoucher.test.ts` | `consume_reward_voucher` (064): the guarded `UPDATE … WHERE status='active'` flip, sequential double-spend losing, and **two concurrent consumers racing for one voucher with exactly one winner**. |
| `tests/integration/reconcileRewardVouchers.test.ts` | `reconcile_reward_vouchers` (067) classifies states A–D from real rows; `p_repair` re-inserts the exact reward row for corroborated State B and never touches `orders.discount_cents`; uncorroborated gaps are never auto-labeled. |
| `tests/integration/recomputeOrderTotals.test.ts` | `recompute_order_totals` through 052: flat-then-percent ordering, the reward fence, per-row `discount_cents` itemization, free-item line materialization, subtotal cap, and the 049 member free-shipping perk. |
| `tests/integration/createOrderFromInquiry.test.ts` | `create_order_from_inquiry` (061): fail-closed pricing (unpriced line rolls back the **whole** conversion including the order row), longest-dose variant matching, per-SKU override fallback, and the admin-only gate. |
| `tests/rls/portalIsolation.test.ts` | Portal RLS (migrations 043–045) — customer/order/reward isolation, guarded profile columns, admin reward RPCs. |
| `tests/rls/moneyIsolation.test.ts` | Money/PII RLS: anon reads nothing from any money table (orders — including by order number — lines, coupons, inquiries, vouchers, ledger, profiles, redemptions); customer A cannot see or mutate customer B's rows; service-role-only RPCs reject anon **and** signed-in customers; anon `lookup_order` returns exactly the 7 status/tracking columns and nothing else. |

## How the guard works (why these are safe)

Every suite requires all three of:

- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_ANON_KEY`
- `TEST_SUPABASE_SERVICE_ROLE_KEY`

and **refuses to run unless `TEST_SUPABASE_URL` resolves to a loopback host**
(`localhost` / `127.0.0.1` / `::1`). Without that env the suites self-skip
with a console note — `npm test` on a machine without Docker stays green and
offline. Never point these at a hosted project: the suites create and delete
auth users, coupons, orders, and vouchers via the service-role key.

`tests/setup.ts` (the offline guard that disables `fetch` for all vitest
runs) opens a **loopback-only** allowance when `TEST_SUPABASE_URL` is set to
a loopback URL. Non-loopback fetches still throw, so no test can reach a
hosted project even with the env set.

## How the CI job works

`.github/workflows/ci.yml` job `integration` (ubuntu-latest runners ship
Docker):

1. `npm ci`, then `supabase/setup-cli` (SHA-pinned action, CLI pinned to
   2.109.1).
2. `supabase start` — boots the full local stack and applies **every**
   migration in `supabase/migrations/` to a fresh Postgres. No `-x`
   exclusions: reliability over the ~1 minute the skips would save.
3. `supabase status -o env` is eval'd and the three `TEST_SUPABASE_*` vars
   are derived from `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` (with
   `PUBLISHABLE_KEY` / `SECRET_KEY` as newer-CLI fallbacks). Missing keys
   fail the step loudly — the job can never degrade into a silently-skipping
   green no-op.
4. `npx vitest run tests/integration tests/rls` — no coverage flags;
   coverage is the `checks` job's ratchet.

## Running locally

Docker is required (`supabase start` runs the stack in containers).

1. Install a Docker runtime — Docker Desktop, or `brew install colima docker
   && colima start`.
2. From the repo root: `supabase start` (first run pulls images; applies all
   migrations).
3. Read the credentials: `supabase status` (or `supabase status -o env`).
4. Export the three vars and run the suites:

   ```sh
   eval "$(supabase status -o env)"
   export TEST_SUPABASE_URL="$API_URL"
   export TEST_SUPABASE_ANON_KEY="$ANON_KEY"
   export TEST_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
   npx vitest run tests/integration tests/rls
   ```

5. `supabase stop` when done (`supabase db reset` re-applies migrations to a
   clean slate if fixtures ever leak).

Suites clean up after themselves (`afterAll`, best-effort), and every fixture
carries a per-run random id, so re-runs and parallel suite files don't
collide. A crashed run can leave rows behind — `supabase db reset` is the
reset lever; it is a disposable local database by design.

## Conventions for new suites

- Copy the guard from `tests/integration/env.ts` (integration) or the header
  of `tests/rls/moneyIsolation.test.ts` (RLS) — env + loopback + skipIf +
  console note. Never construct clients at module scope.
- Create every fixture through the service-role client inside `beforeAll`,
  keyed by a `randomUUID()` run id; delete in `afterAll`.
- Assert with `toContain`-style checks when the RPC scans globally (e.g.
  reconciliation): sibling suites share the database.
- Keep `orders.discount_cents` equal to the sum of the order's
  `order_coupons.discount_cents` in fixtures unless the test is specifically
  about a mismatch — the 067 reconciliation sweep scans the whole DB.
