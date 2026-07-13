-- 052_reward_percent_fence.sql
-- ---------------------------------------------------------------------------
-- Stacking fix: percent discounts must not compound on the reward item.
--
-- The 050 reward ("40% off one item") is materialized as a fixed order_coupons
-- row (source='reward') worth percent% of the highest single unit price. The
-- 049 recompute (and pre-fix place-order) then let percent coupons apply to a
-- base that STILL CONTAINED the reward item's remaining 60% — so a 15% code
-- compounded on the 40% item instead of discounting only the other lines.
--   Example: $50 + $50 cart, reward on A (−$20), 15% code.
--   Before: base = 100−20 = 80 → 15% slice = $12 → total off $32.
--   Intent: 15% sees only B ($50) → $7.50            → total off $27.50.
--
-- Fix: fence off the reward item's post-reward remainder from the percent
-- base. The remainder re-derives from the reward row itself —
-- discount × (100−percent)/percent — using the `percent` place-order now
-- stamps on the reward row (defaulting 40 for rows minted before this
-- migration). place-order applies the identical fence at checkout.
--
-- Body below = 049's recompute_order_totals + the v_reward_fence block.
-- Requires 049/050. Rollback: re-apply 049's recompute_order_totals.
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
  v_flat     integer := 0;
  v_base     integer;
  v_pct_used integer := 0;
  v_discount integer := 0;
  v_this     integer;
  v_free     integer;
  v_total    integer;
  v_codes    text;
  v_free_ship boolean;
  v_reward_fence integer := 0;
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

  -- 3a′ (052). Reward fence — the reward item's post-reward remainder is
  --     off-limits to percent rows: remainder = discount × (100−pct)/pct.
  --     `percent` is stamped on reward rows by place-order; 40 covers rows
  --     minted before 052.
  select coalesce(sum(
           round(oc2.discount_cents
                 * (100 - coalesce(oc2.percent, 40))
                 / greatest(coalesce(oc2.percent, 40), 1)::numeric)::integer
         ), 0)
    into v_reward_fence
    from order_coupons oc2
   where oc2.order_id = p_order_id
     and oc2.source = 'reward'
     and oc2.kind = 'fixed'
     and coalesce(oc2.discount_cents, 0) > 0;

  -- 3b. PERCENTS on the post-flat base minus the reward fence. Account rows
  --     (source='account') first, then codes in created_at order.
  v_base := greatest(v_subtotal - v_flat - v_reward_fence, 0);
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
