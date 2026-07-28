-- 074_tier_discount_floor.sql
--
-- Make the automatic account-holder discount floor TIER-AWARE: the base
-- 'member' tier keeps the 15% floor introduced in 069; the paid 'pro' tier
-- (customer_profiles.tier, 028/043) is floored at 20%.
--
-- Before (069): every account holder (customer_profiles row) got a flat 15%
-- lifetime floor regardless of tier; an admin-assigned customer_discounts rule
-- of >= 15% was honored verbatim, a lower one was replaced by the floor.
--
-- After: the floor is read from the caller's tier — member → 15%
-- ('Account-holder 15%'), pro → 20% ('Pro member 20%') — still scope
-- 'lifetime', discount_id null. An assigned rule that meets or beats the
-- CALLER'S TIER FLOOR is honored verbatim (same max-wins logic as 069, only
-- the comparison threshold changed); below it, the tier floor replaces it. A
-- pro with an assigned 22% keeps 22%; a pro with an assigned 15% is raised to
-- the 20% pro floor. Non-account auth users (no profile row) still get
-- {found:false}.
--
-- Unchanged: place-order needs no change — the handler reads {found, scope,
-- percent, label} generically and derives the code / synthetic order_coupons
-- row from scope alone (verified at handler.ts:639). The bundle and wholesale
-- gates in place-order still NULL this discount out (both are final prices), so
-- neither floor ever reaches a paired-bundle or volume order.
--
-- Same signature, security-definer posture, and service-role-only execute grant
-- as 069; the only change is the SELECT body.
--
-- Rollback: forward-fix only — re-apply the 069 body (flat 15% floor) as a new
-- migration if the tier-aware floor must be reverted.

create or replace function effective_customer_discount(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with assigned as (
    -- The highest active, in-window rule the customer was explicitly granted,
    -- exactly as migration 045 resolved it (lifetime → any account; business →
    -- business accounts only). At most one winner.
    select cd.scope, cd.percent, cd.label, cd.id
      from customer_discounts cd
     where cd.user_id = p_user_id
       and cd.active
       and (cd.starts_at  is null or now() >= cd.starts_at)
       and (cd.expires_at is null or now() <= cd.expires_at)
       and (cd.scope = 'lifetime'
            or exists (
              select 1 from customer_profiles cp
              where cp.user_id = cd.user_id
                and cp.account_type = 'business'
            ))
     order by cd.percent desc, cd.created_at desc
     limit 1
  ),
  tier_floor as (
    -- The caller's tier sets the automatic floor: member → 15, pro → 20.
    -- Primary-key lookup, so at most one row; empty when no profile exists
    -- (that case short-circuits to {found:false} below).
    select case when cp.tier = 'pro' then 20 else 15 end as percent,
           case when cp.tier = 'pro' then 'Pro member 20%'
                else 'Account-holder 15%' end as label
      from customer_profiles cp
     where cp.user_id = p_user_id
  )
  select case
    -- Not an account holder (no profile row) → no entitlement, as before.
    when not exists (
      select 1 from customer_profiles cp where cp.user_id = p_user_id
    ) then jsonb_build_object('found', false)

    -- Assigned rate meets or beats the caller's TIER floor → honor it verbatim.
    when coalesce((select percent from assigned), 0)
         >= (select percent from tier_floor) then
      (select jsonb_build_object(
         'found',       true,
         'scope',       scope,
         'percent',     percent,
         'label',       label,
         'discount_id', id
       ) from assigned)

    -- Account holder with no rule, or a rule below the tier floor → the
    -- automatic tier floor. Lifetime scope so it applies to any account.
    else jsonb_build_object(
      'found',       true,
      'scope',       'lifetime',
      'percent',     (select percent from tier_floor),
      'label',       (select label from tier_floor),
      'discount_id', null
    )
  end;
$$;

-- Execute posture unchanged from 045/069: service-role only. No client role may
-- probe eligibility for arbitrary user ids.
revoke execute on function effective_customer_discount(uuid) from public, anon, authenticated;

comment on function effective_customer_discount(uuid) is
  'Account-holder order discount, resolved server-side. Every account holder (customer_profiles row) gets an automatic lifetime floor keyed to their tier — member 15%, pro 20% (074; flat 15% in 069) — and a higher admin-assigned rule wins. Bundle/wholesale orders suppress it in place-order.';
