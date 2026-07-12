/**
 * Reward accrual rule — test fixture only.
 *
 * There is no TypeScript implementation of this rule: it lives entirely in
 * SQL, in `mark_order_paid()` (supabase/migrations/044_reward_ledger.sql,
 * line ~120): `v_points := floor(v_amount / 100.0)::integer`. This fixture
 * mirrors that formula so the accrual math has a pure-function unit test
 * independent of a running Postgres instance. If migration 044 changes the
 * formula, this fixture (and its tests) must be updated to match.
 */
export function rewardPointsForCents(invoiceAmountCents: number): number {
  return Math.floor(invoiceAmountCents / 100);
}
