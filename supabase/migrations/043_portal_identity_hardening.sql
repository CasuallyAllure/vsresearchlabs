-- 043_portal_identity_hardening.sql
-- ---------------------------------------------------------------------------
-- Customer portal, phase 1: identity hardening (blueprint §3, migration 043).
--
-- Closes the audited privilege-escalation hole (customer_profiles.tier/status
-- were customer-writable through the 028 self-update policy) and lays the
-- identity groundwork every later portal migration keys off:
--
--   1. customer_profiles.account_type / business_name — business accounts are
--      profiles with account_type = 'business' (no separate org system).
--   2. guard_customer_profile_columns() BEFORE UPDATE trigger — when the
--      updater is a plain customer, the guarded columns (tier, status,
--      account_type, business_name, customer_id) are silently pinned to their
--      old values. Pin, don't raise: the existing self-update UX for
--      name/phone/address keeps working with zero client changes.
--   3. admin_set_profile_flags() — the ONLY path that changes the guarded
--      columns. is_admin()-gated; the trigger lets admin callers through
--      because auth.uid() inside a SECURITY DEFINER RPC is still the calling
--      admin's JWT uid, so is_admin() stays true on the trigger's check.
--   4. customer_profiles.customer_id backfill from the admin CRM (customers,
--      004) by lower(contact) = lower(auth email), plus handle_new_customer()
--      and link_my_orders() redefined (028 bodies preserved) to keep the soft
--      link fresh on signup/login. link_my_orders raises a transaction-local
--      bypass flag around its own customer_id write so the guard trigger
--      doesn't pin it (the caller is the customer, not an admin).
--   5. "Customers read own order_coupons" SELECT policy — same parent-order
--      predicate as 028's order_lines policy, so the portal can itemize
--      discounts on owned orders.
--   6. get_my_order(p_order_number) — authenticated-only RPC mirroring the
--      exact jsonb payload of get_order_by_token (041) but predicated on
--      orders.user_id = auth.uid(). Uniform {found:false} on any miss (no
--      error-shape oracle); never includes lookup_token.
--
-- Additive + idempotent. No new grants to anon anywhere.
--
-- Rollback notes: drop triggers trg_guard_customer_profile_columns and
-- trg_guard_customer_profile_columns_insert and function
-- guard_customer_profile_columns(); drop index customer_profiles_customer_id_key;
-- drop functions admin_set_profile_flags and get_my_order; drop policy
-- "Customers read own order_coupons"; re-apply 028's handle_new_customer/
-- link_my_orders bodies. The two new columns and the customer_id backfill are
-- data-safe to leave in place.
-- ---------------------------------------------------------------------------

-- ── 1. account_type + business_name on customer_profiles ────────────────────
alter table customer_profiles
  add column if not exists account_type text not null default 'individual'
    check (account_type in ('individual', 'business')),
  add column if not exists business_name text;

