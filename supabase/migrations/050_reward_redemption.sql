-- 050_reward_redemption.sql
-- ---------------------------------------------------------------------------
-- Reward redemption: at 300 points a customer can manually redeem a one-time
-- voucher worth 40% off a single item, applied to their highest-priced line at
-- the next checkout. Builds on the 044 append-only reward_ledger (1 pt/$ earn).
--
--   • reward_ledger gains a 'redemption' kind — the −300 point spend recorded
--     when the customer redeems (append-only, same as every other ledger row).
--   • reward_vouchers — one row per redeemed reward; 'active' until a checkout
--     consumes it ('used'). At most one active voucher per customer.
--   • redeem_reward() — authenticated RPC: verifies balance ≥ threshold, writes
--     the −300 ledger row + an active voucher, atomically. Manual (button-
--     driven) — nothing auto-redeems.
--   • get_my_reward_summary() gains threshold/percent/reward_ready/active
--     voucher so the portal can render the tracker + redeem button.
--
-- The voucher is APPLIED at checkout by place-order (materialized as a synthetic
-- 'fixed' order_coupons row, source='reward', amount = 40% of the highest single
-- unit price) so the whole invoice + recompute pipeline handles it unchanged.
--
-- Threshold 300 pts · reward 40% off one item. Change both here and in
-- place-order if the program changes.
--
-- Requires 044 (reward_ledger) and 045 (order_coupons.source).
--
-- Additive + idempotent. No new grants to anon.
--
-- Rollback: drop redeem_reward; re-apply 044's get_my_reward_summary; drop table
-- reward_vouchers; restore reward_ledger_kind_check to the 3-value list; drop
-- 'reward' from the order_coupons.source check.
-- ---------------------------------------------------------------------------

-- ── 1. Allow the 'redemption' ledger kind ───────────────────────────────────
alter table reward_ledger drop constraint if exists reward_ledger_kind_check;
alter table reward_ledger add constraint reward_ledger_kind_check
  check (kind in ('earn', 'reversal', 'adjustment', 'redemption'));

-- ── 2. Allow 'reward' as an order_coupons source ────────────────────────────
alter table order_coupons drop constraint if exists order_coupons_source_check;
alter table order_coupons add constraint order_coupons_source_check
  check (source in ('code', 'account', 'reward'));

-- ── 3. reward_vouchers — one redeemed reward each ───────────────────────────
create table if not exists reward_vouchers (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  reward_kind  text        not null default 'item_percent'
                 check (reward_kind in ('item_percent')),
  percent      integer     not null check (percent between 1 and 100),
  points_spent integer     not null check (points_spent > 0),
  status       text        not null default 'active'
                 check (status in ('active', 'used', 'void')),
  order_id     uuid        references orders(id) on delete set null,
  created_at   timestamptz not null default now(),
  used_at      timestamptz
);
create index if not exists reward_vouchers_user_idx on reward_vouchers (user_id, created_at desc);
-- At most one ACTIVE voucher per customer (partial unique).
create unique index if not exists reward_vouchers_one_active
  on reward_vouchers (user_id) where status = 'active';

alter table reward_vouchers enable row level security;

drop policy if exists "Customers read own vouchers" on reward_vouchers;
create policy "Customers read own vouchers"
  on reward_vouchers for select using (user_id = auth.uid());

drop policy if exists "Admins read all vouchers" on reward_vouchers;
create policy "Admins read all vouchers"
  on reward_vouchers for select using (is_admin());

-- Writes only through SECURITY DEFINER code (redeem_reward + place-order's
-- service-role consume). No client insert/update/delete.
revoke all on reward_vouchers from anon, authenticated;
grant select on reward_vouchers to authenticated;

-- ── 4. redeem_reward — spend 300 pts for a 40%-off-one-item voucher ─────────
create or replace function redeem_reward()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid       uuid := auth.uid();
  v_threshold constant integer := 300;
  v_percent   constant integer := 40;
  v_balance   integer;
  v_id        uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'Please sign in.');
  end if;

  -- One active voucher at a time.
  if exists (select 1 from reward_vouchers where user_id = v_uid and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'You already have a reward ready to use.');
  end if;

  select coalesce(sum(points), 0) into v_balance from reward_ledger where user_id = v_uid;
  if v_balance < v_threshold then
    return jsonb_build_object('ok', false, 'reason',
      format('You need %s points to redeem (you have %s).', v_threshold, v_balance));
  end if;

  -- Spend the points (append-only) then mint the voucher. The −300 row and the
  -- voucher live or die together in this statement's transaction.
  insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
  values (v_uid, null, 'redemption', -v_threshold,
          format('Redeemed %s%% off one item', v_percent), v_uid);

  insert into reward_vouchers (user_id, reward_kind, percent, points_spent, status)
  values (v_uid, 'item_percent', v_percent, v_threshold, 'active')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'voucher_id', v_id, 'percent', v_percent);
end;
$$;

revoke execute on function redeem_reward() from public, anon;
grant execute on function redeem_reward() to authenticated;

-- ── 5. get_my_reward_summary — 044 body + redemption program fields ─────────
create or replace function get_my_reward_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bal as (
    select coalesce(sum(points), 0) as balance
      from reward_ledger where user_id = auth.uid()
  ),
  av as (
    select id, percent, created_at
      from reward_vouchers
     where user_id = auth.uid() and status = 'active'
     order by created_at desc limit 1
  )
  select jsonb_build_object(
    'balance',   (select balance from bal),
    'threshold', 300,
    'percent',   40,
    'reward_ready', (select balance from bal) >= 300,
    'active_voucher', (
      select case when av.id is null then null else jsonb_build_object(
        'id', av.id, 'percent', av.percent, 'created_at', av.created_at
      ) end from av
    ),
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
