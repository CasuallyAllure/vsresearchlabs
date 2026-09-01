-- 091_automation_kinds_review_referral.sql
-- ---------------------------------------------------------------------------
-- Two new kinds for the 075 automation engine, plus the settlement hook the
-- runner calls before it evaluates them:
--
--   • review_request  — the ask that drives the completed-order review program
--     (089). Candidates are DELIVERED orders with no review yet. One ask per
--     order, ever: period_key is the order id.
--   • referral_bonus  — tells a referrer their friend qualified and hands them
--     the BONUS- code settle_referral_conversions() (090) just issued. One per
--     conversion, ever.
--
-- Both are seeded OFF by their own migrations; this only teaches
-- automation_candidates how to find them. The function is REPLACED whole (it
-- is one if/elsif chain) — the five 075 branches are reproduced verbatim.
--
-- The review candidate carries the order's `token`. The runner strips that
-- field before it writes email_log.metadata — a review link is a bearer
-- secret and does not belong in a log table (see member-automations/handler.ts).
--
-- Additive + idempotent. Rollback: forward-fix only; a later migration can
-- restore 075's body and disable both settings rows.
-- ---------------------------------------------------------------------------

create or replace function automation_candidates(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v jsonb;
begin
  if p_kind = 'reward_ready' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', b.user_id, 'recipient', u.email,
             'periodKey', 'rr-' || floor(b.balance / 300.0)::int,
             'points', b.balance)), '[]'::jsonb)
      into v
      from (select user_id, sum(points)::int as balance
              from reward_ledger group by user_id) b
      join auth.users u on u.id = b.user_id
     where b.balance >= 300
       and u.email is not null
       and not exists (select 1 from reward_vouchers rv
                        where rv.user_id = b.user_id and rv.status = 'active');

  elsif p_kind = 'invite_followup' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', null, 'recipient', mi.email,
             'periodKey', 'inv-' || mi.id,
             'pointsPromised', mi.points_promised)), '[]'::jsonb)
      into v
      from member_invites mi
     where mi.converted_at is null
       and mi.sent_at <= now() - interval '7 days'
       and mi.sent_at >= now() - interval '30 days';

  elsif p_kind = 'winback' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', lp.user_id, 'recipient', lp.email,
             'periodKey', 'wb-' || to_char(now(), 'YYYY"Q"Q'))), '[]'::jsonb)
      into v
      from (
        select cp.user_id, u.email, max(o.paid_at) as last_paid_at
          from customer_profiles cp
          join auth.users u on u.id = cp.user_id
          left join customers c on c.id = cp.customer_id
          join orders o
            on (o.user_id = cp.user_id)
            or (o.user_id is null and c.contact_key is not null
                and lower(btrim(o.buyer_contact)) = c.contact_key)
         where cp.marketing_opt_out = false
           and u.email is not null
           and o.status in ('paid', 'fulfilled')
           and o.paid_at is not null
           and not exists (select 1 from admin_users a where a.user_id = cp.user_id)
         group by cp.user_id, u.email
      ) lp
     where lp.last_paid_at <= now() - interval '60 days'
       and lp.last_paid_at >= now() - interval '120 days';

  elsif p_kind = 'discount_expiry' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', cd.user_id, 'recipient', u.email,
             'periodKey', 'de-' || cd.id,
             'label', cd.label, 'percent', cd.percent,
             'expiresOn', to_char(cd.expires_at, 'YYYY-MM-DD'))), '[]'::jsonb)
      into v
      from customer_discounts cd
      join auth.users u on u.id = cd.user_id
     where cd.active
       and u.email is not null
       and cd.expires_at is not null
       and cd.expires_at > now()
       and cd.expires_at <= now() + interval '14 days';

  elsif p_kind = 'welcome' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', cp.user_id, 'recipient', u.email,
             'periodKey', 'wc-once')), '[]'::jsonb)
      into v
      from customer_profiles cp
      join auth.users u on u.id = cp.user_id
     where cp.created_at >= now() - interval '3 days'
       and u.email is not null
       and not exists (select 1 from admin_users a where a.user_id = cp.user_id);

  elsif p_kind = 'review_request' then
    -- Delivered orders with no review yet. Eligibility is order_review_eligible
    -- (089) — the SAME predicate the form gates on, so the link in this email
    -- can never open a form that refuses it. Members who opted out of
    -- marketing are skipped; guests (no profile) are asked.
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', o.user_id, 'recipient', lower(btrim(o.buyer_contact)),
             'periodKey', 'rev-' || o.id,
             'orderNumber', o.order_number,
             'name', review_display_name(o.buyer_name),
             'token', o.lookup_token)), '[]'::jsonb)
      into v
      from orders o
      left join customer_profiles cp on cp.user_id = o.user_id
     where order_review_eligible(o)
       and o.buyer_contact is not null
       and btrim(o.buyer_contact) <> ''
       and o.lookup_token is not null
       and coalesce(cp.marketing_opt_out, false) = false
       and not exists (select 1 from order_reviews r where r.order_id = o.id);

  elsif p_kind = 'referral_bonus' then
    -- Conversions settled by settle_referral_conversions() (090) whose bonus
    -- code has been minted. One notice per conversion, ever.
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', rc.referrer_user_id, 'recipient', u.email,
             'periodKey', 'rb-' || rc.id,
             'code', rc.bonus_code,
             'percent', referral_bonus_percent(),
             'expiresOn', to_char(c.expires_at, 'YYYY-MM-DD'))), '[]'::jsonb)
      into v
      from referral_conversions rc
      join auth.users u on u.id = rc.referrer_user_id
      left join coupons c on c.id = rc.bonus_coupon_id
     where rc.bonus_code is not null
       and u.email is not null;

  else
    raise exception 'Unknown automation kind: %', coalesce(p_kind, '(null)');
  end if;

  return v;
end;
$$;

revoke execute on function automation_candidates(text) from public, anon, authenticated;
