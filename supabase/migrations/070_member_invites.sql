-- 070_member_invites.sql
-- ---------------------------------------------------------------------------
-- Membership Phase 0 (1/2): the member-invite funnel — capture + conversion.
--
-- Today an admin can email a past guest to sign up (send-invite edge fn) but
-- nothing is recorded: no who, when, which channel, or whether they converted.
-- The funnel is unmeasurable. This adds the capture table + a single definer
-- write path, and folds conversion stamping into the EXISTING link_my_orders()
-- signup funnel (no new trigger, no second signup path).
--
--   • member_invites — one row per invitation sent, any channel. `metadata`
--     jsonb is the deliberate open extension point (campaign, template,
--     automation kind) so later phases (bulk invite, follow-up automation)
--     grow it without a schema change. There are intentionally NO referral
--     columns here: referrals reuse the existing coupon + affiliate-ledger
--     infrastructure (migration 031), not this table — no duplicate systems.
--   • record_member_invite() — the one write path (service_role); the
--     send-invite edge fn calls it. admin_log_member_invite() — thin admin
--     wrapper for the UI's mailto/copy channels, audit-logged.
--   • link_my_orders() — re-created verbatim from its current (053) body with
--     one appended block that stamps the earliest still-open invite for the
--     signing-up email as converted. Everything else is byte-for-byte 053.
--
-- Members remains a LENS over the existing customer ecosystem: invites join
-- customers by contact_key and stamp against auth.users on the existing signup
-- path. No competing source of truth is introduced.
--
-- Additive + idempotent. No new grants to anon anywhere.
-- Rollback notes: DB is forward-fix only. To revert, deploy a later migration
--   that drops record_member_invite()/admin_log_member_invite() and re-creates
--   link_my_orders() with its exact 053 body. member_invites is inert if
--   unused and may be left in place.

-- ── Capture table ──────────────────────────────────────────────────────────

create table if not exists member_invites (
  id                uuid        primary key default gen_random_uuid(),
  contact_key       text        not null,                 -- lower(btrim(email)); joins customers.contact_key
  email             text        not null,                 -- as-sent, for display
  customer_id       uuid        references customers(id) on delete set null,
  points_promised   integer     not null default 0 check (points_promised >= 0),
  channel           text        not null default 'email'
                                check (channel in ('email', 'mailto', 'copy')),
  sent_by           uuid        references auth.users(id) on delete set null,
  sent_at           timestamptz not null default now(),
  converted_user_id uuid        references auth.users(id) on delete set null,
  converted_at      timestamptz,
  metadata          jsonb       not null default '{}'::jsonb,  -- open extension point
  created_at        timestamptz not null default now()
);

create index if not exists member_invites_contact_idx on member_invites (contact_key);
create index if not exists member_invites_sent_at_idx  on member_invites (sent_at desc);
-- "Open invites for this email" — the hot path for conversion stamping.
create index if not exists member_invites_open_idx
  on member_invites (contact_key) where converted_at is null;

alter table member_invites enable row level security;
drop policy if exists "Admins read member invites" on member_invites;
create policy "Admins read member invites" on member_invites for select using (is_admin());
revoke all on member_invites from anon, authenticated;
grant select on member_invites to authenticated;  -- RLS narrows this to admins only

-- ── Write path (service_role) ──────────────────────────────────────────────
-- One place that ever inserts an invite. The send-invite edge fn (service
-- role) calls this after a successful send. Keeps the CRM soft-link fresh by
-- resolving customer_id from contact_key at write time.

