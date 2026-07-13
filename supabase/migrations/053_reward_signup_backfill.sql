-- 053_reward_signup_backfill.sql
-- ---------------------------------------------------------------------------
-- Closes the guest-signup points gap: link_my_orders() (043) re-parents a
-- guest's past orders to the newly-signed-in auth.uid() by buyer_contact
-- email match, but it never wrote reward_ledger rows for them. Any order
-- that was placed as a guest — even if it was later paid/fulfilled — could
-- never earn points, because mark_order_paid (044) only accrues when
-- orders.user_id is already set at the moment payment is confirmed, and a
-- freshly-linked order's earn window has already passed by then.
--
-- Fix: redefine link_my_orders() as 043's exact body (verified: 043 is the
-- latest definition — 028's earlier body was superseded by 043, and no
-- migration after 043 touches it) plus a backfill step appended after the
-- order-linking UPDATE. The backfill mirrors 044's own historical-backfill
-- block byte-for-byte in formula and shape:
--   • Same gate as 044 section 7: paid_at is not null (not a bare status
--     list — an order that was paid then later cancelled/refunded still had
--     paid_at set, and 044 compensates those with a reversal rather than
--     excluding them outright).
--   • Same formula: floor(invoice_amount_cents / 100.0)::integer, >= 1.
--   • Same idempotency guard: `on conflict (order_id, kind) where kind in
--     ('earn', 'reversal') do nothing`, targeting the reward_ledger_earn_once
--     partial unique index (044) — a rerun (or a login that finds nothing
--     new to link) inserts nothing twice.
--   • Same compensating-reversal mirror as 044 section 8, for any
--     newly-earned row on an order that is currently cancelled/refunded, so
--     a linked-then-cancelled order can't mint live points either.
--
-- Scope: every order owned by auth.uid() (not just ones linked in this
-- call) is checked for a missing earn row, so this self-heals on EVERY
-- login/signup — a customer who signed up before this migration shipped,
-- or whose backfill silently missed a row for any reason, gets caught up
-- automatically the next time they sign in. The earn-once index makes this
-- safe to run on every login indefinitely.
--
-- Additive + idempotent + re-runnable. No new grants to anon anywhere.
-- Requires 043 (link_my_orders, guard-trigger bypass flag) and 044
-- (reward_ledger table + reward_ledger_earn_once index).
--
-- Rollback notes: re-apply 043's link_my_orders body (drops the backfill
-- step only; order-linking and the customer_id refresh are unaffected).
-- Any reward_ledger rows already inserted by the backfill are left in place
-- (they are legitimate accrual for real paid orders) — remove manually via
-- admin_adjust_reward_points if a specific correction is needed.
-- ---------------------------------------------------------------------------

create or replace function link_my_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_count integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return 0;
  end if;

  update orders
     set user_id = auth.uid()
   where user_id is null
     and lower(buyer_contact) = lower(v_email);

  get diagnostics v_count = row_count;

  -- Keep the CRM soft link fresh. The caller is the customer (not an admin),
  -- so raise the guard-trigger bypass flag for this trusted definer write only.
  perform set_config('vsr.profile_guard_bypass', 'on', true);
  update customer_profiles cp
     set customer_id = c.id
    from customers c
   where cp.user_id = auth.uid()
     and cp.customer_id is null
     and c.contact_key = lower(btrim(v_email));
  perform set_config('vsr.profile_guard_bypass', '', true);

  -- NEW (053): backfill reward-ledger earn rows for every order this user
  -- now owns (freshly linked above, or linked by an earlier login) that
  -- hasn't earned yet. Same gate + formula as 044's historical backfill.
  insert into reward_ledger (user_id, order_id, kind, points, note, created_by, created_at)
  select o.user_id, o.id, 'earn',
         floor(coalesce(o.invoice_amount_cents, 0) / 100.0)::integer,
         format('Earned on order %s (signup backfill)', o.order_number),
         null, coalesce(o.paid_at, now())
    from orders o
   where o.user_id = auth.uid()
     and o.paid_at is not null
     and floor(coalesce(o.invoice_amount_cents, 0) / 100.0)::integer >= 1
  on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  -- Compensate any of those newly-backfilled rows that belong to an order
  -- already cancelled/refunded, so a linked-then-cancelled order can't carry
  -- live points either (same shape as 044's own backfill reversal step).
  insert into reward_ledger (user_id, order_id, kind, points, note, created_by, created_at)
  select rl.user_id, rl.order_id, 'reversal', -rl.points,
         format('Reversed on cancellation of %s (signup backfill)', o.order_number),
         null, coalesce(o.cancelled_at, now())
    from reward_ledger rl
    join orders o on o.id = rl.order_id
   where rl.kind = 'earn'
     and o.user_id = auth.uid()
     and o.status in ('cancelled', 'refunded')
  on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  return v_count;
end;
$$;

grant execute on function link_my_orders() to authenticated;
