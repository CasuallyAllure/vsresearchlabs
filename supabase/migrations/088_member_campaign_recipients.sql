-- 088_member_campaign_recipients.sql
-- ---------------------------------------------------------------------------
-- One read surface for admin-composed member campaigns (the "here is an offer"
-- broadcast). It is a LENS, like every other admin_member_* function: it reads
-- member_roster_base (071) and customer_profiles.marketing_opt_out (075) and
-- owns nothing.
--
--   admin_campaign_recipients(p_segment, p_search, p_contact)
--
-- Two modes, one function, because both answer the same question and must
-- agree on who is eligible:
--   • LIST  (p_contact null) — everyone in the segment who has a usable email
--     AND has not opted out of marketing. This is what the admin sees and what
--     the recipient count means.
--   • LOOKUP (p_contact set) — that single member, opt-out INCLUDED, so the
--     send-member-offer edge function can refuse the send and report
--     "opted_out" instead of silently dropping it (the send-prepared-cart
--     consent posture, 082/083).
--
-- Marketing consent is enforced HERE, next to the column, so it cannot be
-- forgotten by a caller. Admin-gated SECURITY DEFINER (member_roster_base has
-- no grants and joins tables under mixed RLS) — same exposure as
-- admin_member_roster.
--
-- Additive + idempotent. No new grants to anon.
-- Rollback notes: DB is forward-fix only. To revert, deploy a later migration
--   dropping this function. Nothing else references it.

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
