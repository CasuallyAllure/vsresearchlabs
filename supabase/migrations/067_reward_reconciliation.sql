-- 067_reward_reconciliation.sql
-- ---------------------------------------------------------------------------
-- Reward-voucher reconciliation — closes the carried crash-window finding
-- (pro reviews 2026-07-17/18 INFO #4): place-order persists the order row
-- (discount already including the reward reduction) BEFORE the atomic
-- voucher consume (064) and the order_coupons reward-row insert. A death in
-- that sub-second window leaves inconsistent state that nothing detected.
--
-- One function detects every reward mismatch state and auto-repairs the one
-- state that is deterministic and money-invisible:
--
--   State B — voucher consumed (status='used', order_id set) but the order
--     has NO source='reward' order_coupons row, and the order's
--     discount_cents exceeds the sum of its coupon rows by exactly the
--     voucher math (percent × highest unit price, ±1¢ rounding). This is the
--     alerted-but-unrepaired `reward_row_insert` failure and the
--     crash-after-consume window. REPAIRED when p_repair: re-insert the
--     reward row exactly as place-order would have
--     (supabase/functions/place-order/index.ts, REWARD_CODE block), using
--     the order's own discount gap as the amount so orders.discount_cents
--     is left byte-identical — no customer-visible money changes. Without
--     the row, the next admin line edit (recompute_order_totals, 052) would
--     silently re-price the order WITHOUT the reward.
--
--   State A — an order's discount_cents exceeds the sum of its
--     order_coupons rows and NO used voucher points at it (crash between
--     order insert and any coupon-row insert; the gap is not attributable
--     to a specific source). DETECT ONLY: relabeling money is a human call.
--
--   State C — voucher consumed for an order that carries no reward and no
--     gap (rollback half-ran, or an admin recompute already dropped the
--     reward). The customer paid full price AND lost the voucher.
--     DETECT ONLY: restoring either side changes customer-visible state.
--
--   State D — a source='reward' order_coupons row exists but no used
--     voucher points at that order (reward granted without a consume — a
--     possible double-spend seed). DETECT ONLY.
--
-- Detection is one-directional on the gap (discount_cents > Σ rows):
-- recompute_order_totals caps orders.discount_cents at the subtotal, so
-- Σ rows may legitimately exceed discount_cents — that direction is NOT a
-- mismatch. Scans are bounded to the last 60 days (the crash window is
-- sub-second; anything it produces is recent) so the function stays cheap
-- enough to run from a 15-minute cron.
--
-- Caller: the `reconcile` edge function (service-role), hit by the uptime
-- cron. Service-role only — revoked from public/anon/authenticated, same
-- posture as 064.
--
-- Requires 050 (reward_vouchers, order_coupons.source='reward'), 064
-- (consume RPC sets order_id). Additive + idempotent (create or replace;
-- repair insert is ON CONFLICT DO NOTHING on unique(order_id, code)).
--
-- Rollback: drop function reconcile_reward_vouchers(boolean); nothing else
-- references it.
-- ---------------------------------------------------------------------------

create or replace function reconcile_reward_vouchers(p_repair boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since        timestamptz := now() - interval '60 days';
  v_state_a      uuid[] := '{}';  -- order ids: unattributable discount gap
  v_state_c      uuid[] := '{}';  -- voucher ids: consumed but reward absent
  v_state_d      uuid[] := '{}';  -- order ids: reward row without a consume
  v_b_repaired   uuid[] := '{}';  -- order ids: State B, row re-inserted
  v_b_repairable uuid[] := '{}';  -- order ids: State B found, p_repair=false
  v_b_uncorrob   uuid[] := '{}';  -- order ids: voucher-linked gap that fails
                                  -- the voucher-math corroboration — treated
                                  -- as detect-only, never auto-labeled REWARD
  r          record;
  v_gap      integer;
  v_expected integer;
  v_open     integer;
begin
  -- State D: reward row on the order, but no consumed voucher explains it.
  select coalesce(array_agg(distinct oc.order_id), '{}') into v_state_d
    from order_coupons oc
    join orders o on o.id = oc.order_id
   where oc.source = 'reward'
     and o.created_at >= v_since
     and not exists (
       select 1 from reward_vouchers rv
        where rv.order_id = oc.order_id and rv.status = 'used');

  -- States B / C / uncorroborated: consumed vouchers whose order lacks a
  -- source='reward' row. The gap between the order's stored discount and
  -- the sum of its coupon rows decides which state this is.
  for r in
    select rv.id as voucher_id, rv.percent, rv.order_id
      from reward_vouchers rv
     where rv.status = 'used'
       and rv.order_id is not null
       and coalesce(rv.used_at, now()) >= v_since
       and not exists (
         select 1 from order_coupons oc
          where oc.order_id = rv.order_id and oc.source = 'reward')
  loop
    select o.discount_cents
           - coalesce((select sum(oc.discount_cents)
                         from order_coupons oc
                        where oc.order_id = o.id), 0)
      into v_gap
      from orders o
     where o.id = r.order_id;

    if v_gap is null then
      continue;  -- order row gone (FK would have nulled order_id; belt+braces)
    end if;

    if v_gap <= 0 then
      -- State C: voucher burned, order carries no reward and no gap.
      v_state_c := v_state_c || r.voucher_id;
      continue;
    end if;

    -- Corroborate the gap against the voucher math place-order uses:
    -- percent × the highest single unit price on the order (±1¢ rounding).
    select round(r.percent / 100.0 * max(ol.unit_price_cents))::integer
      into v_expected
      from order_lines ol
     where ol.order_id = r.order_id
       and ol.unit_price_cents > 0;

    if v_expected is null or abs(v_expected - v_gap) > 1 then
      -- The gap is not (only) the reward — mislabeling it REWARD would lie
      -- on the invoice. Leave it for a human.
      v_b_uncorrob := v_b_uncorrob || r.order_id;
      continue;
    end if;

    if not p_repair then
      v_b_repairable := v_b_repairable || r.order_id;
      continue;
    end if;

    -- Repair: the exact row place-order would have written, amount = the
    -- order's own gap so orders.discount_cents is untouched.
    insert into order_coupons
      (order_id, code, kind, percent, amount_cents, free_label, discount_cents, source)
    values
      (r.order_id, 'REWARD', 'fixed', r.percent, v_gap,
       r.percent || '% off one item', v_gap, 'reward')
    on conflict (order_id, code) do nothing;
    v_b_repaired := v_b_repaired || r.order_id;
  end loop;

  -- State A: positive gap with NO consumed voucher pointing at the order.
  -- (Voucher-linked gaps were handled above, so the sets stay disjoint.)
  select coalesce(array_agg(o.id), '{}') into v_state_a
    from orders o
   where o.created_at >= v_since
     and o.discount_cents >
         coalesce((select sum(oc.discount_cents)
                     from order_coupons oc
                    where oc.order_id = o.id), 0)
     and not exists (
       select 1 from reward_vouchers rv
        where rv.order_id = o.id and rv.status = 'used');

  -- Everything a human still has to look at. Repaired rows are resolved;
  -- repairable-but-not-repaired rows are open.
  v_open := cardinality(v_state_a) + cardinality(v_state_c)
          + cardinality(v_state_d) + cardinality(v_b_uncorrob)
          + cardinality(v_b_repairable);

  return jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'window_days', 60,
    'mismatches', v_open,
    'repaired', cardinality(v_b_repaired),
    'state_a', jsonb_build_object('count', cardinality(v_state_a), 'order_ids', to_jsonb(v_state_a)),
    'state_b', jsonb_build_object(
      'repaired_order_ids', to_jsonb(v_b_repaired),
      'repairable_order_ids', to_jsonb(v_b_repairable),
      'uncorroborated_order_ids', to_jsonb(v_b_uncorrob)),
    'state_c', jsonb_build_object('count', cardinality(v_state_c), 'voucher_ids', to_jsonb(v_state_c)),
    'state_d', jsonb_build_object('count', cardinality(v_state_d), 'order_ids', to_jsonb(v_state_d))
  );
end;
$$;

revoke execute on function reconcile_reward_vouchers(boolean) from public, anon, authenticated;
