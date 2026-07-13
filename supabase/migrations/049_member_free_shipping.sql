-- 049_member_free_shipping.sql
-- ---------------------------------------------------------------------------
-- Per-customer "free shipping for good" (admin-granted). This is how the
-- account perk "create a profile → free shipping" is honored reliably instead
-- of relying on an admin remembering to zero shipping on every order.
--
--   • customer_profiles.free_shipping (default false) — a GUARDED column:
--     customers cannot set it (guard trigger pins it, same as tier/status);
--     only admin_set_profile_flags can, so the perk is admin-granted.
--   • recompute_order_totals — the canonical money function (called by
--     set_order_shipping, save_order_lines, admin_create_order, coupon RPCs)
--     now forces shipping to $0 for any order owned by a free-shipping
--     customer, and persists shipping_cents = 0 so every invoice surface and
--     the stored total agree. A manual shipping charge can't override it.
--
-- Requires 043 (guard trigger, admin_set_profile_flags) and 045
-- (recompute_order_totals compounding body + order_coupons.source).
--
-- Additive + idempotent. No new grants to anon.
--
-- Rollback: re-apply 043's guard_customer_profile_columns + the 5-arg
-- admin_set_profile_flags and drop the 6-arg one; re-apply 045's
-- recompute_order_totals; drop column customer_profiles.free_shipping.
-- ---------------------------------------------------------------------------

-- ── 1. free_shipping column ─────────────────────────────────────────────────
alter table customer_profiles
  add column if not exists free_shipping boolean not null default false;

-- ── 2. Guard trigger — 043 body + free_shipping in the guarded set ──────────
create or replace function guard_customer_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;
  end if;
  if coalesce(current_setting('vsr.profile_guard_bypass', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.tier          := 'member';
    new.status        := 'active';
    new.account_type  := 'individual';
    new.business_name := null;
    new.customer_id   := null;
    new.free_shipping := false;
    return new;
  end if;

  new.tier          := old.tier;
  new.status        := old.status;
  new.account_type  := old.account_type;
  new.business_name := old.business_name;
  new.customer_id   := old.customer_id;
  new.free_shipping := old.free_shipping;
  return new;
end;
$$;

-- (triggers from 043 already point at this function; no re-create needed.)

-- ── 3. admin_set_profile_flags — 6-arg version incl. free_shipping ──────────
-- Drop the 5-arg version so callers move to the new signature (the admin panel
-- is updated in the same change set).
drop function if exists admin_set_profile_flags(uuid, text, text, text, text);

create or replace function admin_set_profile_flags(
  p_user_id       uuid,
  p_tier          text,
  p_status        text,
  p_account_type  text,
  p_business_name text,
  p_free_shipping boolean default false
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
         free_shipping = coalesce(p_free_shipping, false),
         updated_at    = now()
   where user_id = p_user_id;

  perform log_audit(
    'customer_profile.flags_set', 'customer', p_user_id::text,
    format('Profile flags set: tier=%s status=%s account_type=%s free_shipping=%s',
      p_tier, p_status, p_account_type, coalesce(p_free_shipping, false)),
    jsonb_build_object(
      'tier', v_before.tier, 'status', v_before.status,
      'account_type', v_before.account_type, 'business_name', v_before.business_name,
      'free_shipping', v_before.free_shipping),
    jsonb_build_object(
      'tier', p_tier, 'status', p_status,
      'account_type', p_account_type, 'business_name', v_bname,
      'free_shipping', coalesce(p_free_shipping, false)),
    null
  );
end;
$$;

revoke execute on function admin_set_profile_flags(uuid, text, text, text, text, boolean) from public, anon;
grant  execute on function admin_set_profile_flags(uuid, text, text, text, text, boolean) to authenticated;

-- ── 4. recompute_order_totals — 045 body + free-shipping enforcement ────────
-- Verbatim 045 (account-percent-first pass 2) plus: an order owned by a
-- free-shipping customer has its shipping forced to 0 and persisted, so the
-- perk holds through line edits, coupon changes, and manual shipping entry.
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
  v_flat     integer := 0;
  v_base     integer;
  v_pct_used integer := 0;
  v_discount integer := 0;
  v_this     integer;
  v_free     integer;
  v_total    integer;
  v_codes    text;
  v_free_ship boolean;
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

  -- 2b. Member free-shipping perk (049): an order owned by a customer whose
  --     profile has free_shipping pays no shipping, regardless of what was set.
  select coalesce(cp.free_shipping, false) into v_free_ship
    from orders o
    left join customer_profiles cp on cp.user_id = o.user_id
   where o.id = p_order_id;
  if v_free_ship then
    v_shipping := 0;
  end if;

  -- 3a. FLAT reductions first (free_item + fixed), each capped at remaining base.
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

  -- 3b. PERCENTS on the post-flat base. Account rows (source='account') first,
  --     then codes in created_at order.
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
         shipping_cents       = v_shipping,
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

revoke execute on function recompute_order_totals(uuid) from public, anon, authenticated;
