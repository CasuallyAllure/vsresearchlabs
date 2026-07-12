-- 045_customer_discounts.sql
-- ---------------------------------------------------------------------------
-- Lifetime / business customer discounts (blueprint §3, migration 045).
-- Requires 043 (account_type) and rides the 036–042 order_coupons machinery.
--
--   • customer_discounts — admin-managed percent rules per customer, scoped
--     'lifetime' (any account) or 'business' (account_type='business' only).
--   • effective_customer_discount(user) — THE single eligibility source of
--     truth: best (highest percent) active in-window row whose scope is valid
--     for the profile. Lifetime and business never stack — one winner.
--     service_role only (checkout + admin recompute call it server-side);
--     revoked from every client role.
--   • admin_set_customer_discount / admin_deactivate_customer_discount —
--     is_admin()-gated writes; customers get SELECT-own RLS only.
--   • order_coupons.source ('code' | 'account') — applied account discounts
--     are materialized as synthetic percent order_coupons rows so all three
--     invoice surfaces and the admin recompute keep working unchanged.
--   • recompute_order_totals — 042 body VERBATIM except pass 2 (percents) now
--     iterates deterministically: source='account' rows first, then code rows
--     in created_at order. With no account rows the arithmetic is identical
--     to 042 (each percent row is computed off the same post-flat base with
--     the same running cap, and the cap total min(Σ, base) is order-
--     independent), so existing orders recompute to the same totals.
--
-- Additive + idempotent. No new grants to anon anywhere; no client-supplied
-- amounts are trusted (percent rules enter only through the admin RPCs).
--
-- Rollback notes: re-apply 042's recompute_order_totals body; drop functions
-- effective_customer_discount, admin_set_customer_discount,
-- admin_deactivate_customer_discount; drop table customer_discounts. The
-- order_coupons.source column is data-safe to leave in place.
-- ---------------------------------------------------------------------------

-- ── 1. customer_discounts — admin-managed discount rules ────────────────────
create table if not exists customer_discounts (
  id         uuid          primary key default gen_random_uuid(),
  user_id    uuid          not null references auth.users(id) on delete cascade,
  scope      text          not null check (scope in ('lifetime', 'business')),
  percent    numeric(5,2)  not null check (percent > 0 and percent <= 100),
  label      text          not null,                -- shown on invoices, e.g. 'Lifetime 10%'
  active     boolean       not null default true,
  starts_at  timestamptz,
  expires_at timestamptz,
  notes      text,
  created_by uuid          references auth.users(id),
  created_at timestamptz   not null default now(),
  updated_at timestamptz   not null default now()
);

create index if not exists customer_discounts_user_idx on customer_discounts (user_id) where active;

alter table customer_discounts enable row level security;

drop policy if exists "Customers read own discounts" on customer_discounts;
create policy "Customers read own discounts"
  on customer_discounts for select
  using (user_id = auth.uid());

drop policy if exists "Admins manage customer discounts" on customer_discounts;
create policy "Admins manage customer discounts"
  on customer_discounts for all
  using (is_admin()) with check (is_admin());

-- Writes go only through the SECURITY DEFINER RPCs below; clients keep SELECT
-- (scoped by the policies above). Nothing for anon.
revoke all on customer_discounts from anon, authenticated;
grant select on customer_discounts to authenticated;

-- ── 2. effective_customer_discount — single eligibility source of truth ─────
-- Best (highest percent) active row inside its [starts_at, expires_at] window
-- whose scope is valid for the profile: 'business' requires
-- customer_profiles.account_type = 'business' (demoting the account merely
-- disables the rule); 'lifetime' applies to any account. One winner — the
-- two scopes never stack. Ties break to the newest rule.
create or replace function effective_customer_discount(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
       'found',       true,
       'scope',       cd.scope,
       'percent',     cd.percent,
       'label',       cd.label,
       'discount_id', cd.id
     )
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
     limit 1),
    jsonb_build_object('found', false)
  );
