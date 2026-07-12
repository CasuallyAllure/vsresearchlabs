-- 044_reward_ledger.sql
-- ---------------------------------------------------------------------------
-- Reward points ledger (blueprint §3, migration 044). Requires 043.
--
--   • reward_ledger — append-only signed entries. Balance = sum(points).
--     Corrections are compensating entries, never edits: there is NO
--     insert/update/delete policy or table privilege for clients; only
--     SECURITY DEFINER code writes rows.
--   • Accrual — mark_order_paid (definitive body: 025) now appends one 'earn'
--     row per paid OWNED order: floor(invoice_amount_cents / 100) points
--     (1 pt per whole dollar), only when >= 1. The partial unique index
--     reward_ledger_earn_once makes re-marks a no-op (never double-earn).
--   • Reversal — cancel_order (definitive body: 004) and revert_order_status
--     (definitive body: 013) append a compensating 'reversal' (negative of the
--     earn) when the order leaves paid territory: cancel with an earn on
--     record, or the paid → invoice_sent revert step. Only if an earn exists
--     and no reversal exists yet.
--   • get_my_reward_summary() — authenticated-only {balance, entries[]}.
--   • admin_adjust_reward_points() — is_admin()-gated manual credit/debit,
--     non-zero points, mandatory note, created_by = auth.uid().
--   • Idempotent backfill — earn rows for historical owned+paid orders, plus
--     compensating reversals for the ones that later went cancelled/refunded
--     (so the backfill can't mint live points for dead orders). Both guarded
--     by the earn-once index, so reruns are no-ops.
--
-- Known limit (accepted by blueprint design): an order that earned, was
-- reverted (reversal written), then re-marked paid cannot auto-earn again —
-- the earn-once index blocks a second earn. Admin adjustment is the recovery
-- path.
--
-- Additive + idempotent. No new grants to anon anywhere.
--
-- Rollback notes: drop functions get_my_reward_summary and
-- admin_adjust_reward_points; re-apply 025's mark_order_paid, 004's
-- cancel_order and 013's revert_order_status bodies; drop table reward_ledger
-- (destroys point history — export first).
-- ---------------------------------------------------------------------------

-- ── 1. reward_ledger — append-only signed entries ────────────────────────────
create table if not exists reward_ledger (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  order_id   uuid        references orders(id) on delete set null,
  kind       text        not null check (kind in ('earn', 'reversal', 'adjustment')),
  points     integer     not null check (points <> 0),   -- signed
  note       text,
  created_by uuid        references auth.users(id),       -- admin actor or null = system
  created_at timestamptz not null default now()
);

create index if not exists reward_ledger_user_idx on reward_ledger (user_id, created_at desc);
-- At most ONE earn and ONE reversal per order — the double-earn guard.
create unique index if not exists reward_ledger_earn_once
  on reward_ledger (order_id, kind) where kind in ('earn', 'reversal');

alter table reward_ledger enable row level security;

drop policy if exists "Customers read own reward entries" on reward_ledger;
create policy "Customers read own reward entries"
  on reward_ledger for select
  using (user_id = auth.uid());

drop policy if exists "Admins read all reward entries" on reward_ledger;
create policy "Admins read all reward entries"
  on reward_ledger for select
  using (is_admin());

-- No INSERT/UPDATE/DELETE policies exist and the table privileges are revoked
-- too — ledger rows are immutable outside SECURITY DEFINER code.
revoke all on reward_ledger from anon, authenticated;
grant select on reward_ledger to authenticated;

-- ── 2. mark_order_paid — 025 body preserved + earn accrual appended ─────────
create or replace function mark_order_paid(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order_no text;
  v_prev     order_status;
  v_user_id  uuid;
  v_amount   integer;
  v_points   integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select status into v_prev from orders where id = p_order_id;

  update orders
    set status     = 'paid',
        paid_at    = now(),
        updated_at = now()
    where id = p_order_id
      and status in ('invoice_sent', 'payment_claimed')
    returning order_number into v_order_no;

  if v_order_no is null then
    raise exception 'Order must be invoice_sent or payment_claimed to mark paid (got %)', v_prev;
  end if;

  perform log_audit(
    'order.paid', 'order', p_order_id::text,
    format('Payment confirmed for %s', v_order_no),
    jsonb_build_object('status', v_prev),
    jsonb_build_object('status', 'paid'),
    null
  );

  -- NEW (044): accrue reward points for owned orders — 1 point per whole
  -- dollar billed. The earn-once index makes a re-mark a silent no-op.
  select user_id, coalesce(invoice_amount_cents, 0)
    into v_user_id, v_amount
    from orders where id = p_order_id;

  if v_user_id is not null then
    v_points := floor(v_amount / 100.0)::integer;
    if v_points >= 1 then
      insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
      values (v_user_id, p_order_id, 'earn', v_points,
              format('Earned on order %s', v_order_no), auth.uid())
      on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;
    end if;
  end if;
end;
$$;

-- Grant posture unchanged from the 003/025 lineage.
grant execute on function mark_order_paid(uuid) to authenticated;

-- ── 3. cancel_order — 004 body preserved + reversal appended ────────────────
create or replace function cancel_order(
  p_order_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin    uuid;
  v_status   order_status;
  v_order_no text;
  v_line     record;
  v_on_hand  integer;
  v_restocked integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  select status, order_number into v_status, v_order_no
    from orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status in ('cancelled', 'refunded') then
    raise exception 'Order already terminal';
  end if;

  if v_status = 'fulfilled' then
    for v_line in
      select * from order_lines where order_id = p_order_id
    loop
      update product_stock
        set on_hand    = on_hand + v_line.quantity,
            updated_at = now()
        where sku = v_line.sku
        returning on_hand into v_on_hand;

      insert into stock_movements
        (sku, delta, reason, order_id, admin_id, on_hand_after, notes)
      values
        (v_line.sku, v_line.quantity, 'order_cancelled_after_fulfill',
         p_order_id, v_admin, v_on_hand,
         'Restock from cancelled fulfilled order');

      v_restocked := v_restocked + 1;
    end loop;
  end if;

  update orders
    set status              = 'cancelled',
        cancelled_at        = now(),
        cancellation_reason = p_reason,
        updated_at          = now()
    where id = p_order_id;

  -- NEW (044): the order had earned points at mark-paid — append the
  -- compensating reversal (once) now that the order is cancelled.
  insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
  select rl.user_id, rl.order_id, 'reversal', -rl.points,
         format('Reversed on cancellation of %s', v_order_no), v_admin
    from reward_ledger rl
   where rl.order_id = p_order_id
     and rl.kind = 'earn'
     and not exists (
       select 1 from reward_ledger r2
        where r2.order_id = p_order_id and r2.kind = 'reversal'
     )
  on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  perform log_audit(
    'order.cancelled', 'order', p_order_id::text,
    format('Cancelled %s%s — %s',
      v_order_no,
      case when v_restocked > 0 then format(' (restocked %s lines)', v_restocked) else '' end,
      p_reason),
    jsonb_build_object('status', v_status),
    jsonb_build_object(
      'status', 'cancelled',
      'reason', p_reason,
      'restocked_lines', v_restocked
    ),
    null
  );
end;
$$;

-- Grant posture unchanged from the 003/004 lineage.
grant execute on function cancel_order(uuid, text) to authenticated;

-- ── 4. revert_order_status — 013 body preserved + reversal appended ─────────
-- Only the paid → invoice_sent step leaves paid territory in the revert
-- ladder (fulfilled first steps back to paid, which keeps the points), so the
-- reversal hook lives in that branch alone. Cancelled/refunded revivals were
-- already reversed by cancel_order.
create or replace function revert_order_status(
  p_order_id uuid,
  p_reason   text
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin     uuid;
  v_status    order_status;
  v_delivered timestamptz;
  v_line      record;
  v_on_hand   integer;
  v_new       text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  select status, delivered_at into v_status, v_delivered
    from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if v_status = 'fulfilled' and v_delivered is not null then
    -- Delivered → un-deliver (back to shipped). No stock change.
    update orders set delivered_at = null where id = p_order_id;
    v_new := 'fulfilled';

  elsif v_status = 'fulfilled' then
    -- Shipped → paid. Restock every line (reverse the fulfillment).
    for v_line in select * from order_lines where order_id = p_order_id loop
      update product_stock
        set on_hand = on_hand + v_line.quantity, updated_at = now()
        where sku = v_line.sku
        returning on_hand into v_on_hand;
      insert into stock_movements (sku, delta, reason, order_id, admin_id, on_hand_after, notes)
        values (v_line.sku, v_line.quantity, 'order_cancelled_after_fulfill',
                p_order_id, v_admin, v_on_hand, 'Restock from reverted order');
    end loop;
    update orders
      set status = 'paid', fulfilled_at = null, shipped_at = null,
          tracking_number = null, carrier = null
      where id = p_order_id;
    v_new := 'paid';

  elsif v_status = 'paid' then
    update orders set status = 'invoice_sent', paid_at = null where id = p_order_id;
    v_new := 'invoice_sent';

    -- NEW (044): leaving paid territory — append the compensating reversal
    -- (once) if this order had earned points.
    insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
    select rl.user_id, rl.order_id, 'reversal', -rl.points,
           'Reversed on payment revert', v_admin
      from reward_ledger rl
     where rl.order_id = p_order_id
       and rl.kind = 'earn'
       and not exists (
         select 1 from reward_ledger r2
          where r2.order_id = p_order_id and r2.kind = 'reversal'
       )
    on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  elsif v_status = 'invoice_sent' then
    update orders set status = 'pending_invoice', invoiced_at = null where id = p_order_id;
    v_new := 'pending_invoice';

  elsif v_status in ('cancelled', 'refunded') then
    -- Revive a cancelled/refunded order back to the start of the pipeline.
    update orders
      set status = 'pending_invoice', cancelled_at = null, cancellation_reason = null
      where id = p_order_id;
    v_new := 'pending_invoice';

  else
    raise exception 'Order is already at the earliest stage; nothing to revert';
  end if;

  -- Stamp the flag/record on the order + audit it.
  update orders
    set flag_note  = nullif(btrim(p_reason), ''),
        flagged_at = now(),
        updated_at = now()
    where id = p_order_id;

  perform log_audit(
    'order.reverted', 'order', p_order_id::text,
    format('Reverted %s → %s%s', v_status, v_new,
           case when nullif(btrim(p_reason), '') is null then '' else ': ' || p_reason end),
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', v_new, 'reason', p_reason),
    null
  );

  return v_new;
end;
$$;

-- Grant posture unchanged from the 013 lineage.
grant execute on function revert_order_status(uuid, text) to authenticated;

-- ── 5. get_my_reward_summary — balance + full history for the caller ────────
create or replace function get_my_reward_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'balance', coalesce(
      (select sum(points) from reward_ledger where user_id = auth.uid()), 0),
    'entries', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',           rl.id,
         'kind',         rl.kind,
         'points',       rl.points,
         'note',         rl.note,
         'order_number', o.order_number,
         'created_at',   rl.created_at
       ) order by rl.created_at desc)
       from reward_ledger rl
       left join orders o on o.id = rl.order_id
       where rl.user_id = auth.uid()),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function get_my_reward_summary() from public, anon;
grant execute on function get_my_reward_summary() to authenticated;

-- ── 6. admin_adjust_reward_points — manual credit/debit, note mandatory ─────
create or replace function admin_adjust_reward_points(
  p_user_id uuid,
  p_points  integer,
  p_note    text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_note text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_points is null or p_points = 0 then
    raise exception 'Points adjustment must be a non-zero integer';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is null then
    raise exception 'A note is required for manual point adjustments';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found';
  end if;

  insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
  values (p_user_id, null, 'adjustment', p_points, v_note, auth.uid());

  perform log_audit(
    'rewards.adjusted', 'customer', p_user_id::text,
    format('Reward points adjusted by %s%s — %s',
      case when p_points > 0 then '+' else '' end, p_points, v_note),
    null,
    jsonb_build_object('points', p_points, 'note', v_note),
    null
  );
end;
$$;

revoke execute on function admin_adjust_reward_points(uuid, integer, text) from public, anon;
grant execute on function admin_adjust_reward_points(uuid, integer, text) to authenticated;

-- ── 7. Idempotent backfill for historical owned + paid orders ───────────────
-- Same floor rule as accrual; the earn-once index absorbs reruns. created_at
-- is pinned to paid_at so the ledger reads in true order.
insert into reward_ledger (user_id, order_id, kind, points, note, created_by, created_at)
select o.user_id, o.id, 'earn',
       floor(coalesce(o.invoice_amount_cents, 0) / 100.0)::integer,
       format('Earned on order %s (backfill)', o.order_number),
       null, coalesce(o.paid_at, now())
  from orders o
 where o.user_id is not null
   and o.paid_at is not null
   and floor(coalesce(o.invoice_amount_cents, 0) / 100.0)::integer >= 1
on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

-- Backfilled orders that later went terminal must not carry live points:
-- write their compensating reversal too (idempotent via the same index).
insert into reward_ledger (user_id, order_id, kind, points, note, created_by, created_at)
select rl.user_id, rl.order_id, 'reversal', -rl.points,
       format('Reversed on cancellation of %s (backfill)', o.order_number),
       null, coalesce(o.cancelled_at, now())
  from reward_ledger rl
  join orders o on o.id = rl.order_id
 where rl.kind = 'earn'
   and o.status in ('cancelled', 'refunded')
on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;
