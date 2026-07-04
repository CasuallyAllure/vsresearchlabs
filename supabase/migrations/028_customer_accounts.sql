-- 028_customer_accounts.sql
-- ---------------------------------------------------------------------------
-- Customer accounts (Phase 1).
--
-- Adds PUBLIC customer logins ALONGSIDE the existing admin auth + guest-order
-- model. Nothing here changes guest checkout, admin RLS, or order tracking.
--
--   1. customer_profiles  — one row per logged-in customer (name, address,
--                           tier, status). Keyed to auth.users; linked to the
--                           existing customers CRM row by email when possible.
--   2. orders.user_id     — optional owner. NULL for guest orders (today's
--                           behavior). Stamped when a logged-in customer's
--                           order is claimed/placed.
--   3. RLS                 — a customer can read ONLY their own profile + orders.
--                           Admin policies are untouched (RLS policies are OR'd,
--                           so these are purely additive).
--   4. handle_new_customer — trigger that materializes a profile from signup
--                           metadata, so it works even with email-confirm on.
--   5. link_my_orders()    — claims a customer's prior GUEST orders (matched by
--                           email) so "My Orders" is populated on first login.
-- ---------------------------------------------------------------------------

-- ── 1. orders.user_id — optional customer owner ───────────────────────────
alter table orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists orders_user_id_idx on orders (user_id);

-- ── 2. customer_profiles ──────────────────────────────────────────────────
create table if not exists customer_profiles (
  user_id        uuid        primary key references auth.users(id) on delete cascade,
  full_name      text        not null,
  phone          text,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  country        text,
  -- 'member' = free logged-in customer; 'pro' = paid (future). Perks key off this.
  tier           text        not null default 'member' check (tier in ('member', 'pro')),
  -- 'active' today; 'waitlisted' reserved for the future invite-gate; 'suspended' for ops.
  status         text        not null default 'active' check (status in ('active', 'waitlisted', 'suspended')),
  -- Soft link to the existing CRM dedupe row (best-effort, by email).
  customer_id    uuid        references customers(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table customer_profiles enable row level security;

-- A customer can read / create / update ONLY their own profile.
-- (drop-if-exists guards keep this migration re-runnable if the objects were
--  ever created out-of-band via the dashboard — create policy is not idempotent.)
drop policy if exists "Customers read own profile" on customer_profiles;
create policy "Customers read own profile"
  on customer_profiles for select
  using (user_id = auth.uid());

drop policy if exists "Customers insert own profile" on customer_profiles;
create policy "Customers insert own profile"
  on customer_profiles for insert
  with check (user_id = auth.uid());

drop policy if exists "Customers update own profile" on customer_profiles;
create policy "Customers update own profile"
  on customer_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins (ops) can read every profile for support / CRM.
drop policy if exists "Admins read all profiles" on customer_profiles;
create policy "Admins read all profiles"
  on customer_profiles for select
  using (is_admin());

-- Keep updated_at honest on edits.
create or replace function touch_customer_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_customer_profile on customer_profiles;
create trigger trg_touch_customer_profile
  before update on customer_profiles
  for each row execute function touch_customer_profile_updated_at();

-- ── 3. Customer-owned order visibility (additive to admin-only policies) ───
drop policy if exists "Customers read own orders" on orders;
create policy "Customers read own orders"
  on orders for select
  using (user_id = auth.uid());

drop policy if exists "Customers read own order_lines" on order_lines;
create policy "Customers read own order_lines"
  on order_lines for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_lines.order_id
        and o.user_id = auth.uid()
    )
  );

-- ── 4. Provision a profile from signup metadata ───────────────────────────
-- Fires for every new auth user but only materializes a profile when the
-- signup carried customer metadata (full_name). Admin accounts created in the
-- Supabase dashboard have no full_name in metadata, so they're skipped.
create or replace function handle_new_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ? 'full_name' then
    insert into customer_profiles (
      user_id, full_name, phone,
      address_line1, address_line2, city, state, postal_code, country
    )
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'Customer'),
      nullif(new.raw_user_meta_data->>'phone', ''),
      nullif(new.raw_user_meta_data->>'address_line1', ''),
      nullif(new.raw_user_meta_data->>'address_line2', ''),
      nullif(new.raw_user_meta_data->>'city', ''),
      nullif(new.raw_user_meta_data->>'state', ''),
      nullif(new.raw_user_meta_data->>'postal_code', ''),
      nullif(new.raw_user_meta_data->>'country', '')
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_customer_created on auth.users;
create trigger on_auth_customer_created
  after insert on auth.users
  for each row execute function handle_new_customer();

-- ── 5. Claim prior guest orders by email ──────────────────────────────────
-- Called by the account page after login. Sets user_id on the caller's own
-- guest orders (buyer_contact matches their verified email). SECURITY DEFINER
-- so it can write to orders, but it can ONLY ever touch rows whose contact
-- equals the *caller's* auth email — never anyone else's.
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
  return v_count;
end;
$$;

grant execute on function link_my_orders() to authenticated;
