-- 069_default_member_discount.sql
--
-- Make the 15% account-holder discount AUTOMATIC for every account holder,
-- not just those an admin individually assigned a `customer_discounts` row.
--
-- Before: effective_customer_discount (045) returned {found:false} unless the
-- signed-in customer had an explicit active discount row — so the advertised
-- "members get 15%" was actually delivered by the member-gated code Q3MEMBER15
-- that the shopper had to type at checkout. The MemberAccessGate / wholesale
-- copy already claimed the discount was "applied automatically"; this makes
-- that true.
--
-- After: any signed-in ACCOUNT HOLDER (has a customer_profiles row) gets a
-- default 15% lifetime discount, resolved SERVER-SIDE at checkout. A customer
-- the admin assigned a HIGHER rate keeps it (max wins); a lower assigned rate
-- is floored to 15%. Non-account auth users (no profile row) still get nothing.
--
-- Unchanged: the handler still reads {found, scope, percent, label} and derives
-- the code (ACCT-LIFETIME / ACCT-BUSINESS) and synthetic order_coupons row, so
-- no edge-function change is needed. The bundle and wholesale gates in
-- place-order still NULL this discount out (both are final prices) — a default
-- 15% never reaches a paired-bundle or volume order.
--
-- Same signature, security-definer posture, and service-role-only execute grant
-- as 045; the only change is the SELECT body.

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
  )
  select case
    -- Not an account holder (no profile row) → no entitlement, as before.
    when not exists (
      select 1 from customer_profiles cp where cp.user_id = p_user_id
    ) then jsonb_build_object('found', false)

    -- Assigned rate meets or beats the 15% floor → honor it verbatim.
    when coalesce((select percent from assigned), 0) >= 15 then
      (select jsonb_build_object(
         'found',       true,
         'scope',       scope,
         'percent',     percent,
         'label',       label,
         'discount_id', id
       ) from assigned)

    -- Account holder with no rule, or a rule below 15% → the automatic
    -- account-holder floor. Lifetime scope so it applies to any account.
    else jsonb_build_object(
      'found',       true,
      'scope',       'lifetime',
      'percent',     15,
      'label',       'Account-holder 15%',
      'discount_id', null
    )
  end;
$$;

-- Execute posture unchanged from 045: service-role only. No client role may
-- probe eligibility for arbitrary user ids.
revoke execute on function effective_customer_discount(uuid) from public, anon, authenticated;

comment on function effective_customer_discount(uuid) is
  'Account-holder order discount, resolved server-side. Every account holder (customer_profiles row) gets a default 15% lifetime floor; a higher admin-assigned rule wins. Bundle/wholesale orders suppress it in place-order. Default made automatic in 069 (was assignment-only in 045).';
