-- 041_admin_orders_ship_confirm.sql
-- ---------------------------------------------------------------------------
-- Admin-initiated orders + buyer double-confirmed shipping address.
--
-- Flow: admin composes an order from scratch (no inquiry) → system emails the
-- branded invoice with a "Confirm shipping address" CTA → the buyer opens
-- /track via their lookup_token and submits their address → address +
-- confirmation timestamp land on the order. No new status value — this is an
-- orthogonal timestamp flag, same convention as payment_claimed_at (020).
--
-- Lands:
--   • ship_confirmed_at         — buyer-confirmation timestamp on orders.
--   • admin_create_order RPC    — is_admin()-gated, mirrors
--     create_order_from_inquiry (027)'s order-number + line-insert shape.
--   • confirm_order_shipping    — anon-callable, token-gated (mirrors
--     get_order_by_token's token check + mark_payment_claimed's grant style).
--     No exception paths on bad input — always returns {ok:false, reason}
--     so a malicious caller gets no oracle to enumerate tokens/orders with.
--   • get_order_by_token        — redefined (live body from 039) to also
--     expose the ship_* + ship_confirmed_at fields to the token holder.
-- ---------------------------------------------------------------------------

-- ── 1. ship_confirmed_at ─────────────────────────────────────────────────────
alter table orders add column if not exists ship_confirmed_at timestamptz;

-- ── 2. admin_create_order — compose an order with no inquiry behind it ──────
create or replace function admin_create_order(
  p_buyer_name         text,
  p_buyer_contact      text,
  p_buyer_organization text default null,
  p_notes              text default null,
  p_lines              jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin    uuid;
  v_name     text;
  v_contact  text;
  v_org      text;
  v_notes    text;
  v_order_id uuid;
  v_order_no text;
  v_line     jsonb;
  v_sku      text;
  v_pname    text;
  v_qty      integer;
  v_unit     integer;
  v_idx      integer := 0;
  v_count    integer := 0;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  v_name    := nullif(btrim(p_buyer_name), '');
  v_contact := nullif(btrim(p_buyer_contact), '');
  v_org     := nullif(btrim(p_buyer_organization), '');
  v_notes   := nullif(btrim(p_notes), '');

  if v_name is null then
    raise exception 'Buyer name is required';
  end if;
  if v_contact is null then
    raise exception 'Buyer contact is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;
  if jsonb_array_length(p_lines) < 1 then
    raise exception 'At least one line item is required';
  end if;

  -- Validate every line before mutating anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku   := nullif(btrim(v_line->>'sku'), '');
    v_pname := nullif(btrim(v_line->>'product_name'), '');
    v_qty   := nullif(v_line->>'quantity', '')::int;
    v_unit  := nullif(v_line->>'unit_price_cents', '')::int;
    if v_sku is null or v_pname is null then
      raise exception 'Line %: sku and product_name are required', v_idx;
    end if;
    if v_qty is null or v_qty < 1 then
      raise exception 'Line %: quantity must be at least 1', v_idx;
    end if;
    if v_unit is null or v_unit < 0 then
      raise exception 'Line %: unit_price_cents must be a non-negative integer', v_idx;
    end if;
    v_idx := v_idx + 1;
  end loop;

  v_order_no := gen_order_number();

  insert into orders (
    order_number, status,
    buyer_name, buyer_contact, buyer_organization, notes,
    created_by
  )
  values (
    v_order_no, 'pending_invoice',
    v_name, v_contact, v_org, v_notes,
    v_admin
  )
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note, fast_ship)
    values (
      v_order_id,
      btrim(v_line->>'sku'),
      btrim(v_line->>'product_name'),
      (v_line->>'quantity')::int,
      (v_line->>'unit_price_cents')::int,
      nullif(btrim(v_line->>'item_note'), ''),
      false
    );
    v_count := v_count + 1;
  end loop;

  perform recompute_order_totals(v_order_id);

  perform log_audit(
    'order.created', 'order', v_order_id::text,
    format('Order %s created by admin (%s item%s)',
      v_order_no, v_count, case when v_count = 1 then '' else 's' end),
    null,
    jsonb_build_object(
      'order_number', v_order_no,
      'buyer',        v_name,
      'contact',      v_contact
    ),
    null
  );

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no);
end;
$$;

revoke execute on function admin_create_order(text, text, text, text, jsonb) from public;
revoke execute on function admin_create_order(text, text, text, text, jsonb) from anon, authenticated;
grant execute on function admin_create_order(text, text, text, text, jsonb) to authenticated;

