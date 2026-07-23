-- 071_membership_admin_surface.sql
-- ---------------------------------------------------------------------------
-- Membership Phase 0 (2/2): the admin read surface — the server-side truth the
-- Members control center renders. Every statistic the UI shows comes from here;
-- no client-side estimation. This is a LENS over the existing customer
-- ecosystem — it reads customer_profiles, customers, orders, reward_ledger,
-- reward_vouchers, customer_discounts, member_invites and audit_log, and owns
-- none of them. No new customer store.
--
--   • member_roster_base (view) — ONE place that computes per-member
--     aggregates (spend, trailing-12-month spend, paid orders, last order,
--     real reward-ledger balance, active vouchers, effective discount via the
--     canonical effective_customer_discount(), computed segment + VIP + reward-
--     ready). Internal only: no grants; read solely by the definer functions
--     below. Reuse over duplication — roster, stats and distribution all share
--     it, so a rule change (e.g. a new segment threshold) happens in one place.
--   • admin_member_stats()          — the KPI strip, one call, one jsonb object.
--   • admin_member_roster(...)      — the paged/filtered/sorted roster.
--   • admin_member_activity(uuid)   — a member's merged activity timeline
--     (UNION over existing tables — no events table, no new write path).
--   • admin_member_spend_distribution() — real percentile breakpoints of
--     trailing-12-month spend, so tier gates (Phase 3) are set from behaviour,
--     not guessed round numbers.
--
-- Expansion by design: every function returns jsonb, so new fields (a benefit
-- flag, a new KPI, a new segment) append without changing any signature — the
-- UI evolves without a data-layer redesign. Tier is passed through as data, so
-- adding a tier (Phase 3) needs only a check-constraint change, not new code
-- here.
--
-- Admin-gated SECURITY DEFINER throughout (mirrors admin_adjust_reward_points):
-- authorization flows through is_admin() everywhere, and the roster joins
-- tables under mixed RLS regimes, so a gated definer function is the correct
-- exposure — never a plain RLS view (which would bypass RLS) or a
-- security_invoker view (which the caller lacks read grants for).
--
-- Additive + idempotent. No new grants to anon anywhere.
-- Rollback notes: DB is forward-fix only. To revert, deploy a later migration
--   dropping these four functions and the view. Nothing else references them.
--
-- Performance note: member_roster_base recomputes on each call. At today's
-- member scale that is well within an admin request budget. If it ever grows
-- past comfortable, promote it to a materialized view refreshed on a schedule
-- (the function signatures do not change) — that is the intended scaling path.

-- ── Shared per-member base (internal; no grants) ───────────────────────────

create or replace view member_roster_base as
with members as (
  select cp.user_id, cp.customer_id, cp.tier, cp.status, cp.account_type,
         cp.business_name, cp.free_shipping, cp.created_at as joined_at,
         cp.full_name,
         c.contact_key, c.display_name, c.contact, c.organization
    from customer_profiles cp
    left join customers c on c.id = cp.customer_id
   -- Members are portal customers, never admin/staff accounts.
   where not exists (select 1 from admin_users a where a.user_id = cp.user_id)
),
orders_agg as (
  -- Attribute an order to a member by owned user_id first, falling back to the
  -- CRM contact_key only for orders not yet linked to any account — so an
  -- owned order never double-attributes to a second member by contact.
  select m.user_id,
         coalesce(sum(o.invoice_amount_cents) filter (where o.status in ('paid','fulfilled')), 0) as spend_cents,
         coalesce(sum(o.invoice_amount_cents) filter (where o.status in ('paid','fulfilled')
                    and o.paid_at >= now() - interval '12 months'), 0) as ttm_spend_cents,
         count(*) filter (where o.status in ('paid','fulfilled')) as paid_orders,
         max(o.paid_at) filter (where o.status in ('paid','fulfilled')) as last_order_at
    from members m
    left join orders o
      on (o.user_id = m.user_id)
      or (o.user_id is null and m.contact_key is not null
          and lower(btrim(o.buyer_contact)) = m.contact_key)
   group by m.user_id
),
rewards_agg as (
  select user_id, coalesce(sum(points), 0) as points_balance
    from reward_ledger group by user_id
),
voucher_agg as (
  select user_id, count(*) filter (where status = 'active') as active_vouchers
    from reward_vouchers group by user_id
)
select
  m.user_id,
  m.customer_id,
  coalesce(m.display_name, m.full_name)                                   as name,
  coalesce(m.contact, (select u.email from auth.users u where u.id = m.user_id)) as contact,
  m.organization                                                          as org,
  m.tier,
  m.status,
  m.account_type,
  m.business_name,
  m.free_shipping,
  m.joined_at,
  coalesce(oa.spend_cents, 0)                                             as spend_cents,
  coalesce(oa.ttm_spend_cents, 0)                                         as ttm_spend_cents,
  coalesce(oa.paid_orders, 0)                                             as paid_orders,
  oa.last_order_at,
  coalesce(ra.points_balance, 0)                                          as points_balance,
  coalesce(va.active_vouchers, 0)                                         as active_vouchers,
  effective_customer_discount(m.user_id)                                  as discount,
  -- Segment (thresholds documented once, here): new = joined <30d with ≤1
  -- paid order; active = paid order within 60d; at-risk = 60–120d; else dormant.
  case
    when m.joined_at >= now() - interval '30 days' and coalesce(oa.paid_orders, 0) <= 1 then 'new'
    when oa.last_order_at is not null and oa.last_order_at >= now() - interval '60 days'  then 'active'
    when oa.last_order_at is not null and oa.last_order_at >= now() - interval '120 days' then 'at-risk'
    else 'dormant'
  end                                                                     as segment,
  -- Reward-ready: at/over the 300-pt redemption threshold with no voucher out.
  (coalesce(ra.points_balance, 0) >= 300 and coalesce(va.active_vouchers, 0) = 0) as reward_ready,
  -- VIP: top ~10% of members by trailing-12-month spend (data-driven; no $ hardcode).
  (percent_rank() over (order by coalesce(oa.ttm_spend_cents, 0)) >= 0.90
     and coalesce(oa.ttm_spend_cents, 0) > 0)                             as vip,
  percent_rank() over (order by coalesce(oa.ttm_spend_cents, 0))          as spend_percentile
