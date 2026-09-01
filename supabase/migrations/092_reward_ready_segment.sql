-- 092_reward_ready_segment.sql
-- ---------------------------------------------------------------------------
-- Two gaps the owner hit on the Members cockpit:
--
--   1. "Needs attention" says N members have a reward credit ready, and its
--      View button only re-SORTED the roster by points — the list still held
--      every member, so pressing it looked like it did nothing. There was no
--      way to see JUST the members sitting on 300+ points.
--   2. Once you found one, nothing could act on it: RewardsPanel credits and
--      debits points, and admin_void_voucher kills a voucher, but no verb
--      turned a ready balance INTO the voucher. The member had to do it
--      themselves in the portal, so "they have enough points" was a fact the
--      admin could read and not resolve.
--
-- This migration adds:
--   • the 'reward-ready' segment to admin_member_roster (071) and
--     admin_campaign_recipients (088) — one shared filter vocabulary, so the
--     roster filter and the broadcast audience keep meaning the same thing.
--   • admin_redeem_reward_for(user, note) — the admin-side twin of 050's
--     redeem_reward(), same threshold, same percent, same one-active-voucher
--     rule, audited and attributed to the admin who pressed it.
--
-- Bodies below are 071's and 088's verbatim apart from the marked predicate.
--
-- Additive + idempotent. No new grants to anon.
-- Rollback notes: forward-fix only. To revert, deploy a later migration with
--   071/088's bodies restored and admin_redeem_reward_for dropped.
-- ---------------------------------------------------------------------------

-- ── 1. The roster filter ───────────────────────────────────────────────────

create or replace function admin_member_roster(
  p_segment text    default 'all',
  p_sort    text    default 'spend',
  p_search  text    default null,
  p_limit   integer default 50,
  p_offset  integer default 0
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
  v_search text    := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with base as (
    select * from member_roster_base
  ),
  filtered as (
    select * from base r
     where (p_segment = 'all'
            or (p_segment = 'vip' and r.vip)
            -- 092: reward-ready is ORTHOGONAL to the lifecycle segments (an
            -- active member can also be sitting on 300 points), so it filters
            -- on the flag, never on r.segment.
            or (p_segment = 'reward-ready' and r.reward_ready)
            or r.segment = p_segment)
       and (v_search is null
            or r.name    ilike '%' || v_search || '%'
            or r.contact ilike '%' || v_search || '%'
            or coalesce(r.org, '') ilike '%' || v_search || '%')
  ),
  page as (
    select * from filtered f
     order by
       (case when p_sort = 'spend'  then f.spend_cents end)                      desc nulls last,
       (case when p_sort = 'points' then f.points_balance end)                   desc nulls last,
       (case when p_sort = 'joined' then extract(epoch from f.joined_at) end)     desc nulls last,
       (case when p_sort = 'recent' then extract(epoch from f.last_order_at) end) desc nulls last,
       f.spend_cents desc
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                 page.customer_id,   -- customers.id for the profile link (null if unlinked)
        'userId',             page.user_id,
        'name',               page.name,
        'contact',            page.contact,
        'org',                page.org,
        'tier',               page.tier,
        'accountType',        page.account_type,
        'businessName',       page.business_name,
        'freeShipping',       page.free_shipping,
        'status',             page.status,
        'spendCents',         page.spend_cents,
        'ttmSpendCents',      page.ttm_spend_cents,
        'paidOrders',         page.paid_orders,
        'points',             page.points_balance,
        'rewardReady',        page.reward_ready,
        'effectivePercent',   coalesce((page.discount->>'percent')::numeric, 0),
        'discountLabel',      case when (page.discount->>'discount_id') is not null then page.discount->>'label' end,
        'discountScope',      case when (page.discount->>'discount_id') is not null then page.discount->>'scope' end,
        'discountExpiresIso', null,   -- fetched on expand from customer_discounts (admin RLS)
        'joinedIso',          to_char(page.joined_at, 'YYYY-MM-DD'),
        'lastOrderIso',       case when page.last_order_at is not null then to_char(page.last_order_at, 'YYYY-MM-DD') end,
        'segment',            page.segment,
        'vip',                page.vip,
        'spendPercentile',    round(page.spend_percentile::numeric, 4)
      ))
      from page
    ), '[]'::jsonb),
    'total',   (select count(*) from filtered),
    'limit',   v_limit,
    'offset',  v_offset,
    'segment', p_segment,
    'sort',    p_sort
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_member_roster(text, text, text, integer, integer) from public, anon;
grant  execute on function admin_member_roster(text, text, text, integer, integer) to authenticated;