-- ── 3. confirm_order_shipping — buyer double-confirms via lookup_token ──────
-- Anon-callable security surface: every failure path returns a generic
-- {ok:false, reason} instead of raising, so there's no error-shape oracle to
-- distinguish "bad token" from "order closed" from "bad address" at the wire
-- level beyond the reason string itself (which reveals nothing the token
-- holder doesn't already know from get_order_by_token).
create or replace function confirm_order_shipping(
  p_token   text,
  p_street  text,
  p_city    text,
  p_state   text,
  p_zip     text,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token   text;
  v_order   orders%rowtype;
  v_street  text;
  v_city    text;
  v_state   text;
  v_zip     text;
  v_country text;
  v_note    text;
begin
  v_token := nullif(btrim(p_token), '');
  if v_token is null or length(v_token) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'invalid token');
  end if;

  select * into v_order from orders where lookup_token = v_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid token');
  end if;

  if v_order.status in ('cancelled', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order closed');
  end if;
  if v_order.status = 'fulfilled' then
    return jsonb_build_object('ok', false, 'reason', 'order already shipped');
  end if;

  v_street  := nullif(btrim(p_street), '');
  v_city    := nullif(btrim(p_city), '');
  v_state   := nullif(btrim(p_state), '');
  v_zip     := nullif(btrim(p_zip), '');
  v_country := nullif(btrim(p_country), '');

  if v_street is null or v_city is null or v_zip is null or v_country is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid address');
  end if;
  if length(v_street) > 200
     or length(v_city) > 120
     or (v_state is not null and length(v_state) > 80)
     or length(v_zip) > 32
     or length(v_country) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'invalid address');
  end if;

  update orders
    set ship_street       = v_street,
        ship_city         = v_city,
        ship_state        = v_state,
        ship_zip          = v_zip,
        ship_country      = v_country,
        ship_confirmed_at = now(),
        updated_at        = now()
    where id = v_order.id;

  v_note := 'Buyer confirmed shipping address: ' || v_street || ', ' || v_city ||
            ', ' || coalesce(v_state || ' ', '') || v_zip || ', ' || v_country;

  insert into order_events (order_id, stage, kind, actor, note)
  values (v_order.id, v_order.status::text, 'system', null, v_note);

  return jsonb_build_object(
    'ok', true,
    'order_number', v_order.order_number,
    'ship_confirmed_at', now()
  );
end;
$$;

revoke execute on function confirm_order_shipping(text, text, text, text, text, text) from public;
revoke execute on function confirm_order_shipping(text, text, text, text, text, text) from anon, authenticated;
grant execute on function confirm_order_shipping(text, text, text, text, text, text) to anon, authenticated;

-- ── 4. get_order_by_token — expose ship_* + ship_confirmed_at ───────────────
-- Identical to the live 039 definition, plus the additive ship fields so the
-- /track page can render the confirmed address and gate the confirm form
-- when ship_confirmed_at is already set.
create or replace function get_order_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_number',    o.order_number,
    'status',          case
                         when o.status = 'cancelled'      then 'cancelled'
                         when o.delivered_at is not null   then 'delivered'
                         when o.tracking_number is not null
                           or o.shipped_at is not null
                           or o.status = 'fulfilled'       then 'shipped'
                         when o.status = 'paid'            then 'processing'
                         when o.status = 'payment_claimed' then 'payment_verifying'
                         when o.status = 'invoice_sent'    then 'awaiting_payment'
                         else 'received'
                       end,
    'buyer_name',      o.buyer_name,
    'placed_at',       o.created_at,
    'shipped_at',      o.shipped_at,
    'delivered_at',    o.delivered_at,
    'carrier',         o.carrier,
    'tracking_number', o.tracking_number,
    'subtotal_cents',  o.subtotal_cents,
    'shipping_cents',  o.shipping_cents,
    'discount_cents',  o.discount_cents,
    'total_cents',     coalesce(o.invoice_amount_cents, o.subtotal_cents),
    'payment_method',  o.payment_method,
    'paid',            o.paid_at is not null,
    'ship_street',        o.ship_street,
    'ship_city',          o.ship_city,
    'ship_state',         o.ship_state,
    'ship_zip',           o.ship_zip,
    'ship_country',       o.ship_country,
    'ship_confirmed_at',  o.ship_confirmed_at,
    'lines',           coalesce(
      (select jsonb_agg(jsonb_build_object(
        'sku',              ol.sku,
        'product_name',     ol.product_name,
        'quantity',         ol.quantity,
        'unit_price_cents', ol.unit_price_cents,
        'item_note',        ol.item_note
      ) order by ol.id)
       from order_lines ol where ol.order_id = o.id),
      '[]'::jsonb
    ),
    'coupons',         coalesce(
      (select jsonb_agg(jsonb_build_object(
        'code',           oc.code,
        'kind',           oc.kind,
        'free_label',     oc.free_label,
        'percent',        oc.percent,
        'amount_cents',   oc.amount_cents,
        'discount_cents', oc.discount_cents
      ) order by oc.created_at)
       from order_coupons oc where oc.order_id = o.id),
      '[]'::jsonb
    )
  )
  from orders o
  where o.lookup_token = p_token
  limit 1;
$$;

grant execute on function get_order_by_token(text) to anon, authenticated;