-- ── 2. Guard trigger: guarded columns are not customer-writable ─────────────
-- Guards BOTH insert and update. Never raises, so a customer's profile save
-- that includes guarded fields still succeeds — the guarded fields are just
-- forced to a safe value (old value on UPDATE; the schema default on INSERT).
--
-- Why INSERT is guarded too: the 028 policy "Customers insert own profile" has
-- `with check (user_id = auth.uid())` and does NOT restrict any other column.
-- Without a BEFORE INSERT guard a customer could POST directly to
-- /rest/v1/customer_profiles (bypassing the app, which always sends full_name
-- so handle_new_customer materializes the row first) with tier='pro',
-- account_type='business', or an arbitrary customer_id and escalate on a fresh
-- row — the whole point of this migration. UPDATE-only guarding closed only
-- half the hole.
create or replace function guard_customer_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admin callers may change anything (covers admin_set_profile_flags: a
  -- SECURITY DEFINER RPC still sees the calling admin's auth.uid()).
  if is_admin() then
    return new;
  end if;

  -- Trusted definer code (link_my_orders' customer_id refresh) raises this
  -- transaction-local flag around its own UPDATE.
  if coalesce(current_setting('vsr.profile_guard_bypass', true), '') = 'on' then
    return new;
  end if;

  -- No JWT at all → service-role / migration / GoTrue signup path
  -- (handle_new_customer inserts with auth.uid() null and legitimately sets
  -- customer_id). Unreachable from PostgREST as a customer, whose requests
  -- always carry auth.uid().
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Customer self-insert: force the guarded columns to their safe defaults;
    -- no old row exists to pin against.
    new.tier          := 'member';
    new.status        := 'active';
    new.account_type  := 'individual';
    new.business_name := null;
    new.customer_id   := null;
    return new;
  end if;

  -- Customer self-update: silently pin the guarded columns to their old values.
  new.tier          := old.tier;
  new.status        := old.status;
  new.account_type  := old.account_type;
  new.business_name := old.business_name;
  new.customer_id   := old.customer_id;
  return new;
end;
$$;

drop trigger if exists trg_guard_customer_profile_columns on customer_profiles;
create trigger trg_guard_customer_profile_columns
  before update on customer_profiles
  for each row execute function guard_customer_profile_columns();

drop trigger if exists trg_guard_customer_profile_columns_insert on customer_profiles;
create trigger trg_guard_customer_profile_columns_insert
  before insert on customer_profiles
  for each row execute function guard_customer_profile_columns();

-- ── 3. admin_set_profile_flags — the only path to the guarded columns ───────
create or replace function admin_set_profile_flags(
  p_user_id       uuid,
  p_tier          text,
  p_status        text,
  p_account_type  text,
  p_business_name text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before customer_profiles%rowtype;
  v_bname  text;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  -- Same vocabularies as the table CHECK constraints (028 + this migration).
  if coalesce(p_tier, '') not in ('member', 'pro') then
    raise exception 'Invalid tier % (expected member or pro)', p_tier;
  end if;
  if coalesce(p_status, '') not in ('active', 'waitlisted', 'suspended') then
    raise exception 'Invalid status % (expected active, waitlisted or suspended)', p_status;
  end if;
  if coalesce(p_account_type, '') not in ('individual', 'business') then
    raise exception 'Invalid account_type % (expected individual or business)', p_account_type;
  end if;
  v_bname := nullif(btrim(coalesce(p_business_name, '')), '');

  select * into v_before from customer_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  update customer_profiles
     set tier          = p_tier,
         status        = p_status,
         account_type  = p_account_type,
         business_name = v_bname,
         updated_at    = now()
   where user_id = p_user_id;

  perform log_audit(
    'customer_profile.flags_set', 'customer', p_user_id::text,
    format('Profile flags set: tier=%s status=%s account_type=%s', p_tier, p_status, p_account_type),
    jsonb_build_object(
      'tier', v_before.tier, 'status', v_before.status,
      'account_type', v_before.account_type, 'business_name', v_before.business_name),
    jsonb_build_object(
      'tier', p_tier, 'status', p_status,
      'account_type', p_account_type, 'business_name', v_bname),
    null
  );
end;
$$;

revoke execute on function admin_set_profile_flags(uuid, text, text, text, text) from public, anon;
grant execute on function admin_set_profile_flags(uuid, text, text, text, text) to authenticated;

-- ── 4a. Backfill customer_id from the admin CRM by auth email ───────────────
-- customers.contact_key is already lower(trim(contact)) (004). auth.uid() is
-- null in a migration, so the guard trigger lets this straight through.
update customer_profiles cp
   set customer_id = c.id
  from auth.users u, customers c
 where cp.user_id = u.id
   and cp.customer_id is null
   and c.contact_key = lower(btrim(u.email));

-- At most one portal identity may claim a given CRM row. Defense in depth: even
-- if a customer_id write slipped past the guard, this stops two auth accounts
-- pointing at the same customers row (which would make the admin "Linked
-- account" panel resolve ambiguously). Backfill above is 1:1 by email, so this
-- validates cleanly.
create unique index if not exists customer_profiles_customer_id_key
  on customer_profiles (customer_id) where customer_id is not null;

-- ── 4b. handle_new_customer — 028 body + customer_id soft link on signup ────
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
      address_line1, address_line2, city, state, postal_code, country,
      customer_id
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
      nullif(new.raw_user_meta_data->>'country', ''),
      (select c.id from customers c where c.contact_key = lower(btrim(new.email)))
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- ── 4c. link_my_orders — 028 body + customer_id refresh on login ────────────
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

  return v_count;
end;
$$;

grant execute on function link_my_orders() to authenticated;

-- ── 5. Customers read their own order_coupons (additive to admin policy) ────
drop policy if exists "Customers read own order_coupons" on order_coupons;
create policy "Customers read own order_coupons"
  on order_coupons for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_coupons.order_id
        and o.user_id = auth.uid()
    )
  );

-- 036 already grants SELECT to authenticated; restate so this migration stands
-- alone. (No grant to anon — the anon surface is unchanged.)
grant select on order_coupons to authenticated;

-- ── 6. get_my_order — authenticated mirror of get_order_by_token (041) ──────
-- Exact 041 payload shape (status public-mapping, totals, ship_* fields,
-- lines[], coupons[]) plus 'found'. Predicate: the caller owns the order and
-- the order number matches case-insensitively. Any miss (wrong number, not
-- the owner, not signed in) returns the same {found:false} — no oracle.
-- lookup_token is never included.
create or replace function get_my_order(p_order_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
      'found',           true,
      'order_number',    o.order_number,
      'status',          case
                           when o.status = 'cancelled'      then 'cancelled'
                           when o.delivered_at is not null   then 'delivered'
                           when o.tracking_number is not null
                             or o.shipped_at is not null
                             or o.status = 'fulfilled'       then 'shipped'
                           when o.status = 'paid'            then 'processing'
                           when o.status = 'payment_claimed' then 'payment_verifying'
                           when o.status = 'invoice_sent'    then 'awaiting_payment'
                           else 'received'
                         end,
      'buyer_name',      o.buyer_name,
      'placed_at',       o.created_at,
      'shipped_at',      o.shipped_at,
      'delivered_at',    o.delivered_at,
      'carrier',         o.carrier,
      'tracking_number', o.tracking_number,
      'subtotal_cents',  o.subtotal_cents,
      'shipping_cents',  o.shipping_cents,
      'discount_cents',  o.discount_cents,
      'total_cents',     coalesce(o.invoice_amount_cents, o.subtotal_cents),
      'payment_method',  o.payment_method,
      'paid',            o.paid_at is not null,
      'ship_street',        o.ship_street,
      'ship_city',          o.ship_city,
      'ship_state',         o.ship_state,
      'ship_zip',           o.ship_zip,
      'ship_country',       o.ship_country,
      'ship_confirmed_at',  o.ship_confirmed_at,
      'lines',           coalesce(
        (select jsonb_agg(jsonb_build_object(
          'sku',              ol.sku,
          'product_name',     ol.product_name,
          'quantity',         ol.quantity,
          'unit_price_cents', ol.unit_price_cents,
          'item_note',        ol.item_note
        ) order by ol.id)
         from order_lines ol where ol.order_id = o.id),
        '[]'::jsonb
      ),
      'coupons',         coalesce(
        (select jsonb_agg(jsonb_build_object(
          'code',           oc.code,
          'kind',           oc.kind,
          'free_label',     oc.free_label,
          'percent',        oc.percent,
          'amount_cents',   oc.amount_cents,
          'discount_cents', oc.discount_cents
        ) order by oc.created_at)
         from order_coupons oc where oc.order_id = o.id),
        '[]'::jsonb
      )
    )
    from orders o
    where o.user_id = auth.uid()
      and upper(o.order_number) = upper(btrim(coalesce(p_order_number, '')))
    limit 1),
    jsonb_build_object('found', false)
  );
$$;

revoke execute on function get_my_order(text) from public, anon;
grant execute on function get_my_order(text) to authenticated;
