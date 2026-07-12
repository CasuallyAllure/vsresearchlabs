-- 042_coupon_stacking_compounding.sql
-- ---------------------------------------------------------------------------
-- Align the ADMIN order editor's coupon math with the CUSTOMER checkout
-- (place-order): COMPOUNDING order, not additive-off-subtotal.
--
--   1. free_item + fixed coupons reduce the base FIRST.
--   2. percent coupons then apply to the REMAINDER (subtotal − step 1), not to
--      the raw subtotal.
--   3. total is capped at the subtotal.
--
-- Example the owner hit: subtotal $160, FREEBH2O frees the $30 water, a 25%
-- code was deducting $40 (25% of $160). It should deduct $32.50 (25% of the
-- $130 remainder) → total $97.50.
--
-- Only recompute_order_totals changes (create-or-replace); the apply/remove/
-- clear/shipping RPCs from 036 keep calling it unchanged. Per-coupon
-- discount_cents (037) is still written per row so the itemized editor lines
-- stay correct.
-- ---------------------------------------------------------------------------

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
  v_base := greatest(v_subtotal - v_flat, 0);
  for oc in select * from order_coupons where order_id = p_order_id and kind = 'percent' and percent is not null loop
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

revoke execute on function recompute_order_totals(uuid) from public, anon, authenticated;
