-- 090_referral_bonus_program.sql
-- ---------------------------------------------------------------------------
-- "Invite a friend — you both get an extra 15% off." Turns the dormant 076
-- referral rails into a live two-sided program, still on the EXISTING coupon
-- machinery: no new discount engine, no new money math.
--
-- The offer, exactly:
--   • The friend joins, and within 10 DAYS of creating their account places a
--     paid order with the member's REF- code. They pay 15% under their
--     automatic account rate — coupon percents and the account rate are two
--     slices off the same base in place-order, so a 15% code is "an extra 15%".
--   • That order qualifies the referrer, who is issued a personal one-use
--     BONUS- code, also 15%, good for 30 days.
--
-- WHAT CHANGES FROM 076, AND WHY
--   1. The REF- coupon was `exclusive` (use alone) at 10%. `exclusive` makes
--      validate_coupon REJECT the code for anyone holding an account discount
--      — i.e. for every member — so a referred friend who signed up could not
--      actually use it. The posture becomes: 15%, combines with the account
--      rate, combines with nothing else, requires an account, once per contact.
--   2. 076 leaned on `exclusive` as its self-referral guard. Removing it means
--      the guard must become real, so referral_code_block_reason() is now
--      consulted by BOTH validate_coupon (quote time) and redeem_coupon
--      (money time): a member cannot use their own code under any contact, and
--      the code only works inside the 10-day window.
--   3. Payout is a coupon, not the 076 header's "reward points" plan — points
--      are not "15% off", and the coupon path is already audited end to end
--      (coupon_redemptions). No cash commission is ever accrued: the member's
--      affiliate row stays at 0%.
--
-- Settlement is a scheduled SQL verb (settle_referral_conversions), called by
-- the member-automations runner, and it is idempotent: referral_conversions
-- has UNIQUE (order_id), so a re-run grants nothing twice.
--
-- Additive + idempotent. No new grants to anon.
-- Rollback notes: DB is forward-fix only. To revert the OFFER, deactivate the
--   REF-/BONUS- coupons from the admin console; to revert the CODE, deploy a
--   later migration restoring 076's validate_coupon/redeem_coupon bodies.
-- ---------------------------------------------------------------------------

-- ── 1. The referral window, in one named place ─────────────────────────────

create or replace function referral_window_days()
returns integer
language sql
immutable
as $$ select 10; $$;

create or replace function referral_bonus_percent()
returns integer
language sql
immutable
as $$ select 15; $$;

revoke execute on function referral_window_days()   from public, anon, authenticated;
revoke execute on function referral_bonus_percent() from public, anon, authenticated;

-- ── 2. Owner contact on the mapping row ────────────────────────────────────
-- Denormalized so the money-path guard never has to reach into auth.

alter table member_referral_codes
  add column if not exists owner_contact text;

update member_referral_codes mrc
   set owner_contact = lower(btrim(u.email))
  from auth.users u
 where u.id = mrc.user_id
   and mrc.owner_contact is distinct from lower(btrim(u.email));

create index if not exists member_referral_codes_coupon_idx
  on member_referral_codes (coupon_id);

-- ── 3. Repoint every issued REF- coupon to the new posture ─────────────────

update coupons c
   set percent               = referral_bonus_percent(),
       exclusive             = false,
       combines_with_account = true,
       combines_with_codes   = false,
       combines_with_promos  = false,
       requires_account      = true,
       once_per_contact      = true,
       updated_at            = now()
  from member_referral_codes mrc
 where mrc.coupon_id = c.id;

-- ── 4. THE GUARD — consulted at quote time AND at money time ───────────────
--
-- Returns null when the code is fine, or the buyer-facing reason it is not.
-- Non-referral coupons always return null, so both callers can consult it
-- unconditionally.

