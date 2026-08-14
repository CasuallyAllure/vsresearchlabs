-- 087_per_product_member_rate.sql
--
-- A product whose member rate is not the standard one.
--
-- WHY. The automatic member discount has been a single percent applied to the
-- whole cart since 069 — `accountPercent` in orderTotals.ts, one source='account'
-- row here. That is fine while every product carries the same rate. It is wrong
-- the moment one does not: TZP Oral is a 10% product in a 15% catalog, and there
-- was nowhere to say so.
--
-- WHERE THE RATE LIVES. product_flags (077), keyed by sku, already exists for
-- exactly this kind of per-product admin fact and already has an anon-readable
-- narrow view in front of it. A second table would have meant a second read
-- path, a second cache and a second thing to forget.
--
-- HOW IT APPLIES. Percent rows still compute off the post-flat base v_base, and
-- a cart with no override is computed EXACTLY as before — one round() over the
-- whole base, so every pinned total in the existing tests is unchanged to the
-- cent. When any line carries an override the account row is computed per line
-- instead, each line scaled by (v_base / v_subtotal) the same way a code percent
-- is scaled, then summed. Uniform carts keep their old rounding because they
-- keep their old code path, not because the two happen to agree.
--
-- THE VIEW IS RE-CREATED, SO ITS GRANTS ARE RE-STATED. `create view` + `grant
-- select` alone silently leaves the bootstrap ALTER DEFAULT PRIVILEGES grants
-- (insert/update/delete to anon) in place — the RLS-bypass class 078 found in
-- production. revoke all comes first, every time.

-- ── 1. The rate ────────────────────────────────────────────────────────────
alter table product_flags
  add column if not exists member_discount_percent smallint;

alter table product_flags
  drop constraint if exists product_flags_member_discount_percent_check;
alter table product_flags
  add constraint product_flags_member_discount_percent_check
  check (member_discount_percent is null
         or (member_discount_percent >= 0 and member_discount_percent <= 100));

comment on column product_flags.member_discount_percent is
  'Per-product automatic member rate, overriding the account tier floor for THIS sku only (087). NULL means the account''s own rate applies, which is the normal case. 0 means the product is excluded from member pricing entirely.';

-- ── 2. The public view — revoke before grant ───────────────────────────────
drop view if exists public_product_flags;
create view public_product_flags
  with (security_invoker = true)
  as select sku, early_access, member_discount_percent from product_flags;

revoke all on public_product_flags from public, anon, authenticated;
grant select on public_product_flags to anon, authenticated;

comment on view public_product_flags is
  'Anon-readable projection of product_flags: the catalog needs early_access and the per-product member rate to render honestly, and neither is a secret. Nothing else on the table is exposed. SELECT only — see 078 for why the revoke above is not optional.';

-- ── 3. The seed ────────────────────────────────────────────────────────────
insert into product_flags (sku, member_discount_percent)
values ('VSR-RS-TZO-025', 10)
on conflict (sku) do update set member_discount_percent = excluded.member_discount_percent;

-- ── 4. recompute_order_totals — 049 verbatim apart from pass 3b ────────────
create or replace function recompute_order_totals(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  oc          record;
  v_subtotal  integer := 0;
  v_shipping  integer := 0;
  v_flat      integer := 0;
  v_pct_used  integer := 0;
  v_base      integer := 0;
  v_this      integer := 0;
  v_free      integer := 0;
  v_discount  integer := 0;
  v_total     integer := 0;
  v_codes     text;
  v_free_ship boolean := false;
  v_has_rate  boolean := false;
  v_scale     numeric := 0;
begin
  -- 1. Ensure a free-item line exists for any free_item coupon that has none.
  for oc in select * from order_coupons where order_id = p_order_id and kind = 'free_item' loop
    if oc.free_sku is not null
       and not exists (
         select 1 from order_lines
          where order_id = p_order_id and sku = oc.free_sku and unit_price_cents = 0
       )
    then
      insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note)
      values (p_order_id, oc.free_sku, coalesce(oc.free_label, oc.free_sku), 1, 0, 'Free item');
    end if;
  end loop;

  -- 2. Line subtotal (free-item lines already at $0 add nothing).
  select coalesce(sum(unit_price_cents * quantity), 0) into v_subtotal
    from order_lines where order_id = p_order_id;

  select greatest(coalesce(shipping_cents, 0), 0) into v_shipping
    from orders where id = p_order_id;

  -- 2b. Member free-shipping perk (049).
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

  -- Does any line carry a per-product member rate (087)? Only then does the
  -- account row need the per-line path; otherwise the whole-base round() below
  -- is used verbatim, so an ordinary cart's total is bit-for-bit what it was.
  select exists (
    select 1
      from order_lines ol
      join product_flags pf on pf.sku = ol.sku
     where ol.order_id = p_order_id
       and pf.member_discount_percent is not null
  ) into v_has_rate;

  v_scale := case when v_subtotal > 0 then v_base::numeric / v_subtotal::numeric else 0 end;

  for oc in select * from order_coupons
             where order_id = p_order_id and kind = 'percent' and percent is not null
             order by case when source = 'account' then 0 else 1 end, created_at
  loop
    if oc.source = 'account' and v_has_rate then
      -- Per line: the product's own rate where one is set, the account's rate
      -- otherwise. Each line's share of the post-flat base is its value scaled
      -- by (v_base / v_subtotal) — the same scaling a code percent gets.
      select coalesce(sum(
               round(
                 (ol.unit_price_cents * ol.quantity) * v_scale
                 * coalesce(pf.member_discount_percent, oc.percent) / 100.0
               )
             ), 0)::integer
        into v_this
        from order_lines ol
        left join product_flags pf on pf.sku = ol.sku
       where ol.order_id = p_order_id;
      v_this := greatest(least(v_this, v_base - v_pct_used), 0);
    else
      v_this := greatest(least(round(v_base * oc.percent / 100.0)::integer, v_base - v_pct_used), 0);
    end if;
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
