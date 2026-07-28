-- 076_member_referrals.sql
-- ---------------------------------------------------------------------------
-- Membership Train 3 (WS-J): member referrals, riding the EXISTING coupon +
-- affiliate rails (031). No new promo system, no new money logic — a member's
-- referral code IS an affiliate-linked coupon owned by that member:
--
--   • member_referral_codes — one row per member: user → affiliates row +
--     coupons row + the code itself. A LENS/mapping table; the coupon and the
--     ledger (coupon_redemptions, written by redeem_coupon at checkout) stay
--     the single source of truth for money and usage.
--   • get_my_referral_code() — the one member-facing verb. Idempotent: returns
--     the caller's existing code, else atomically creates (a) an affiliates
--     row for the member with commission percent 0 — the payout is reward
--     points, NOT cash commission, so the 031 cash ledger must never accrue a
--     pending payable for these codes — (b) a REF-XXXXXX percent-10 coupon
--     with the strictest combinability posture (exclusive — use alone), and
--     (c) the mapping row. Members only (requires a customer_profiles row).
--   • admin_member_referrals(p_limit, p_offset) — is_admin()-gated read-only
--     window (071/073 style: jsonb {rows,total,summary}) over existing tables.
--     `uses` counts coupon_redemptions rows for the member's coupon, EXCLUDING
--     redemptions whose buyer_contact is the member's own email (self-use is
--     not referral activity).
--
-- POINT PAYOUTS ARE NOT IN THIS MIGRATION. The intended path is a later
-- automation kind in the 075 automation engine that credits reward_ledger
-- points from referral redemptions — never a cash commission, and never a
-- client-initiated write.
--
-- SELF-REFERRAL POSTURE (documented limitation, deliberate): validate_coupon /
-- redeem_coupon are KEYED money logic and are NOT touched here. Self-use is
-- discouraged structurally, not blocked at the money level:
--   1. The coupon is `exclusive`, so a signed-in member (who always carries
--      the automatic account discount) cannot admit their own code — the 057
--      combinability gate rejects it at write time.
--   2. The redemption stats above exclude the member's own buyer_contact, so
--      self-use never counts as referral activity.
--   A member could still type their own code on a guest checkout under a
--   different contact; blocking that would require touching validate_coupon,
--   which this workstream explicitly does not do.
--
-- Additive + idempotent. No grants to anon. DB is forward-fix only.
-- Rollback notes: deploy a later migration dropping get_my_referral_code()
--   and admin_member_referrals(). member_referral_codes / the issued affiliate
--   + coupon rows are inert if unused and may be left in place (or the coupons
--   deactivated from the admin console).
-- ---------------------------------------------------------------------------

-- ── Mapping table ──────────────────────────────────────────────────────────

create table if not exists member_referral_codes (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  affiliate_id uuid        not null references affiliates(id),
  coupon_id    uuid        not null references coupons(id),
  code         text        not null unique,
  created_at   timestamptz not null default now()
);

alter table member_referral_codes enable row level security;
drop policy if exists "Members read own referral code" on member_referral_codes;
create policy "Members read own referral code"
  on member_referral_codes for select
  using (user_id = auth.uid() or is_admin());
revoke all on member_referral_codes from anon, authenticated;
grant select on member_referral_codes to authenticated;
-- Writes happen only inside get_my_referral_code() (SECURITY DEFINER).

-- ── get_my_referral_code — idempotent issue-or-fetch (members only) ────────
--
-- Returns jsonb { code, percent, uses }. `uses` excludes the member's own
-- buyer_contact (see self-referral posture in the header).

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
  v_attempt      integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  -- Members only: a portal profile row is the membership marker (028/043).
  if not exists (select 1 from customer_profiles cp where cp.user_id = v_uid) then
    raise exception 'A member profile is required to issue a referral code';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email = '' then
    raise exception 'An account email is required to issue a referral code';
  end if;

  -- One issuance per member, even under concurrent calls: serialize on the
  -- caller, then re-check. The lock is transaction-scoped.
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

    -- (a) The member's affiliate identity. Commission percent 0: the payout
    -- for referrals is reward points (later automation kind), never cash —
    -- redeem_coupon therefore books 0 cents / status 'none' on every use.
    insert into affiliates (name, contact, default_commission_percent, notes)
    values (v_name, v_email, 0,
            'Member referral (076) — payout is reward points via a later automation, not cash commission.')
    returning id into v_affiliate_id;

    -- (b) The coupon: REF- + 6 uppercase base32 chars, 10% off, active, no
    -- expiry, strictest combinability (exclusive — use alone). Collision-retry
    -- on the unique code.
    loop
      v_attempt := v_attempt + 1;
      v_code := 'REF-' || (
        select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', (floor(random() * 32))::int + 1, 1), '')
          from generate_series(1, 6)
      );
      begin
        insert into coupons
          (code, kind, percent, active, affiliate_id, commission_percent,
           exclusive, combines_with_codes, combines_with_promos, combines_with_account)
        values
          (v_code, 'percent', 10, true, v_affiliate_id, 0,
           true, false, false, false)
        returning id into v_coupon_id;
        exit;
      exception when unique_violation then
        if v_attempt >= 20 then
          raise exception 'Could not allocate a unique referral code';
        end if;
      end;
    end loop;

    -- (c) The mapping row.
    insert into member_referral_codes (user_id, affiliate_id, coupon_id, code)
    values (v_uid, v_affiliate_id, v_coupon_id, v_code);
  end if;

  select count(*)::integer
    into v_uses
    from coupon_redemptions cr
   where cr.coupon_id = v_coupon_id
     and lower(btrim(coalesce(cr.buyer_contact, ''))) <> v_email;

  return jsonb_build_object('code', v_code, 'percent', 10, 'uses', v_uses);
end;
$$;

revoke execute on function get_my_referral_code() from public, anon;
grant  execute on function get_my_referral_code() to authenticated;

-- ── admin_member_referrals — read-only window (071/073 style) ──────────────

create or replace function admin_member_referrals(
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
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with base as (
    select mrc.coupon_id, mrc.code, mrc.created_at,
           coalesce(nullif(btrim(cp.full_name), ''), u.email) as member_name,
           u.email as contact
      from member_referral_codes mrc
      left join customer_profiles cp on cp.user_id = mrc.user_id
      left join auth.users u on u.id = mrc.user_id
  ),
  counted as (
    -- Uses = redemption-ledger entries for the member's coupon, excluding the
    -- member's own buyer_contact (self-use is not referral activity).
    select b.*,
           (select count(*) from coupon_redemptions cr
             where cr.coupon_id = b.coupon_id
               and lower(btrim(coalesce(cr.buyer_contact, '')))
                   <> lower(btrim(coalesce(b.contact, '')))) as uses
      from base b
  ),
  page as (
    select * from counted order by created_at desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memberName', page.member_name,
        'contact',    page.contact,
        'code',       page.code,
        'uses',       page.uses,
        'createdIso', to_char(page.created_at, 'YYYY-MM-DD')
      ) order by page.created_at desc)
      from page
    ), '[]'::jsonb),
    'total',   (select count(*) from counted),
    'summary', jsonb_build_object(
      'codesIssued', (select count(*) from member_referral_codes),
      'totalUses',   (select coalesce(sum(uses), 0) from counted)
    ),
    'limit',  v_limit,
    'offset', v_offset
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_member_referrals(integer, integer) from public, anon;
grant  execute on function admin_member_referrals(integer, integer) to authenticated;