create or replace function referral_code_block_reason(
  p_coupon_id uuid,
  p_contact   text,
  p_user_id   uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  mrc       member_referral_codes%rowtype;
  v_contact text := lower(btrim(coalesce(p_contact, '')));
  v_user    uuid := p_user_id;
  v_joined  timestamptz;
begin
  select * into mrc from member_referral_codes where coupon_id = p_coupon_id;
  if not found then
    return null;  -- not a referral code; nothing to say
  end if;

  -- Self-use, by account or by contact. 076 relied on `exclusive` for this;
  -- now that referral codes intentionally combine with the account rate, this
  -- check IS the guard.
  if v_user is not null and v_user = mrc.user_id then
    return 'A referral code cannot be used on your own order.';
  end if;
  if v_contact <> '' and mrc.owner_contact is not null
     and v_contact = lower(btrim(mrc.owner_contact)) then
    return 'A referral code cannot be used on your own order.';
  end if;

  -- Resolve the buyer's account from the contact when the caller did not
  -- supply one (validate_coupon runs for signed-out quotes too).
  if v_user is null and v_contact <> '' then
    select u.id into v_user from auth.users u where lower(btrim(u.email)) = v_contact;
  end if;
  if v_user is null then
    return 'Referral codes are for new member accounts — create an account to use this code.';
  end if;

  select cp.created_at into v_joined from customer_profiles cp where cp.user_id = v_user;
  if v_joined is null then
    return 'Referral codes are for new member accounts — create an account to use this code.';
  end if;

  -- The window: joined, then bought inside it.
  if v_joined < now() - (referral_window_days() || ' days')::interval then
    return format('Referral codes apply to a first order placed within %s days of joining.',
                  referral_window_days());
  end if;

  return null;
end;
$$;

-- No grants: its only callers are validate_coupon and redeem_coupon, both
-- SECURITY DEFINER, which execute it with the owner's privileges. Granting it
-- to anon would expose a probe for "is this address a member, and how old is
-- the account" — the guard says more than the coupon answer should.
revoke execute on function referral_code_block_reason(uuid, text, uuid) from public, anon, authenticated;

-- ── 5. validate_coupon — same signature, one extra consultation ────────────
-- Body is 057's, with the referral guard added after the combinability gate.

create or replace function validate_coupon(
  p_code           text,
  p_subtotal_cents integer default 0,
  p_contact        text    default null,
  p_applied_codes  text[]  default '{}',
  p_has_reward     boolean default false,
  p_has_promo      boolean default false,
  p_has_account    boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_subtotal integer := greatest(coalesce(p_subtotal_cents, 0), 0);
  c          coupons%rowtype;
  v_discount integer := 0;
  v_reason   text;
begin
  if length(v_code) < 3 then
    return jsonb_build_object('valid', false, 'reason', 'Enter a code.');
  end if;

  select * into c from coupons where code = v_code;
  if not found or not c.active then
    return jsonb_build_object('valid', false, 'reason', 'This code is not valid.');
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('valid', false, 'reason', 'This code is not active yet.');
  end if;
  if c.expires_at is not null and now() > c.expires_at then
    return jsonb_build_object('valid', false, 'reason', 'This code has expired.');
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return jsonb_build_object('valid', false, 'reason', 'This code has reached its usage limit.');
  end if;
  if v_subtotal < c.min_subtotal_cents then
    return jsonb_build_object('valid', false, 'reason',
      case when c.kind = 'free_item'
        then 'Add a product to your order to use this code.'
        else 'Your order does not meet the minimum for this code.'
      end);
  end if;
  if c.once_per_contact and p_contact is not null and exists (
    select 1 from coupon_redemptions
    where coupon_id = c.id
      and lower(btrim(coalesce(buyer_contact, ''))) = lower(btrim(p_contact))
  ) then
    return jsonb_build_object('valid', false, 'reason', 'This code was already used with this contact.');
  end if;

  -- Combinability (write-time stacking rule). Callers that don't supply the
  -- env context default to permissive; place-order re-checks authoritatively.
  v_reason := coupon_combinability_reason(v_code, p_applied_codes, p_has_reward, p_has_promo, p_has_account);
  if v_reason is not null then
    return jsonb_build_object('valid', false, 'reason', v_reason);
  end if;

  -- Referral rules (090): self-use and the join-then-buy window. Null for
  -- every non-referral code.
  v_reason := referral_code_block_reason(c.id, p_contact, auth.uid());
  if v_reason is not null then
    return jsonb_build_object('valid', false, 'reason', v_reason);
  end if;

  if c.kind = 'percent' then
    v_discount := round(v_subtotal * c.percent / 100.0)::integer;
  elsif c.kind = 'fixed' then
    v_discount := least(c.amount_cents, v_subtotal);
  else
    v_discount := 0; -- free_item: value is the added line, not a subtraction
  end if;

  return jsonb_build_object(
    'valid', true,
    'code', c.code,
    'kind', c.kind,
    'percent', c.percent,
    'amount_cents', c.amount_cents,
    'free_sku', c.free_sku,
    'free_dose', c.free_dose,
    'free_label', c.free_label,
    'discount_cents', v_discount,
    'min_subtotal_cents', c.min_subtotal_cents,
    'requires_account', c.requires_account,
    'exclusive', c.exclusive,
    'combines_with_codes', c.combines_with_codes,
    'combines_with_promos', c.combines_with_promos,
    'combines_with_account', c.combines_with_account
  );
end;
$$;

revoke execute on function validate_coupon(text, integer, text, text[], boolean, boolean, boolean) from public;
grant  execute on function validate_coupon(text, integer, text, text[], boolean, boolean, boolean) to anon, authenticated;

-- ── 6. redeem_coupon — the same guard at money time ────────────────────────
-- Body is 031's, with the referral guard added before the usage counter moves.
-- p_user_id is NEW and defaulted, so existing 5-argument callers still resolve.

-- The 5-argument 031 function is DROPPED, not left beside this one: an
-- overload would win exact-arity resolution for every existing 5-arg caller
-- and silently skip the guard below. Dropping it makes those calls resolve
-- here, with p_user_id defaulting to null.
drop function if exists redeem_coupon(text, uuid, text, integer, integer);

create or replace function redeem_coupon(
  p_code            text,
  p_order_id        uuid,
  p_contact         text,
  p_discount_cents  integer,
  p_order_net_cents integer,
  p_user_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code       text := upper(btrim(coalesce(p_code, '')));
  c            coupons%rowtype;
  a            affiliates%rowtype;
  v_pct        integer := 0;
  v_commission integer := 0;
  v_status     text := 'none';
  v_block      text;
begin
  select * into c from coupons where code = v_code for update;
  if not found or not c.active then
    return jsonb_build_object('ok', false, 'reason', 'not_valid');
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if c.expires_at is not null and now() > c.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;
  if c.once_per_contact and p_contact is not null and exists (
    select 1 from coupon_redemptions
    where coupon_id = c.id
      and lower(btrim(coalesce(buyer_contact, ''))) = lower(btrim(p_contact))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  -- Referral rules (090). Fail-closed at money time: a quote that slipped
  -- through a stale client cannot bank a self-referral or a late window.
  v_block := referral_code_block_reason(c.id, p_contact, p_user_id);
  if v_block is not null then
    return jsonb_build_object('ok', false, 'reason', 'referral_blocked', 'detail', v_block);
  end if;

  update coupons
     set used_count = used_count + 1, updated_at = now()
   where id = c.id;

  if c.affiliate_id is not null then
    select * into a from affiliates where id = c.affiliate_id;
    if found and a.active then
      v_pct        := coalesce(c.commission_percent, a.default_commission_percent, 0);
      v_commission := greatest(round(greatest(coalesce(p_order_net_cents, 0), 0) * v_pct / 100.0)::integer, 0);
      v_status     := case when v_commission > 0 then 'pending' else 'none' end;
    end if;
  end if;

  insert into coupon_redemptions
    (coupon_id, order_id, affiliate_id, code, buyer_contact,
     discount_cents, order_net_cents, commission_cents, commission_status)
  values
    (c.id, p_order_id, c.affiliate_id, c.code, nullif(btrim(coalesce(p_contact, '')), ''),
     greatest(coalesce(p_discount_cents, 0), 0),
     greatest(coalesce(p_order_net_cents, 0), 0),
     v_commission, v_status);

  return jsonb_build_object('ok', true, 'code', c.code, 'commission_cents', v_commission);
end;
$$;

revoke execute on function redeem_coupon(text, uuid, text, integer, integer, uuid) from public, anon, authenticated;

-- ── 7. Conversions ledger + settlement ─────────────────────────────────────

create table if not exists referral_conversions (
  id               uuid        primary key default gen_random_uuid(),
  referrer_user_id uuid        not null references auth.users(id) on delete cascade,
  referred_contact text        not null,
  referred_user_id uuid        references auth.users(id) on delete set null,
  -- UNIQUE: the qualifying order settles exactly once, however often the
  -- settlement job runs.
  order_id         uuid        not null unique references orders(id) on delete cascade,
  qualified_at     timestamptz not null default now(),
  bonus_coupon_id  uuid        references coupons(id) on delete set null,
  bonus_code       text,
  created_at       timestamptz not null default now()
);

create index if not exists referral_conversions_referrer_idx
  on referral_conversions (referrer_user_id, created_at desc);

alter table referral_conversions enable row level security;
drop policy if exists "Members read own referral conversions" on referral_conversions;
create policy "Members read own referral conversions"
  on referral_conversions for select
  using (referrer_user_id = auth.uid() or is_admin());
revoke all on referral_conversions from anon, authenticated;
grant select on referral_conversions to authenticated;  -- RLS narrows it

/**
 * settle_referral_conversions — scheduled, service-role, idempotent.
 *
 * A qualifying order is a PAID order that redeemed a member's REF- code, whose
 * buyer's account was created no more than referral_window_days() before the
 * order was paid, and whose buyer is not the code's owner. Each one banks a
 * conversion row and issues the referrer a one-use BONUS- coupon.
 */
create or replace function settle_referral_conversions()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  rec        record;
  v_code     text;
  v_coupon   uuid;
  v_attempt  integer;
  v_granted  integer := 0;
begin
  for rec in
    select cr.order_id,
           mrc.user_id                     as referrer_user_id,
           lower(btrim(cr.buyer_contact))  as referred_contact,
           bu.id                           as referred_user_id
      from coupon_redemptions cr
      join member_referral_codes mrc on mrc.coupon_id = cr.coupon_id
      join orders o                  on o.id = cr.order_id
      join auth.users bu             on lower(btrim(bu.email)) = lower(btrim(cr.buyer_contact))
      join customer_profiles cp      on cp.user_id = bu.id
     where o.status in ('paid', 'fulfilled')
       and o.paid_at is not null
       and cr.buyer_contact is not null
       and lower(btrim(cr.buyer_contact)) is distinct from lower(btrim(coalesce(mrc.owner_contact, '')))
       and bu.id <> mrc.user_id
       -- Joined, then bought inside the window.
       and cp.created_at >= o.paid_at - (referral_window_days() || ' days')::interval
       and not exists (select 1 from referral_conversions rc where rc.order_id = cr.order_id)
  loop
    -- The referrer's thank-you: a personal one-use 15% code, 30 days. Same
    -- posture as the REF- code (adds to the account rate, stacks with nothing
    -- else), so "an extra 15%" means the same thing on both sides.
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_code := 'BONUS-' || (
        select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', (floor(random() * 32))::int + 1, 1), '')
          from generate_series(1, 6)
      );
      begin
        insert into coupons
          (code, kind, percent, active, max_uses, once_per_contact, requires_account,
           expires_at, exclusive, combines_with_codes, combines_with_promos, combines_with_account)
        values
          (v_code, 'percent', referral_bonus_percent(), true, 1, true, true,
           now() + interval '30 days', false, false, false, true)
        returning id into v_coupon;
        exit;
      exception when unique_violation then
        if v_attempt >= 20 then
          raise exception 'Could not allocate a unique referral bonus code';
        end if;
      end;
    end loop;

    insert into referral_conversions
      (referrer_user_id, referred_contact, referred_user_id, order_id, bonus_coupon_id, bonus_code)
    values
      (rec.referrer_user_id, rec.referred_contact, rec.referred_user_id, rec.order_id, v_coupon, v_code)
    on conflict (order_id) do nothing;

    if found then
      v_granted := v_granted + 1;
    else
      -- Lost a race with a concurrent run: drop the coupon we just minted
      -- rather than leave an unreferenced code active in the wild.
      delete from coupons where id = v_coupon;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'granted', v_granted);
end;
$$;

revoke execute on function settle_referral_conversions() from public, anon, authenticated;
-- service_role (the member-automations runner) calls this via its default grant.

-- ── 8. Member-facing referral code — new percent + owner contact ───────────

create or replace function get_my_referral_code()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid          uuid := auth.uid();
  v_email        text;
  v_name         text;
  v_code         text;
  v_coupon_id    uuid;
  v_affiliate_id uuid;
  v_uses         integer;
  v_earned       integer;
  v_attempt      integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  if not exists (select 1 from customer_profiles cp where cp.user_id = v_uid) then
    raise exception 'A member profile is required to issue a referral code';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email = '' then
    raise exception 'An account email is required to issue a referral code';
  end if;

  perform pg_advisory_xact_lock(hashtext('member_referral:' || v_uid::text));

  select mrc.code, mrc.coupon_id
    into v_code, v_coupon_id
    from member_referral_codes mrc
   where mrc.user_id = v_uid;

  if v_code is null then
    select coalesce(nullif(btrim(cp.full_name), ''), v_email)
      into v_name
      from customer_profiles cp
     where cp.user_id = v_uid;

    insert into affiliates (name, contact, default_commission_percent, notes)
    values (v_name, v_email, 0,
            'Member referral (076/090) — payout is a one-use bonus coupon, never cash commission.')
    returning id into v_affiliate_id;

    loop
      v_attempt := v_attempt + 1;
      v_code := 'REF-' || (
        select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', (floor(random() * 32))::int + 1, 1), '')
          from generate_series(1, 6)
      );
      begin
        -- 090 posture: adds to the friend's automatic account rate, stacks
        -- with nothing else, members only, one use per contact.
        insert into coupons
          (code, kind, percent, active, affiliate_id, commission_percent,
           once_per_contact, requires_account,
           exclusive, combines_with_codes, combines_with_promos, combines_with_account)
        values
          (v_code, 'percent', referral_bonus_percent(), true, v_affiliate_id, 0,
           true, true,
           false, false, false, true)
        returning id into v_coupon_id;
        exit;
      exception when unique_violation then
        if v_attempt >= 20 then
          raise exception 'Could not allocate a unique referral code';
        end if;
      end;
    end loop;

    insert into member_referral_codes (user_id, affiliate_id, coupon_id, code, owner_contact)
    values (v_uid, v_affiliate_id, v_coupon_id, v_code, v_email);
  end if;

  select count(*)::integer
    into v_uses
    from coupon_redemptions cr
   where cr.coupon_id = v_coupon_id
     and lower(btrim(coalesce(cr.buyer_contact, ''))) <> v_email;

  select count(*)::integer into v_earned
    from referral_conversions rc where rc.referrer_user_id = v_uid;

  return jsonb_build_object(
    'code', v_code,
    'percent', referral_bonus_percent(),
    'uses', v_uses,
    'earned', v_earned,
    'windowDays', referral_window_days(),
    'bonuses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', rc.bonus_code,
               'iso',  to_char(rc.created_at, 'YYYY-MM-DD')
             ) order by rc.created_at desc)
        from referral_conversions rc
       where rc.referrer_user_id = v_uid and rc.bonus_code is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function get_my_referral_code() from public, anon;
grant  execute on function get_my_referral_code() to authenticated;

-- ── 9. The referrer's notification — a new automation kind ─────────────────

insert into automation_settings (kind) values ('referral_bonus')
on conflict (kind) do nothing;
