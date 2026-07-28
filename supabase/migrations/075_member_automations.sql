-- 075_member_automations.sql
-- ---------------------------------------------------------------------------
-- Membership Train 2: the automation data layer — shipped completely DARK.
-- Every automation kind is seeded DISABLED and no email can be sent until an
-- admin explicitly enables a kind from the Members → Automations sub-view.
--
--   • customer_profiles.marketing_opt_out — the customer's own marketing
--     switch. Deliberately NOT added to the guard trigger's pinned set
--     (043/049 pin tier, status, account_type, business_name, customer_id,
--     free_shipping): the existing 028 "Customers update own profile" policy
--     already scopes updates to the caller's own row, and a customer MUST be
--     able to flip this column themselves — that is the whole point of it.
--   • email_log — one row per outbound automated email. UNIQUE
--     (recipient, kind, period_key) IS the idempotency claim: the edge fn
--     inserts BEFORE sending, so a crash or re-run can skip (conflict) but
--     can never double-send. user_id is nullable — invite followups go to
--     contacts with no account yet.
--   • automation_settings — the 054/055 promo_settings pattern: admin-
--     configurable switches in the DB, seeded OFF, written only through an
--     is_admin()-gated audited RPC. `config` jsonb is the open extension
--     point (thresholds, windows) so later tuning needs no schema change.
--   • admin_set_automation_kind() — the one write verb (audited toggle).
--   • admin_email_log()           — paged admin read + per-kind sent counts
--                                   (mirrors admin_member_invites' shape).
--   • automation_candidates()     — service-role-only candidate evaluation,
--     one branch per kind. SQL owns candidate selection (it joins ledgers,
--     orders and auth.users); the edge fn owns claiming + sending. This keeps
--     the eligibility rules next to the tables they read, same reasoning as
--     067's reconcile_reward_vouchers.
--
-- Additive + idempotent. No new grants to anon anywhere.
-- Rollback notes: DB is forward-fix only. To revert, deploy a later migration
--   dropping the three functions and both tables; marketing_opt_out may stay
--   (inert when the winback kind is disabled).

-- ── 1. Customer-writable marketing opt-out ─────────────────────────────────

alter table customer_profiles
  add column if not exists marketing_opt_out boolean not null default false;

-- ── 2. email_log — the idempotency ledger ──────────────────────────────────

create table if not exists email_log (
  id         uuid        primary key default gen_random_uuid(),
  -- null = non-account recipient (e.g. an invite followup to a guest email).
  user_id    uuid        references auth.users(id) on delete cascade,
  recipient  text        not null,
  kind       text        not null,
  period_key text        not null,
  sent_at    timestamptz not null default now(),
  metadata   jsonb       not null default '{}'::jsonb,
  -- THE idempotency claim: one email per recipient per kind per period.
  unique (recipient, kind, period_key)
);

create index if not exists email_log_sent_at_idx on email_log (sent_at desc);
create index if not exists email_log_kind_idx    on email_log (kind);
-- FK support: email_log grows unboundedly, and without this index every
-- auth.users delete would seq-scan it to enforce the cascade (db review).
create index if not exists email_log_user_id_idx on email_log (user_id) where user_id is not null;
-- Candidate queries (reward_ready / winback) aggregate paid orders on a
-- schedule, not just on admin click — give them a query-shaped path instead
-- of inheriting member_roster_base's on-demand-scan tradeoff (db review).
create index if not exists orders_status_paid_at_idx on orders (status, paid_at);

alter table email_log enable row level security;
drop policy if exists "Admins read email log" on email_log;
create policy "Admins read email log" on email_log for select using (is_admin());
revoke all on email_log from anon, authenticated;
grant select on email_log to authenticated;  -- RLS narrows this to admins only
-- ALL writes are service-role only (the member-automations edge fn); no
-- insert/update/delete policy exists and the grants above exclude them.

-- ── 3. automation_settings — per-kind switches, seeded OFF ─────────────────

create table if not exists automation_settings (
  kind       text        primary key,
  enabled    boolean     not null default false,
  config     jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

-- Seed the five kinds DISABLED — the whole stack ships dark.
insert into automation_settings (kind) values
  ('reward_ready'), ('invite_followup'), ('winback'), ('discount_expiry'), ('welcome')
on conflict (kind) do nothing;

alter table automation_settings enable row level security;
drop policy if exists "Admins read automation settings" on automation_settings;
create policy "Admins read automation settings" on automation_settings for select using (is_admin());
revoke all on automation_settings from anon, authenticated;
grant select on automation_settings to authenticated;  -- RLS narrows to admins
-- No insert/update/delete policies → all writes go through the RPC below.

-- ── 4. admin_set_automation_kind — the audited toggle ──────────────────────

create or replace function admin_set_automation_kind(
  p_kind    text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before automation_settings;
  v_after  automation_settings;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select * into v_before from automation_settings where kind = p_kind;
  if not found then
    raise exception 'Unknown automation kind: %', coalesce(p_kind, '(null)');
  end if;

  update automation_settings
     set enabled    = coalesce(p_enabled, false),
         updated_at = now(),
         updated_by = auth.uid()
   where kind = p_kind
  returning * into v_after;

  perform log_audit(
    'automation.kind_toggled', 'automation_settings', p_kind,
    format('Automation %s %s', p_kind, case when v_after.enabled then 'ENABLED' else 'disabled' end),
    jsonb_build_object('kind', p_kind, 'enabled', v_before.enabled),
    jsonb_build_object('kind', p_kind, 'enabled', v_after.enabled),
    null
  );

  return jsonb_build_object('kind', v_after.kind, 'enabled', v_after.enabled);
end;
$$;

revoke execute on function admin_set_automation_kind(text, boolean) from public, anon;
grant  execute on function admin_set_automation_kind(text, boolean) to authenticated;

-- ── 5. admin_email_log — paged read + per-kind sent counts ─────────────────

create or replace function admin_email_log(
  p_limit  integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  with page as (
    select * from email_log order by sent_at desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',        page.id,
        'userId',    page.user_id,
        'recipient', page.recipient,
        'kind',      page.kind,
        'periodKey', page.period_key,
        'sentIso',   to_char(page.sent_at, 'YYYY-MM-DD')
      ) order by page.sent_at desc)
      from page
    ), '[]'::jsonb),
    'total',   (select count(*) from email_log),
    -- Per-kind sent counts — the Automations sub-view's summary tiles.
    'summary', (
      select coalesce(jsonb_object_agg(s.kind, s.n), '{}'::jsonb)
        from (select kind, count(*) as n from email_log group by kind) s
    ),
    'limit',  v_limit,
    'offset', v_offset
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_email_log(integer, integer) from public, anon;
grant  execute on function admin_email_log(integer, integer) to authenticated;

-- ── 6. automation_candidates — service-role candidate evaluation ───────────
-- One branch per kind; each returns a jsonb ARRAY of flat candidate objects
-- {userId, recipient, periodKey, ...kind fields}. Deduplication against
-- already-sent emails is NOT done here — the edge fn's email_log claim is the
-- single idempotency mechanism, so a candidate may reappear across runs and
-- simply conflict-skip. Period-key semantics live here, next to the data:
--   reward_ready    "rr-" || floor(balance/300)   one notice per 300-pt stage
--   invite_followup "inv-" || invite id           ONE followup ever per invite
--   winback         "wb-" || YYYY"Q"Q             one per member per quarter
--   discount_expiry "de-" || discount id          one per expiring rule
--   welcome         "wc-once"                     once ever per user
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
    -- Members at/over the 300-pt redemption threshold with no voucher out.
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
    -- Unconverted invites sent 7–30 days ago, any channel.
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
    -- MARKETING: members whose last paid order is 60–120 days old and who
    -- have not opted out. Order attribution mirrors member_roster_base
    -- (owned user_id first, contact_key fallback for unlinked orders); admin
    -- accounts are never members.
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
    -- Active customer_discounts rules expiring within 14 days.
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
    -- Portal accounts created within the last 3 days (admins are not members).
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', cp.user_id, 'recipient', u.email,
             'periodKey', 'wc-once')), '[]'::jsonb)
      into v
      from customer_profiles cp
      join auth.users u on u.id = cp.user_id
     where cp.created_at >= now() - interval '3 days'
       and u.email is not null
       and not exists (select 1 from admin_users a where a.user_id = cp.user_id);

  else
    raise exception 'Unknown automation kind: %', coalesce(p_kind, '(null)');
  end if;

  return v;
end;
$$;

revoke execute on function automation_candidates(text) from public, anon, authenticated;
-- service_role (member-automations edge fn) calls this via its default grant.
