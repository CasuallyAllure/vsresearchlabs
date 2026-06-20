-- 023_order_line_fast_ship.sql
--
-- Per-line FAST-ship snapshot. The catalog/cart label a (sku, dose) as FAST
-- when it's reachable from shelf or in-transit stock (vs the drop-ship
-- warehouse). We capture that flag at order time so the buyer invoice and the
-- business notification can show the SAME label the buyer saw in the cart —
-- and so a mixed order can warn that items ship separately.
--
-- Nullable: null = unknown/legacy line (render no badge). save_order_lines is
-- updated to carry the flag through admin line edits when present.

alter table order_lines add column if not exists fast_ship boolean;

-- Re-define save_order_lines (from 020) so an admin line edit preserves the
-- fast_ship flag when the payload includes it (defaults to null otherwise).
create or replace function save_order_lines(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_line     jsonb;
  v_sku      text;
  v_name     text;
  v_qty      integer;
  v_unit     integer;
  v_subtotal integer := 0;
  v_count    integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  -- Validate each row before mutating anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku  := nullif(btrim(v_line->>'sku'), '');
    v_name := nullif(btrim(v_line->>'product_name'), '');
    v_qty  := nullif(v_line->>'quantity', '')::int;
    v_unit := nullif(v_line->>'unit_price_cents', '')::int;
    if v_sku is null or v_name is null then
      raise exception 'Every line needs sku and product_name';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'Quantity must be 1-9999 (got: %)', v_qty;
    end if;
    if v_unit is null or v_unit < 0 then
      raise exception 'unit_price_cents must be a non-negative integer';
    end if;
    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_count    := v_count + 1;
  end loop;

  -- Replace lines wholesale.
  delete from order_lines where order_id = p_order_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note, fast_ship)
    values (
      p_order_id,
      btrim(v_line->>'sku'),
      btrim(v_line->>'product_name'),
      (v_line->>'quantity')::int,
      (v_line->>'unit_price_cents')::int,
      nullif(btrim(v_line->>'item_note'), ''),
      (v_line->>'fast_ship')::boolean
    );
  end loop;

  update orders
    set subtotal_cents = v_subtotal,
        updated_at     = now()
    where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  perform log_audit(
    'order.lines_saved', 'order', p_order_id::text,
    format('Lines saved (%s item%s, subtotal %s)',
      v_count, case when v_count = 1 then '' else 's' end,
      to_char(v_subtotal::numeric / 100, 'FM999,999,999.00')),
    null, null,
    jsonb_build_object('line_count', v_count, 'subtotal_cents', v_subtotal)
  );

  return jsonb_build_object('line_count', v_count, 'subtotal_cents', v_subtotal);
end;
$$;

grant execute on function save_order_lines(uuid, jsonb) to authenticated;
