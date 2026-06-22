-- 026_fulfill_friendly_stock_error.sql
--
-- confirm_order_fulfilled decremented product_stock and only checked for a
-- negative result AFTER the UPDATE. But product_stock has a CHECK
-- (on_hand >= 0), so the UPDATE itself raised the raw Postgres error
--   "new row for relation product_stock violates check constraint
--    product_stock_on_hand_check"
-- before the friendly guard could run — an unreadable message that doesn't
-- say which item is short.
--
-- Fix: lock + read each SKU's on_hand and validate availability BEFORE
-- decrementing, raising a clear, product-named message. Same signature and
-- behavior otherwise.

create or replace function confirm_order_fulfilled(
  p_order_id        uuid,
  p_tracking_number text default null,
  p_carrier         text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin   uuid;
  v_line    record;
  v_on_hand integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  v_admin := auth.uid();

  perform 1 from orders where id = p_order_id and status = 'paid' for update;
  if not found then
    raise exception 'Order must be paid to mark fulfilled';
  end if;

  for v_line in
    select * from order_lines where order_id = p_order_id
  loop
    insert into product_stock (sku, on_hand) values (v_line.sku, 0)
      on conflict (sku) do nothing;

    -- Lock the row and check availability up front so the friendly message
    -- wins over the table's on_hand >= 0 check constraint.
    select on_hand into v_on_hand
      from product_stock where sku = v_line.sku
      for update;

    if coalesce(v_on_hand, 0) < v_line.quantity then
      raise exception 'Not enough stock for % (%): need %, have %',
        coalesce(nullif(btrim(v_line.product_name), ''), v_line.sku),
        v_line.sku, v_line.quantity, coalesce(v_on_hand, 0)
        using errcode = 'P0001';
    end if;

    update product_stock
      set on_hand    = on_hand - v_line.quantity,
          updated_at = now()
      where sku = v_line.sku
      returning on_hand into v_on_hand;

    insert into stock_movements
      (sku, delta, reason, order_id, admin_id, on_hand_after)
    values
      (v_line.sku, -v_line.quantity, 'order_fulfilled',
       p_order_id, v_admin, v_on_hand);
  end loop;

  update orders
    set status          = 'fulfilled',
        tracking_number = coalesce(p_tracking_number, tracking_number),
        carrier         = coalesce(nullif(btrim(p_carrier), ''), carrier),
        shipped_at      = coalesce(shipped_at, now()),
        fulfilled_at    = now(),
        updated_at      = now()
    where id = p_order_id;
end;
$$;

grant execute on function confirm_order_fulfilled(uuid, text, text) to authenticated;
