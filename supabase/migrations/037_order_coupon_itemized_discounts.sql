-- 037_order_coupon_itemized_discounts.sql
-- ---------------------------------------------------------------------------
-- Itemize the stacked discount: store each coupon's COMPUTED discount on its
-- order_coupons row so the admin editor can show one line per code
-- (e.g. "FREEBH2O — Free Bacteriostatic Water 10 mL  −$30.00") instead of a
-- single lumped total. Free-item coupons keep the item visible at its price
-- and record the offset as their discount, so the reduction is obvious and
-- adds to the discount up top.
--
-- Only recompute_order_totals changes (create-or-replace); the apply/remove/
-- clear/shipping RPCs from 036 call it unchanged.
-- ---------------------------------------------------------------------------

alter table order_coupons
  add column if not exists discount_cents integer not null default 0;

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

  -- 3. Per-coupon discount off the raw subtotal, stored on each row.
  for oc in select * from order_coupons where order_id = p_order_id loop
    v_this := 0;
    if oc.kind = 'percent' and oc.percent is not null then
      v_this := round(v_subtotal * oc.percent / 100.0)::integer;
    elsif oc.kind = 'fixed' and oc.amount_cents is not null then
      v_this := oc.amount_cents;
    elsif oc.kind = 'free_item' and oc.free_sku is not null then
      -- Make one on-order unit of the free SKU free: discount = its unit price.
      select coalesce(max(unit_price_cents), 0) into v_free
        from order_lines where order_id = p_order_id and sku = oc.free_sku and unit_price_cents > 0;
      v_this := coalesce(v_free, 0);
    end if;
    update order_coupons set discount_cents = v_this where id = oc.id;
    v_discount := v_discount + v_this;
  end loop;
  v_discount := least(greatest(v_discount, 0), v_subtotal);

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

revoke execute on function recompute_order_totals(uuid) from public, anon, authenticated;
