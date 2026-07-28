-- 073_member_vouchers_invites.sql
-- ---------------------------------------------------------------------------
-- Membership Phase 2: the admin windows into redemptions and invites, plus the
-- one new write verb (voucher void). A LENS over existing records — reads
-- reward_vouchers, reward_ledger, orders, member_invites, customer_profiles,
-- customers; owns no new customer state. Mirrors the 071 admin-surface style:
-- jsonb-returning, is_admin()-gated SECURITY DEFINER, paged {rows,total}.
--
--   • reward_vouchers gains voided_at + void_reason (additive) so the
--     Redemptions view is self-contained without joining audit_log.
--   • admin_member_vouchers(...)  — paged voucher list + status summary.
--   • admin_void_voucher(...)     — the single new write verb. Voids an ACTIVE
--     voucher and optionally refunds its points via an append-only ledger row.
--     Audit-logged. See the reconcile note below.
--   • admin_member_invites(...)   — paged invite list + funnel summary.
--   • admin_invitable_guests(...) — guests with unclaimed points and no account
--     yet, for the bulk-invite workflow (server-side eligibility — no client
--     estimation).
--
-- RECONCILE (067) IS DELIBERATELY UNTOUCHED. admin_void_voucher only voids
-- vouchers in status='active'. An active voucher has never been consumed, so it
-- has no order_id, no applied discount, and no source='reward' order_coupons
-- row — the reconcile function only inspects status='used' vouchers and
-- order-side discount gaps. Voiding an active voucher therefore cannot create
-- any reconcile state (A/B/C/D). The blueprint's "teach reconcile about voids"
-- caveat only applied to voiding USED vouchers, which this RPC refuses. If
-- used-voucher voiding is ever added, it must unwind the order discount AND
-- extend reconcile in the same migration — out of scope here.
--
-- Additive + idempotent. No new grants to anon. DB is forward-fix only.
-- ---------------------------------------------------------------------------

-- ── 1. Void bookkeeping columns (additive) ─────────────────────────────────
alter table reward_vouchers add column if not exists voided_at   timestamptz;
alter table reward_vouchers add column if not exists void_reason text;

-- ── 2. Redemptions list — paged voucher surface + status summary ───────────
create or replace function admin_member_vouchers(
  p_status text    default 'all',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_status text    := lower(nullif(btrim(coalesce(p_status, 'all')), ''));
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if v_status is null then v_status := 'all'; end if;

  with v as (
    select rv.*,
           coalesce(c.display_name, cp.full_name,
                    (select u.email from auth.users u where u.id = rv.user_id)) as member_name,
           coalesce(c.contact,
                    (select u.email from auth.users u where u.id = rv.user_id)) as contact,
           cp.customer_id,
           o.order_number
      from reward_vouchers rv
      left join customer_profiles cp on cp.user_id = rv.user_id
      left join customers c on c.id = cp.customer_id
      left join orders o on o.id = rv.order_id
  ),
  filtered as (
    select * from v where v_status = 'all' or v.status = v_status
  ),
  page as (
    select * from filtered
     order by created_at desc
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',          page.id,
        'userId',      page.user_id,
        'customerId',  page.customer_id,
        'memberName',  page.member_name,
        'contact',     page.contact,
        'percent',     page.percent,
        'pointsSpent', page.points_spent,
        'status',      page.status,
        'createdIso',  to_char(page.created_at, 'YYYY-MM-DD'),
        'usedIso',     case when page.used_at   is not null then to_char(page.used_at,   'YYYY-MM-DD') end,
        'voidedIso',   case when page.voided_at is not null then to_char(page.voided_at, 'YYYY-MM-DD') end,
        'voidReason',  page.void_reason,
        'orderNumber', page.order_number,
        'orderId',     page.order_id
      ) order by page.created_at desc)
      from page
    ), '[]'::jsonb),
    'total',   (select count(*) from filtered),
    'summary', jsonb_build_object(
      'active', (select count(*) from v where status = 'active'),
      'used',   (select count(*) from v where status = 'used'),
      'void',   (select count(*) from v where status = 'void'),
      -- Outstanding liability we can state truthfully: points locked in active
      -- vouchers (refundable on void). Dollar exposure depends on which item a
      -- member applies the voucher to, so it is not asserted here.
      'outstandingPoints', (select coalesce(sum(points_spent), 0) from v where status = 'active')
    ),
    'limit',  v_limit,
    'offset', v_offset,
    'status', v_status
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_member_vouchers(text, integer, integer) from public, anon;
grant  execute on function admin_member_vouchers(text, integer, integer) to authenticated;