from members m
left join orders_agg  oa on oa.user_id = m.user_id
left join rewards_agg ra on ra.user_id = m.user_id
left join voucher_agg va on va.user_id = m.user_id;

revoke all on member_roster_base from anon, authenticated;

-- ── KPI strip ──────────────────────────────────────────────────────────────

create or replace function admin_member_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with b as (
    select * from member_roster_base
  ),
  member_ids as (select user_id from b),
  member_cks as (select distinct lower(btrim(contact)) as ck from b where contact is not null),
  otag as (
    -- coalesce(...) is load-bearing: `null in (...)` yields NULL, and
    -- `NULL or false` is NULL — an unattributed guest order would then fall
    -- into NEITHER bucket and the member/guest split would not sum to total.
    select o.invoice_amount_cents as amt,
           coalesce(
             o.user_id in (select user_id from member_ids)
             or lower(btrim(o.buyer_contact)) in (select ck from member_cks),
             false
           ) as is_member
      from orders o
     where o.status in ('paid', 'fulfilled')
       and o.paid_at >= now() - interval '90 days'
  ),
  rev as (
    select
      coalesce(sum(amt), 0)                                as total_90,
      coalesce(sum(amt) filter (where is_member), 0)       as member_90,
      coalesce(sum(amt) filter (where not is_member), 0)   as guest_90,
      count(*) filter (where is_member)                    as member_orders_90,
      count(*) filter (where not is_member)                as guest_orders_90
      from otag
  ),
  inv as (
    select count(*) as sent, count(*) filter (where converted_at is not null) as converted
      from member_invites
  )
  select jsonb_build_object(
    'generatedAt',            to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'membersTotal',           (select count(*) from b),
    'newThisMonth',           (select count(*) from b where joined_at >= date_trunc('month', now())),
    'segments', jsonb_build_object(
        'new',     (select count(*) from b where segment = 'new'),
        'active',  (select count(*) from b where segment = 'active'),
        'atRisk',  (select count(*) from b where segment = 'at-risk'),
        'dormant', (select count(*) from b where segment = 'dormant'),
        'vip',     (select count(*) from b where vip)
    ),
    'atRisk',                 (select count(*) from b where segment = 'at-risk'),
    'vip',                    (select count(*) from b where vip),
    'pointsLiability',        (select coalesce(sum(points_balance), 0) from b),
    'activeVouchers',         (select coalesce(sum(active_vouchers), 0) from b),
    'rewardReady',            (select count(*) from b where reward_ready),
    'memberRevenueSharePct',  (select case when total_90 > 0 then round(100.0 * member_90 / total_90) else 0 end from rev),
    'memberAovCents',         (select case when member_orders_90 > 0 then round(member_90::numeric / member_orders_90) else 0 end from rev),
    'guestAovCents',          (select case when guest_orders_90 > 0 then round(guest_90::numeric / guest_orders_90) else 0 end from rev),
    'invitesSent',            (select sent from inv),
    'invitesConverted',       (select converted from inv),
    'inviteConversionPct',    (select case when sent > 0 then round(100.0 * converted / sent) else 0 end from inv)
  ) into v;

  return v;