$$;

-- service_role only (it keeps its Supabase default-privilege execute grant,
-- same posture as redeem_coupon in 031). No client role may probe eligibility
-- for arbitrary user ids.
revoke execute on function effective_customer_discount(uuid) from public, anon, authenticated;

-- ── 3. admin_set_customer_discount — upsert-style rule change ────────────────
-- Deactivates any prior ACTIVE rule of the same scope for the user, then
-- inserts the new one, so each (user, scope) has at most one live rule.
create or replace function admin_set_customer_discount(
  p_user_id    uuid,
  p_scope      text,
  p_percent    numeric,
  p_label      text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_label   text;
  v_percent numeric(5,2);
  v_id      uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if coalesce(p_scope, '') not in ('lifetime', 'business') then
    raise exception 'Invalid scope % (expected lifetime or business)', p_scope;
  end if;
  if p_percent is null or p_percent <= 0 or p_percent > 100 then
    raise exception 'Percent must be greater than 0 and at most 100';
  end if;
  v_percent := round(p_percent, 2);
  v_label := nullif(btrim(coalesce(p_label, '')), '');
  if v_label is null then
    raise exception 'A label is required (it appears on invoices)';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found';
  end if;
  if p_scope = 'business' and not exists (
    select 1 from customer_profiles
    where user_id = p_user_id and account_type = 'business'
  ) then
    raise exception 'Business discounts require a business account profile';
  end if;

  update customer_discounts
     set active = false, updated_at = now()
   where user_id = p_user_id and scope = p_scope and active;

  insert into customer_discounts (user_id, scope, percent, label, expires_at, created_by)
  values (p_user_id, p_scope, v_percent, v_label, p_expires_at, auth.uid())
  returning id into v_id;

  perform log_audit(
    'customer_discount.set', 'customer', p_user_id::text,
    format('%s discount set: %s%% (%s)', initcap(p_scope), v_percent, v_label),
    null,
    jsonb_build_object(
      'discount_id', v_id, 'scope', p_scope, 'percent', v_percent,
      'label', v_label, 'expires_at', p_expires_at),
    null
  );

  return jsonb_build_object(
    'discount_id', v_id, 'scope', p_scope,
    'percent', v_percent, 'label', v_label
  );
end;
$$;

revoke execute on function admin_set_customer_discount(uuid, text, numeric, text, timestamptz) from public, anon;
grant execute on function admin_set_customer_discount(uuid, text, numeric, text, timestamptz) to authenticated;

-- ── 4. admin_deactivate_customer_discount — soft off ────────────────────────
create or replace function admin_deactivate_customer_discount(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row customer_discounts%rowtype;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select * into v_row from customer_discounts where id = p_id for update;
  if not found then
    raise exception 'Discount not found';
  end if;

  update customer_discounts
     set active = false, updated_at = now()
   where id = p_id;

  perform log_audit(
    'customer_discount.deactivated', 'customer', v_row.user_id::text,
    format('%s discount deactivated: %s%% (%s)', initcap(v_row.scope), v_row.percent, v_row.label),
    jsonb_build_object('discount_id', p_id, 'active', v_row.active),
    jsonb_build_object('discount_id', p_id, 'active', false),
    null
  );
end;
$$;

revoke execute on function admin_deactivate_customer_discount(uuid) from public, anon;
grant execute on function admin_deactivate_customer_discount(uuid) to authenticated;

-- ── 5. order_coupons.source — distinguish codes from account entitlements ───
-- Synthetic account-discount rows (e.g. ACCT-LIFETIME) reuse the whole
-- order_coupons pipeline but must be distinguishable so admin "remove coupon"
-- tooling can't silently delete an entitlement.
alter table order_coupons
  add column if not exists source text not null default 'code'
    check (source in ('code', 'account'));

-- ── 6. recompute_order_totals — 042 body, account percents first in pass 2 ──
-- Verbatim 042 except the pass-2 loop gains a deterministic ORDER BY:
-- source='account' rows apply before code rows (codes in created_at order).
-- With no account rows the results match 042 exactly.
create or replace function recompute_order_totals(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  oc         order_coupons%rowtype;
  v_subtotal integer;
  v_shipping integer;
  v_flat     integer := 0;   -- free_item + fixed reductions (applied first)
  v_base     integer;        -- subtotal after the flat reductions
  v_pct_used integer := 0;
  v_discount integer := 0;
  v_this     integer;
  v_free     integer;
  v_total    integer;
  v_codes    text;
begin
  -- 1. Ensure a free-item line exists for any free_item coupon that has none.
  for oc in select * from order_coupons where order_id = p_order_id and kind = 'free_item' loop
    if oc.free_sku is not null
       and not exists (select 1 from order_lines where order_id = p_order_id and sku = oc.free_sku) then
      insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note, fast_ship)
      values (p_order_id, oc.free_sku,
              coalesce(oc.free_label, oc.free_sku) || ' (FREE · ' || oc.code || ')',
              1, 0, null, false);
    end if;
  end loop;

  -- 2. Line subtotal (free-item lines already at $0 add nothing).
  select coalesce(sum(unit_price_cents * quantity), 0) into v_subtotal
    from order_lines where order_id = p_order_id;

  select greatest(coalesce(shipping_cents, 0), 0) into v_shipping
    from orders where id = p_order_id;

  -- 3a. FLAT reductions first (free_item makes one on-order unit free; fixed is
  --     flat dollars off). Stored per row, each capped at the remaining base.
  for oc in select * from order_coupons where order_id = p_order_id and kind <> 'percent' loop
    v_this := 0;
    if oc.kind = 'fixed' and oc.amount_cents is not null then
      v_this := oc.amount_cents;
    elsif oc.kind = 'free_item' and oc.free_sku is not null then
      select coalesce(max(unit_price_cents), 0) into v_free
        from order_lines where order_id = p_order_id and sku = oc.free_sku and unit_price_cents > 0;
      v_this := coalesce(v_free, 0);
    end if;
    v_this := greatest(least(v_this, v_subtotal - v_flat), 0);
    update order_coupons set discount_cents = v_this where id = oc.id;
    v_flat := v_flat + v_this;
  end loop;

  -- 3b. PERCENTS apply to the base AFTER the flat reductions. Stored per row.
  --     Account-discount rows (source='account') apply BEFORE code percents;
  --     codes then follow in created_at order (deterministic pass 2a → 2b).
  v_base := greatest(v_subtotal - v_flat, 0);
  for oc in select * from order_coupons
             where order_id = p_order_id and kind = 'percent' and percent is not null
             order by case when source = 'account' then 0 else 1 end, created_at
  loop
    v_this := greatest(least(round(v_base * oc.percent / 100.0)::integer, v_base - v_pct_used), 0);
    update order_coupons set discount_cents = v_this where id = oc.id;
    v_pct_used := v_pct_used + v_this;
  end loop;

  v_discount := least(greatest(v_flat + v_pct_used, 0), v_subtotal);
  v_total := greatest(v_subtotal + v_shipping - v_discount, 0);

  select string_agg(code, ', ' order by created_at) into v_codes
    from order_coupons where order_id = p_order_id;

  update orders
     set subtotal_cents       = v_subtotal,
         discount_cents       = v_discount,
         coupon_code          = v_codes,
         invoice_amount_cents = v_total,
         updated_at           = now()
   where id = p_order_id;

  return jsonb_build_object(
    'subtotal_cents', v_subtotal, 'discount_cents', v_discount,
    'shipping_cents', v_shipping, 'total_cents', v_total, 'codes', coalesce(v_codes, '')
  );
end;
$$;

-- Grants identical to 042.
revoke execute on function recompute_order_totals(uuid) from public, anon, authenticated;