-- ── 3. Void voucher — the one new write verb (active-only) ─────────────────
create or replace function admin_void_voucher(
  p_voucher_id    uuid,
  p_refund_points boolean default true,
  p_reason        text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_reason  text;
  v_uid     uuid;
  v_points  integer;
  v_status  text;
  v_refund  integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A reason is required to void a voucher';
  end if;

  -- Lock the row so a concurrent consume/void can't race us.
  select user_id, points_spent, status
    into v_uid, v_points, v_status
    from reward_vouchers
   where id = p_voucher_id
   for update;

  if not found then
    raise exception 'Voucher not found';
  end if;
  -- Active-only: a used voucher has an applied order discount that this verb
  -- does not (and must not silently) unwind. Refuse it — see reconcile note.
  if v_status <> 'active' then
    raise exception 'Only active vouchers can be voided (this one is %)', v_status;
  end if;

  -- Optional compensating refund: append-only, never an edit. Mirrors the
  -- redemption -300 spend with a +points adjustment so the balance nets right.
  if coalesce(p_refund_points, true) then
    insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
    values (v_uid, null, 'adjustment', v_points,
            format('Refund on voucher void — %s', v_reason), auth.uid());
    v_refund := v_points;
  end if;

  update reward_vouchers
     set status = 'void', voided_at = now(), void_reason = v_reason
   where id = p_voucher_id;

  perform log_audit(
    'reward.voucher_voided', 'customer', v_uid::text,
    format('Voided %s%% reward voucher%s — %s',
           v_points,  -- points_spent doubles as the redemption cost
           case when v_refund > 0 then format(', refunded %s pts', v_refund) else ', no refund' end,
           v_reason),
    jsonb_build_object('voucher_id', p_voucher_id, 'status', 'active'),
    jsonb_build_object('voucher_id', p_voucher_id, 'status', 'void',
                       'refunded_points', v_refund),
    null
  );

  return jsonb_build_object('ok', true, 'refunded_points', v_refund);
end;
$$;

revoke execute on function admin_void_voucher(uuid, boolean, text) from public, anon;
grant  execute on function admin_void_voucher(uuid, boolean, text) to authenticated;

-- ── 4. Invite list — paged + funnel summary ────────────────────────────────
create or replace function admin_member_invites(
  p_filter text    default 'all',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_filter text    := lower(nullif(btrim(coalesce(p_filter, 'all')), ''));
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if v_filter is null then v_filter := 'all'; end if;

  with filtered as (
    select mi.* from member_invites mi
     where v_filter = 'all'
        or (v_filter = 'outstanding' and mi.converted_at is null)
        or (v_filter = 'converted'   and mi.converted_at is not null)
  ),
  page as (
    select * from filtered order by sent_at desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',            page.id,
        'email',         page.email,
        'customerId',    page.customer_id,
        'pointsPromised',page.points_promised,
        'channel',       page.channel,
        'sentIso',       to_char(page.sent_at, 'YYYY-MM-DD'),
        'convertedIso',  case when page.converted_at is not null then to_char(page.converted_at, 'YYYY-MM-DD') end,
        'converted',     (page.converted_at is not null),
        'staleDays',     case when page.converted_at is null
                              then floor(extract(epoch from (now() - page.sent_at)) / 86400)::int end
      ) order by page.sent_at desc)
      from page
    ), '[]'::jsonb),
    'total',   (select count(*) from filtered),
    'summary', jsonb_build_object(
      'sent',          (select count(*) from member_invites),
      'converted',     (select count(*) from member_invites where converted_at is not null),
      'outstanding',   (select count(*) from member_invites where converted_at is null),
      'conversionPct', (select case when count(*) > 0
                                    then round(100.0 * count(*) filter (where converted_at is not null) / count(*))
                                    else 0 end
                          from member_invites)
    ),
    'limit',  v_limit,
    'offset', v_offset,
    'filter', v_filter
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_member_invites(text, integer, integer) from public, anon;
grant  execute on function admin_member_invites(text, integer, integer) to authenticated;

-- ── 5. Invitable guests — points banked, no account yet ────────────────────
-- Server-side eligibility for the bulk-invite workflow (no client estimation).
-- A guest = a contact with paid orders (points = floor(paid cents/100), the
-- 044 accrual) that is NOT already a portal account and was NOT invited in the
-- last 7 days (throttle so a re-run doesn't re-spam pending invitees).
create or replace function admin_invitable_guests(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with paid as (
    select lower(btrim(o.buyer_contact)) as ck,
           max(o.buyer_name)             as display_name,
           max(o.buyer_contact)          as contact,
           floor(sum(o.invoice_amount_cents) / 100)::int as points
      from orders o
     where o.status in ('paid', 'fulfilled')
       and o.buyer_contact is not null and btrim(o.buyer_contact) <> ''
     group by lower(btrim(o.buyer_contact))
  ),
  -- Contacts that already hold a portal account (linked profile OR an auth user
  -- with that email) — never invite an existing member.
  accounts as (
    select c.contact_key as ck
      from customers c join customer_profiles cp on cp.customer_id = c.id
    union
    select lower(btrim(u.email)) from auth.users u where u.email is not null
  ),
  recent_invites as (
    select contact_key as ck from member_invites
     where converted_at is null and sent_at > now() - interval '7 days'
  ),
  eligible as (
    select p.* ,
           (select c.id from customers c where c.contact_key = p.ck limit 1) as customer_id
      from paid p
     where p.points > 0
       and p.ck not in (select ck from accounts)
       and p.ck not in (select ck from recent_invites)
     order by p.points desc
     limit v_limit
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contact',     e.contact,
        'displayName', coalesce(e.display_name, e.contact),
        'points',      e.points,
        'customerId',  e.customer_id
      ) order by e.points desc)
      from eligible e
    ), '[]'::jsonb),
    'total', (
      select count(*) from paid p
       where p.points > 0
         and p.ck not in (select ck from accounts)
         and p.ck not in (select ck from recent_invites)
    ),
    'limit', v_limit
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_invitable_guests(integer) from public, anon;
grant  execute on function admin_invitable_guests(integer) to authenticated;