create or replace function record_member_invite(
  p_email   text,
  p_points  integer default 0,
  p_channel text    default 'email',
  p_sent_by uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email       text := lower(btrim(coalesce(p_email, '')));
  v_channel     text := coalesce(nullif(btrim(p_channel), ''), 'email');
  v_customer_id uuid;
  v_id          uuid;
begin
  if v_email = '' then
    raise exception 'An email is required to record an invite';
  end if;
  if v_channel not in ('email', 'mailto', 'copy') then
    raise exception 'Invalid invite channel: %', v_channel;
  end if;

  select c.id into v_customer_id from customers c where c.contact_key = v_email;

  insert into member_invites (contact_key, email, customer_id, points_promised, channel, sent_by)
  values (v_email, btrim(p_email), v_customer_id,
          greatest(0, coalesce(p_points, 0)), v_channel, p_sent_by)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function record_member_invite(text, integer, text, uuid) from public, anon, authenticated;
-- service_role (send-invite edge fn) calls this via its default execute grant.

-- ── Admin wrapper (UI mailto/copy channels) ────────────────────────────────

create or replace function admin_log_member_invite(
  p_email   text,
  p_points  integer default 0,
  p_channel text    default 'mailto'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_id := record_member_invite(p_email, p_points, p_channel, auth.uid());

  perform log_audit(
    'member.invited', 'customer', null::text,
    format('Invite logged (%s) for %s', p_channel, lower(btrim(p_email))),
    null::jsonb,
    jsonb_build_object('email', lower(btrim(p_email)), 'channel', p_channel,
                       'points', greatest(0, coalesce(p_points, 0))),
    null::jsonb
  );

  return v_id;
end;
$$;

revoke execute on function admin_log_member_invite(text, integer, text) from public, anon;
grant  execute on function admin_log_member_invite(text, integer, text) to authenticated;

-- ── Conversion stamping folded into link_my_orders() ───────────────────────
-- Verbatim current (053) body, with ONE appended block (marked "NEW (070)")
-- that claims the earliest open invite for the signing-up email. Reproduced in
-- full because Postgres functions are replaced whole, not patched.

create or replace function link_my_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_count integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return 0;
  end if;

  update orders
     set user_id = auth.uid()
   where user_id is null
     and lower(buyer_contact) = lower(v_email);

  get diagnostics v_count = row_count;

  -- Keep the CRM soft link fresh. The caller is the customer (not an admin),
  -- so raise the guard-trigger bypass flag for this trusted definer write only.
  perform set_config('vsr.profile_guard_bypass', 'on', true);
  update customer_profiles cp
     set customer_id = c.id
    from customers c
   where cp.user_id = auth.uid()
     and cp.customer_id is null
     and c.contact_key = lower(btrim(v_email));
  perform set_config('vsr.profile_guard_bypass', '', true);

  -- (053): backfill reward-ledger earn rows for every order this user now
  -- owns that hasn't earned yet. Same gate + formula as 044's backfill.
  insert into reward_ledger (user_id, order_id, kind, points, note, created_by, created_at)
  select o.user_id, o.id, 'earn',
         floor(coalesce(o.invoice_amount_cents, 0) / 100.0)::integer,
         format('Earned on order %s (signup backfill)', o.order_number),
         null, coalesce(o.paid_at, now())
    from orders o
   where o.user_id = auth.uid()
     and o.paid_at is not null
     and floor(coalesce(o.invoice_amount_cents, 0) / 100.0)::integer >= 1
  on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  insert into reward_ledger (user_id, order_id, kind, points, note, created_by, created_at)
  select rl.user_id, rl.order_id, 'reversal', -rl.points,
         format('Reversed on cancellation of %s (signup backfill)', o.order_number),
         null, coalesce(o.cancelled_at, now())
    from reward_ledger rl
    join orders o on o.id = rl.order_id
   where rl.kind = 'earn'
     and o.user_id = auth.uid()
     and o.status in ('cancelled', 'refunded')
  on conflict (order_id, kind) where kind in ('earn', 'reversal') do nothing;

  -- NEW (070): stamp the earliest still-open invite for this signing-up email
  -- as converted, so the invite funnel can measure conversion. Only the oldest
  -- open invite is claimed — one conversion per person.
  update member_invites mi
     set converted_user_id = auth.uid(),
         converted_at      = now()
   where mi.id = (
     select id from member_invites
      where contact_key = lower(btrim(v_email))
        and converted_at is null
      order by sent_at asc
      limit 1
   );

  return v_count;
end;
$$;

grant execute on function link_my_orders() to authenticated;
