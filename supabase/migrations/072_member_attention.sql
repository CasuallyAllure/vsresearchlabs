-- 072_member_attention.sql
-- ---------------------------------------------------------------------------
-- Membership Phase 0 (3/3): the "Needs attention" action queue, server-side.
--
-- The approved Members cockpit surfaces a prioritized action queue. Three of
-- its facts are not derivable from admin_member_stats() — VIP members who have
-- gone at-risk, custom discounts about to lapse, and invites left hanging.
-- Computing them in the browser would be exactly the client-side estimation we
-- are removing, so they are computed here.
--
--   • admin_member_attention() — returns only the items that currently have a
--     non-zero count, each as {kind, tone, count, detail}. STRUCTURED, not
--     prose: the server owns the numbers, the client owns the wording. Adding
--     a future queue item (a failing automation, an expiring benefit) means
--     appending one UNION branch — the signature never changes.
--
-- Reuses member_roster_base (071) for the member set + segments, so segment
-- thresholds stay defined in exactly one place. Reads customer_discounts and
-- member_invites directly; owns no state.
--
-- Additive + idempotent. No new grants to anon anywhere.
-- Rollback notes: forward-fix only — a later migration may drop this function.
--   Nothing else depends on it.

create or replace function admin_member_attention()
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
  vip_risk as (
    select count(*) as n, coalesce(sum(spend_cents), 0) as lifetime_cents
      from b where vip and segment = 'at-risk'
  ),
  ready as (
    select count(*) as n from b where reward_ready
  ),
  expiring as (
    select count(*) as n
      from customer_discounts cd
     where cd.active
       and cd.expires_at is not null
       and cd.expires_at between now() and now() + interval '14 days'
       and exists (select 1 from b where b.user_id = cd.user_id)
  ),
  stale_invites as (
    select count(*) as n
      from member_invites
     where converted_at is null
       and sent_at < now() - interval '7 days'
  )
  select jsonb_build_object(
    'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items', (
      select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
        from (
          select 1 as ord,
                 jsonb_build_object(
                   'kind', 'vip_at_risk', 'tone', 'warn',
                   'count', (select n from vip_risk),
                   'detail', jsonb_build_object('lifetimeCents', (select lifetime_cents from vip_risk))
                 ) as item
           where (select n from vip_risk) > 0
          union all
          select 2,
                 jsonb_build_object(
                   'kind', 'reward_ready', 'tone', 'good',
                   'count', (select n from ready), 'detail', '{}'::jsonb
                 )
           where (select n from ready) > 0
          union all
          select 3,
                 jsonb_build_object(
                   'kind', 'discount_expiring', 'tone', 'warn',
                   'count', (select n from expiring), 'detail', '{}'::jsonb
                 )
           where (select n from expiring) > 0
          union all
          select 4,
                 jsonb_build_object(
                   'kind', 'invites_stale', 'tone', 'warn',
                   'count', (select n from stale_invites), 'detail', '{}'::jsonb
                 )
           where (select n from stale_invites) > 0
        ) s
    )
  ) into v;

  return v;
end;
$$;

revoke execute on function admin_member_attention() from public, anon;
grant  execute on function admin_member_attention() to authenticated;
