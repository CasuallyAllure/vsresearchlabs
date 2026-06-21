-- 024_save_lines_sync_invoice_total.sql
--
-- BUGFIX: editing order lines surfaced added items as a phantom discount.
--
-- save_order_lines (020/023) recomputed subtotal_cents from the new lines but
-- deliberately left invoice_amount_cents (the billed total) untouched. When an
-- admin added a line in the itemized editor, the subtotal rose but the total
-- stayed frozen at the old value — and the UI derives
--   discount = subtotal + shipping - total
-- so the added line appeared as a NEGATIVE adjustment ("−$75 discount") instead
-- of increasing the amount due.
--
-- Discounts are not a feature yet, so the correct behavior is: the billed total
-- tracks the lines. This redefinition sets invoice_amount_cents = subtotal +
-- shipping on every line save, keeping the header in sync. (When real discount
-- handling lands, this is where it would subtract an explicit discount_cents.)
--
-- Carries forward the fast_ship persistence added in 023.

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
  v_total    integer;
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

  -- Sync the header: subtotal from the lines, and the billed total tracks
  -- subtotal + shipping (no phantom discount). shipping_cents is left as the
  -- admin set it.
  update orders
    set subtotal_cents       = v_subtotal,
        invoice_amount_cents = v_subtotal + coalesce(shipping_cents, 0),
        updated_at           = now()
    where id = p_order_id
    returning invoice_amount_cents into v_total;
  if not found then
    raise exception 'Order not found';
  end if;

  perform log_audit(
    'order.lines_saved', 'order', p_order_id::text,
    format('Lines saved (%s item%s, subtotal %s, total %s)',
      v_count, case when v_count = 1 then '' else 's' end,
      to_char(v_subtotal::numeric / 100, 'FM999,999,999.00'),
      to_char(v_total::numeric / 100, 'FM999,999,999.00')),
    null, null,
    jsonb_build_object('line_count', v_count, 'subtotal_cents', v_subtotal, 'invoice_amount_cents', v_total)
  );

  return jsonb_build_object(
    'line_count',           v_count,
    'subtotal_cents',       v_subtotal,
    'invoice_amount_cents', v_total
  );
end;
$$;

grant execute on function save_order_lines(uuid, jsonb) to authenticated;
