-- 036_order_coupons_stacking_shipping.sql
-- ---------------------------------------------------------------------------
-- Admin order editor: STACK multiple coupons on one order, a $10 shipping
-- control, and a single recompute that keeps Subtotal − Σdiscounts + Shipping
-- = Total consistent everywhere (editor, order view, emailed invoice).
--
-- Supersedes the single-coupon 034 RPCs. No email is ever sent here — the admin
-- re-sends the invoice manually.
--
-- Model:
--   • order_coupons        — one row per code applied to an order (stacking).
--   • recompute_order_totals(order) — THE single source of truth. Re-derives
--       every discount from the CURRENT line subtotal (so percent codes stay
--       correct as lines change), handles free_item codes, and writes
--       orders.subtotal_cents / discount_cents / invoice_amount_cents +
--       coupon_code (comma-joined, for the invoice's Discount label).
--   • free_item handling ("whichever applies"): if a line with the coupon's
--       free_sku is already on the order, that unit is made free via an equal
--       discount (line stays visible, offset to $0 net — cleaner on the
--       invoice and reversible). If no such line exists, a $0 line is added so
--       the free item appears. Removing the coupon reverses both.
--
-- All mutations go through SECURITY DEFINER RPCs (is_admin()-gated), matching
-- save_order_lines / mark_order_invoiced. No direct admin writes to orders.
-- ---------------------------------------------------------------------------

create table if not exists order_coupons (
  id           uuid        primary key default gen_random_uuid(),
  order_id     uuid        not null references orders(id) on delete cascade,
  code         text        not null,
  kind         text        not null check (kind in ('percent', 'fixed', 'free_item')),
  percent      numeric,
  amount_cents integer,
  free_sku     text,
  free_dose    text,
  free_label   text,
  created_at   timestamptz not null default now(),
  unique (order_id, code)
);
create index if not exists order_coupons_order_id_idx on order_coupons (order_id);

alter table order_coupons enable row level security;
drop policy if exists "Admins read order_coupons" on order_coupons;
create policy "Admins read order_coupons" on order_coupons for select using (is_admin());
-- Writes happen only through the SECURITY DEFINER RPCs below.
revoke all on order_coupons from anon, authenticated;
grant select on order_coupons to authenticated;

-- ── recompute_order_totals — the single money source of truth ───────────────
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

  -- 2. Line subtotal (free-item lines that are already $0 add nothing).
  select coalesce(sum(unit_price_cents * quantity), 0) into v_subtotal
    from order_lines where order_id = p_order_id;

  select greatest(coalesce(shipping_cents, 0), 0) into v_shipping
    from orders where id = p_order_id;

  -- 3. Sum stacked discounts off the raw subtotal.
  for oc in select * from order_coupons where order_id = p_order_id loop
    if oc.kind = 'percent' and oc.percent is not null then
      v_discount := v_discount + round(v_subtotal * oc.percent / 100.0)::integer;
    elsif oc.kind = 'fixed' and oc.amount_cents is not null then
      v_discount := v_discount + oc.amount_cents;
    elsif oc.kind = 'free_item' and oc.free_sku is not null then
      -- Make one on-order unit of the free SKU free: discount = its unit price.
      select coalesce(max(unit_price_cents), 0) into v_free
        from order_lines where order_id = p_order_id and sku = oc.free_sku and unit_price_cents > 0;
      v_discount := v_discount + coalesce(v_free, 0);
    end if;
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

-- ── admin_apply_coupon — add one code to the stack ──────────────────────────
create or replace function admin_apply_coupon(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_sub    integer;
  v_check  jsonb;
begin
  if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;
  if not exists (select 1 from orders where id = p_order_id) then raise exception 'Order not found'; end if;

  select coalesce(sum(unit_price_cents * quantity), 0) into v_sub
    from order_lines where order_id = p_order_id;

  v_check := validate_coupon(v_code, v_sub);
  if not coalesce((v_check->>'valid')::boolean, false) then
    return jsonb_build_object('applied', false, 'reason', coalesce(v_check->>'reason', 'This code is not valid.'));
  end if;

  insert into order_coupons (order_id, code, kind, percent, amount_cents, free_sku, free_dose, free_label)
  values (
    p_order_id, v_code, v_check->>'kind',
    nullif(v_check->>'percent', '')::numeric,
    nullif(v_check->>'amount_cents', '')::integer,
    v_check->>'free_sku', v_check->>'free_dose', v_check->>'free_label'
  )
  on conflict (order_id, code) do update
    set kind = excluded.kind, percent = excluded.percent, amount_cents = excluded.amount_cents,
        free_sku = excluded.free_sku, free_dose = excluded.free_dose, free_label = excluded.free_label;

  perform log_audit('order.coupon_applied', 'order', p_order_id::text, format('Coupon %s applied', v_code), null);
  return recompute_order_totals(p_order_id) || jsonb_build_object('applied', true, 'code', v_code, 'kind', v_check->>'kind');
end;
$$;

-- ── admin_remove_coupon — drop one code; clean up its added free line ───────
create or replace function admin_remove_coupon(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  oc     order_coupons%rowtype;
begin
  if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;

  select * into oc from order_coupons where order_id = p_order_id and code = v_code;
  if found and oc.kind = 'free_item' and oc.free_sku is not null then
    -- Remove any $0 free line WE added for this SKU (leave paid lines alone).
    delete from order_lines
     where order_id = p_order_id and sku = oc.free_sku and unit_price_cents = 0;
  end if;

  delete from order_coupons where order_id = p_order_id and code = v_code;
  perform log_audit('order.coupon_removed', 'order', p_order_id::text, format('Coupon %s removed', v_code), null);
  return recompute_order_totals(p_order_id) || jsonb_build_object('applied', false, 'code', v_code);
end;
$$;

-- ── admin_clear_coupons — drop them all ─────────────────────────────────────
create or replace function admin_clear_coupons(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;
  delete from order_lines
   where order_id = p_order_id and unit_price_cents = 0
     and sku in (select free_sku from order_coupons where order_id = p_order_id and free_sku is not null);
  delete from order_coupons where order_id = p_order_id;
  perform log_audit('order.coupons_cleared', 'order', p_order_id::text, 'All coupons removed', null);
  return recompute_order_totals(p_order_id);
end;
$$;

-- ── set_order_shipping — $10 (or any amount) shipping ───────────────────────
create or replace function set_order_shipping(p_order_id uuid, p_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;
  update orders set shipping_cents = greatest(coalesce(p_cents, 0), 0), updated_at = now()
   where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  perform log_audit('order.shipping_set', 'order', p_order_id::text,
    format('Shipping set to %s', to_char(greatest(coalesce(p_cents,0),0)::numeric/100, 'FM999,999.00')), null);
  return recompute_order_totals(p_order_id);
end;
$$;

revoke execute on function recompute_order_totals(uuid)    from public, anon, authenticated;
revoke execute on function admin_apply_coupon(uuid, text)  from public, anon;
revoke execute on function admin_remove_coupon(uuid, text) from public, anon;
revoke execute on function admin_clear_coupons(uuid)       from public, anon;
revoke execute on function set_order_shipping(uuid, integer) from public, anon;
grant  execute on function admin_apply_coupon(uuid, text)  to authenticated;
grant  execute on function admin_remove_coupon(uuid, text) to authenticated;
grant  execute on function admin_clear_coupons(uuid)       to authenticated;
grant  execute on function set_order_shipping(uuid, integer) to authenticated;

-- ── save_order_lines — recompute through the stacked model ──────────────────
-- Replace the flat "total = subtotal − discount_cents" tail (034/031) with a
-- call to recompute_order_totals so stacked coupons + free lines + shipping all
-- stay correct after a line edit. Validation/audit carried forward from 031.
create or replace function save_order_lines(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_line jsonb; v_sku text; v_name text; v_qty integer; v_unit integer;
  v_count integer := 0; v_totals jsonb;
begin
  if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'p_lines must be a JSON array'; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku  := nullif(btrim(v_line->>'sku'), '');
    v_name := nullif(btrim(v_line->>'product_name'), '');
    v_qty  := nullif(v_line->>'quantity', '')::int;
    v_unit := nullif(v_line->>'unit_price_cents', '')::int;
    if v_sku is null or v_name is null then raise exception 'Every line needs sku and product_name'; end if;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then raise exception 'Quantity must be 1-9999 (got: %)', v_qty; end if;
    if v_unit is null or v_unit < 0 then raise exception 'unit_price_cents must be a non-negative integer'; end if;
    v_count := v_count + 1;
  end loop;

  delete from order_lines where order_id = p_order_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note, fast_ship)
    values (p_order_id, btrim(v_line->>'sku'), btrim(v_line->>'product_name'),
            (v_line->>'quantity')::int, (v_line->>'unit_price_cents')::int,
            nullif(btrim(v_line->>'item_note'), ''), (v_line->>'fast_ship')::boolean);
  end loop;

  -- Recompute subtotal + stacked discounts + free lines + shipping in one place.
  v_totals := recompute_order_totals(p_order_id);

  perform log_audit('order.lines_saved', 'order', p_order_id::text,
    format('Lines saved (%s item%s, subtotal %s, total %s)', v_count,
      case when v_count = 1 then '' else 's' end,
      to_char((v_totals->>'subtotal_cents')::numeric / 100, 'FM999,999,999.00'),
      to_char((v_totals->>'total_cents')::numeric / 100, 'FM999,999,999.00')),
    null);

  return jsonb_build_object(
    'subtotal_cents', (v_totals->>'subtotal_cents')::integer,
    'discount_cents', (v_totals->>'discount_cents')::integer,
    'total_cents',    (v_totals->>'total_cents')::integer
  );
end;
$$;