-- ── 2. The same vocabulary for the campaign audience ───────────────────────

create or replace function admin_campaign_recipients(
  p_segment text default 'all',
  p_search  text default null,
  p_contact text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_search  text := nullif(btrim(coalesce(p_search, '')), '');
  v_contact text := lower(btrim(coalesce(p_contact, '')));
  v_result  jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with eligible as (
    select b.user_id,
           b.name,
           lower(btrim(b.contact))                       as contact,
           b.segment,
           b.vip,
           b.tier,
           b.reward_ready,
           to_char(b.joined_at, 'YYYY-MM-DD')            as joined_iso,
           coalesce(cp.marketing_opt_out, false)         as opt_out
      from member_roster_base b
      left join customer_profiles cp on cp.user_id = b.user_id
     -- A campaign needs a deliverable address; a member without one is not a
     -- recipient, in either mode.
     where b.contact is not null
       and b.contact like '%@%'
       and b.status <> 'suspended'
  ),
  picked as (
    select * from eligible e
     where (v_contact <> '' and e.contact = v_contact)
        or (v_contact = ''
            -- LIST mode: consent first, then the same segment/search grammar
            -- admin_member_roster uses, so the count matches the roster.
            and not e.opt_out
            and (p_segment = 'all'
                 or (p_segment = 'vip' and e.vip)
                 or (p_segment = 'reward-ready' and e.reward_ready)
                 or e.segment = p_segment)
            and (v_search is null
                 or e.name    ilike '%' || v_search || '%'
                 or e.contact ilike '%' || v_search || '%'))
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId',    p.user_id,
        'name',      p.name,
        'contact',   p.contact,
        'segment',   p.segment,
        'vip',       p.vip,
        'tier',      p.tier,
        'joinedIso', p.joined_iso,
        'optOut',    p.opt_out
      ) order by p.name)
      from picked p
    ), '[]'::jsonb),
    'total', (select count(*) from picked)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_campaign_recipients(text, text, text) from public, anon;
grant  execute on function admin_campaign_recipients(text, text, text) to authenticated;

-- ── 3. Redeem on a member's behalf ─────────────────────────────────────────
--
-- Mirrors redeem_reward() (050) exactly — 300 points for 40% off one item, one
-- active voucher at a time — with three differences: the caller is an admin,
-- the ledger row is attributed to that admin with a mandatory note, and the
-- action is audit-logged. Points are SPENT here, so this is a real debit: the
-- member is one voucher richer and 300 points poorer, same as if they had
-- pressed the button in their own portal.

create or replace function admin_redeem_reward_for(p_user_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_threshold constant integer := 300;
  v_percent   constant integer := 40;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_balance   integer;
  v_id        uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_user_id is null then
    raise exception 'A member is required';
  end if;
  -- The note is the paper trail for a balance the admin spent on someone
  -- else's behalf. Same posture as admin_adjust_reward_points (044).
  if v_note is null then
    raise exception 'A note is required';
  end if;

  if exists (select 1 from reward_vouchers where user_id = p_user_id and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'This member already has an active reward voucher.');
  end if;

  select coalesce(sum(points), 0) into v_balance from reward_ledger where user_id = p_user_id;
  if v_balance < v_threshold then
    return jsonb_build_object('ok', false, 'reason',
      format('This member has %s points; %s are needed.', v_balance, v_threshold));
  end if;

  insert into reward_ledger (user_id, order_id, kind, points, note, created_by)
  values (p_user_id, null, 'redemption', -v_threshold,
          format('Redeemed %s%% off one item by admin — %s', v_percent, v_note), auth.uid());

  insert into reward_vouchers (user_id, reward_kind, percent, points_spent, status)
  values (p_user_id, 'item_percent', v_percent, v_threshold, 'active')
  returning id into v_id;

  perform log_audit(
    'reward.redeemed_by_admin', 'customer', p_user_id::text,
    format('Redeemed %s points for a %s%% voucher', v_threshold, v_percent),
    jsonb_build_object('balance', v_balance),
    jsonb_build_object('voucher_id', v_id, 'percent', v_percent, 'note', v_note),
    null
  );

  return jsonb_build_object('ok', true, 'voucherId', v_id, 'percent', v_percent,
                            'balance', v_balance - v_threshold);
end;
$$;

revoke execute on function admin_redeem_reward_for(uuid, text) from public, anon;
grant  execute on function admin_redeem_reward_for(uuid, text) to authenticated;
