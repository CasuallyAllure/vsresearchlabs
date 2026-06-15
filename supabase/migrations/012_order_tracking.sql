-- =============================================================================
-- VS Research Labs — Order tracking & public status lookup (S7)
-- =============================================================================
-- Lets a customer look up an order's status + tracking from the storefront,
-- and lets an admin record the carrier + tracking number (in the UI or via a
-- bulk sheet). Builds on the existing orders.tracking_number column and the
-- ship_zip captured in migration 010.
--
--   • orders.carrier      — 'usps' | 'ups' | 'fedex' | 'dhl' | free text
--   • orders.shipped_at   — set when tracking is first attached
--   • orders.delivered_at — set by mark_order_delivered (manual today; a carrier
--                           API could set it automatically later)
--
-- Public lookup is intentionally narrow: it matches an order ONLY when the
-- shipping ZIP matches the supplied order number OR buyer email, and returns
-- just the status surface (no address, no PII beyond what the buyer already
-- knows). This prevents order-number enumeration.
--
-- Additive. Re-runnable.
-- =============================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'orders' and column_name = 'carrier') then
    alter table orders add column carrier text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'orders' and column_name = 'shipped_at') then
    alter table orders add column shipped_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'orders' and column_name = 'delivered_at') then
    alter table orders add column delivered_at timestamptz;
  end if;
end $$;

-- ── confirm_order_fulfilled — now records the carrier + ship date ────────────
-- Replaces the 2-arg version with a 3-arg one (p_carrier defaults null, so the
-- existing 2-named-arg client call keeps working unchanged).

drop function if exists confirm_order_fulfilled(uuid, text);

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
  v_admin    uuid;
  v_line     record;
  v_on_hand  integer;
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

    update product_stock
      set on_hand    = on_hand - v_line.quantity,
          updated_at = now()
      where sku = v_line.sku
      returning on_hand into v_on_hand;

    if v_on_hand < 0 then
      raise exception 'Insufficient stock for SKU % (line quantity %)',
        v_line.sku, v_line.quantity;
    end if;

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

-- ── set_order_tracking — edit carrier / tracking after the fact ──────────────
-- Lets an admin attach or correct tracking on an already-fulfilled order
-- without re-running fulfillment (which would double-decrement stock).

create or replace function set_order_tracking(
  p_order_id        uuid,
  p_carrier         text,
  p_tracking_number text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  update orders
    set carrier         = nullif(btrim(p_carrier), ''),
        tracking_number = nullif(btrim(p_tracking_number), ''),
        shipped_at      = coalesce(shipped_at, now()),
        updated_at      = now()
    where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  perform log_audit(
    'order.tracking_set', 'order', p_order_id::text,
    format('Tracking set — %s %s', coalesce(p_carrier, '—'), coalesce(p_tracking_number, '—')),
    null, null, jsonb_build_object('carrier', p_carrier, 'tracking_number', p_tracking_number)
  );
end;
$$;

grant execute on function set_order_tracking(uuid, text, text) to authenticated;

-- ── mark_order_delivered — manual delivered flag (carrier API can do this later)

create or replace function mark_order_delivered(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  update orders
    set delivered_at = coalesce(delivered_at, now()),
        updated_at   = now()
    where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  perform log_audit(
    'order.delivered', 'order', p_order_id::text,
    'Marked delivered', null, null, '{}'::jsonb
  );
end;
$$;

grant execute on function mark_order_delivered(uuid) to authenticated;

-- ── lookup_order — public, ZIP-gated status read ─────────────────────────────

create or replace function lookup_order(p_identifier text, p_zip text)
returns table (
  order_number    text,
  status          text,
  carrier         text,
  tracking_number text,
  placed_at       timestamptz,
  shipped_at      timestamptz,
  delivered_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.order_number,
    case
      when o.status = 'cancelled'        then 'cancelled'
      when o.delivered_at is not null     then 'delivered'
      when o.tracking_number is not null
        or o.shipped_at is not null
        or o.status = 'fulfilled'         then 'shipped'
      when o.status = 'paid'              then 'processing'
      when o.status = 'invoice_sent'      then 'awaiting_payment'
      else 'received'
    end as status,
    o.carrier,
    o.tracking_number,
    o.created_at as placed_at,
    o.shipped_at,
    o.delivered_at
  from orders o
  where nullif(btrim(p_zip), '') is not null
    and lower(btrim(o.ship_zip)) = lower(btrim(p_zip))
    and (
      lower(btrim(o.order_number))  = lower(btrim(p_identifier))
      or lower(btrim(o.buyer_contact)) = lower(btrim(p_identifier))
    )
  order by o.created_at desc
  limit 10;
$$;

grant execute on function lookup_order(text, text) to anon, authenticated;
