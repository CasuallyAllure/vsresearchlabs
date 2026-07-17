-- 064_reward_voucher_consume.sql
-- ---------------------------------------------------------------------------
-- Atomic reward-voucher consume — closes the checkout TOCTOU double-spend
-- (pro review 2026-07-17 #1, reserved as "060" in the blueprint but numbered
-- 064 because 060/062 were never written and prod is already at 063).
--
-- Before this, place-order read the voucher `active` early, applied the 40%
-- reduction to the order, and only at the end ran a filtered
-- `update … where status='active'` whose result was checked for a DB ERROR but
-- never for ZERO ROWS MATCHED. Two concurrent checkouts could therefore both
-- read the one active voucher and both keep the discount — one voucher, spent
-- twice — because nothing gated the reduction on a successful consume.
--
--   • consume_reward_voucher(p_voucher_id, p_order_id) — single guarded
--     UPDATE … RETURNING. Row-level locking makes exactly ONE concurrent
--     caller win the active→used flip; every other caller gets ok:false and
--     place-order rolls the reward off its order (same fail-closed shape as
--     the redeem_coupon rollback).
--   • Service-role only (place-order). Revoked from public/anon/authenticated —
--     same posture as the 050 table grants ("writes only through SECURITY
--     DEFINER code").
--
-- Requires 050 (reward_vouchers). Additive + idempotent.
--
-- Rollback: drop function consume_reward_voucher(uuid, uuid); the old
-- place-order builds never call it.
-- ---------------------------------------------------------------------------

create or replace function consume_reward_voucher(p_voucher_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_voucher_id is null or p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_args');
  end if;

  -- The whole fix is this one statement: the WHERE re-checks status under the
  -- row lock, so of N concurrent consumes exactly one returns a row. No
  -- separate read exists to go stale.
  update reward_vouchers
     set status   = 'used',
         used_at  = now(),
         order_id = p_order_id
   where id = p_voucher_id
     and status = 'active'
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;

  return jsonb_build_object('ok', true, 'voucher_id', v_id);
end;
$$;

revoke execute on function consume_reward_voucher(uuid, uuid) from public, anon, authenticated;
