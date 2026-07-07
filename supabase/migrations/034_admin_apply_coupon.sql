-- 034_admin_apply_coupon.sql
-- ---------------------------------------------------------------------------
-- Let an ADMIN apply / clear a coupon on an existing order from the back office
-- (the itemized order editor), WITHOUT sending any email.
--
-- Why an RPC: orders are only ever mutated through SECURITY DEFINER functions
-- (save_order_lines, mark_order_invoiced, …) — there is no direct admin UPDATE
-- grant on orders. This mirrors that pattern.
--
-- Behavior:
--   • admin_apply_coupon(order, code) — re-validates the code against the
--     order's CURRENT subtotal via validate_coupon(), then stamps
--     orders.discount_cents + coupon_code and re-derives invoice_amount_cents
--     (= subtotal + shipping − discount, clamped ≥ 0). Because save_order_lines
--     already subtracts discount_cents on every line edit (migration 031), the
--     discount then survives further "add/remove item" edits.
--   • admin_clear_coupon(order) — removes the discount + code, restores the
--     full total.
--
-- Neither sends email. The admin re-sends the invoice manually when ready; the
-- existing invoice template already renders the Discount line.
--
-- NOT the redemption ledger: this deliberately does NOT write coupon_redemptions
-- or affiliate commission (that stays place-order / service-role only). Admin
-- ops orders adjust the invoice; they don't accrue affiliate payouts.
-- ---------------------------------------------------------------------------

create or replace function admin_apply_coupon(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o          orders%rowtype;
  v_subtotal integer;
  v_shipping integer;
  v_check    jsonb;
  v_discount integer;
  v_total    integer;
  v_code     text := upper(btrim(coalesce(p_code, '')));
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select * into o from orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  v_subtotal := greatest(coalesce(o.subtotal_cents, 0), 0);
  v_shipping := greatest(coalesce(o.shipping_cents, 0), 0);

  v_check := validate_coupon(v_code, v_subtotal);
  if not coalesce((v_check->>'valid')::boolean, false) then
    return jsonb_build_object('applied', false, 'reason', coalesce(v_check->>'reason', 'This code is not valid.'));
  end if;

  v_discount := greatest(coalesce((v_check->>'discount_cents')::integer, 0), 0);
  v_total    := greatest(v_subtotal + v_shipping - v_discount, 0);

  update orders
     set discount_cents       = v_discount,
         coupon_code          = v_code,
         invoice_amount_cents = v_total,
         updated_at           = now()
   where id = p_order_id;

  perform log_audit(
    'order.coupon_applied', 'order', p_order_id::text,
    format('Coupon %s applied — discount %s, total %s',
      v_code,
      to_char(v_discount::numeric / 100, 'FM999,999,999.00'),
      to_char(v_total::numeric / 100, 'FM999,999,999.00')),
    null
  );

  return jsonb_build_object(
    'applied', true,
    'code', v_code,
    'kind', v_check->>'kind',
    'free_label', v_check->>'free_label',
    'discount_cents', v_discount,
    'total_cents', v_total
  );
end;
$$;

create or replace function admin_clear_coupon(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o       orders%rowtype;
  v_total integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select * into o from orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  v_total := greatest(coalesce(o.subtotal_cents, 0) + coalesce(o.shipping_cents, 0), 0);

  update orders
     set discount_cents       = 0,
         coupon_code          = null,
         invoice_amount_cents = v_total,
         updated_at           = now()
   where id = p_order_id;

  perform log_audit('order.coupon_cleared', 'order', p_order_id::text, 'Coupon removed', null);

  return jsonb_build_object('applied', false, 'total_cents', v_total);
end;
$$;

-- Admin-gated inside the function body; expose to signed-in sessions only.
revoke execute on function admin_apply_coupon(uuid, text) from public, anon;
revoke execute on function admin_clear_coupon(uuid)        from public, anon;
grant  execute on function admin_apply_coupon(uuid, text) to authenticated;
grant  execute on function admin_clear_coupon(uuid)        to authenticated;