end;
$$;

revoke execute on function admin_member_stats() from public, anon;
grant  execute on function admin_member_stats() to authenticated;

-- ── Roster (paged / filtered / sorted) ─────────────────────────────────────

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

-- ── Member activity timeline (UNION over existing tables) ──────────────────

create or replace function admin_member_activity(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id     uuid;
  v_contact_key text;
  v_events      jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select c.contact_key into v_contact_key from customers c where c.id = p_customer_id;
  select cp.user_id     into v_user_id     from customer_profiles cp where cp.customer_id = p_customer_id limit 1;

  with events as (
    select cp.created_at as ts, 'joined'::text as kind,
           'Joined — portal account created'::text as label, null::text as ref
      from customer_profiles cp where cp.user_id = v_user_id
    union all
    select coalesce(o.paid_at, o.created_at), 'order',
           format('Order %s — %s', o.order_number, o.status), o.id::text
      from orders o
     where (v_user_id is not null and o.user_id = v_user_id)
        or (v_contact_key is not null and lower(btrim(o.buyer_contact)) = v_contact_key)
    union all
    select rl.created_at, 'reward',
           format('%s%s pts — %s',
                  case when rl.points > 0 then '+' else '' end, rl.points,
                  coalesce(rl.note, rl.kind)),
           rl.order_id::text
      from reward_ledger rl where rl.user_id = v_user_id
    union all
    select rv.created_at, 'voucher',
           format('Reward voucher %s (%s%%)', rv.status, rv.percent), rv.id::text
      from reward_vouchers rv where rv.user_id = v_user_id
    union all
    select cd.created_at, 'discount',
           format('Discount %s%% (%s) — %s', cd.percent, cd.scope, cd.label), cd.id::text
      from customer_discounts cd where cd.user_id = v_user_id
    union all
    select mi.sent_at, 'invite',
           format('Invite sent (%s)', mi.channel), mi.id::text
      from member_invites mi where mi.contact_key = v_contact_key
    union all
    select mi.converted_at, 'invite',
           'Invite converted — signed up'::text, mi.id::text
      from member_invites mi where mi.contact_key = v_contact_key and mi.converted_at is not null
    union all
    select al.occurred_at, 'audit', coalesce(al.summary, al.action), al.entity_id
      from audit_log al
     where al.entity_type = 'customer'
       and (al.entity_id = p_customer_id::text
            or (v_user_id is not null and al.entity_id = v_user_id::text))
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'ts',   to_char(ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'iso',  to_char(ts, 'YYYY-MM-DD'),
             'kind', kind,
             'label', label,
             'ref',  ref
           ) order by ts desc
         ), '[]'::jsonb)
    into v_events
    from events
   where ts is not null;

  return jsonb_build_object('customerId', p_customer_id, 'userId', v_user_id, 'events', v_events);
end;
$$;

revoke execute on function admin_member_activity(uuid) from public, anon;
grant  execute on function admin_member_activity(uuid) to authenticated;

-- ── Trailing-12-month spend distribution (tier-threshold input) ────────────

create or replace function admin_member_spend_distribution()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with b as (
    select ttm_spend_cents from member_roster_base where ttm_spend_cents > 0
  )
  select jsonb_build_object(
    'basis',                 'trailing_12_month_paid_spend_cents',
    'activeSpenders',        (select count(*) from b),
    'p50',                   (select percentile_cont(0.50) within group (order by ttm_spend_cents) from b),
    'p60',                   (select percentile_cont(0.60) within group (order by ttm_spend_cents) from b),
    'p70',                   (select percentile_cont(0.70) within group (order by ttm_spend_cents) from b),
    'p80',                   (select percentile_cont(0.80) within group (order by ttm_spend_cents) from b),
    'p90',                   (select percentile_cont(0.90) within group (order by ttm_spend_cents) from b),
    'p95',                   (select percentile_cont(0.95) within group (order by ttm_spend_cents) from b),
    -- Blueprint gates: Pro ≈ top 30–40% (≈ p65 breakpoint), VIP ≈ top 5–10% (p90).
    'suggestedProGateCents', (select percentile_cont(0.65) within group (order by ttm_spend_cents) from b),
    'suggestedVipGateCents', (select percentile_cont(0.90) within group (order by ttm_spend_cents) from b),
    'generatedAt',           to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) into v;

  return v;
end;
$$;

revoke execute on function admin_member_spend_distribution() from public, anon;
grant  execute on function admin_member_spend_distribution() to authenticated;
