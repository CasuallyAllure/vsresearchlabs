-- 016_client_order_invoice.sql
--
-- Client-facing invoice / receipt access.
--
-- The public order view (TrackOrder) needs two things beyond the status read
-- shipped in migration 012:
--   1. Invoice totals + a "paid" flag, so the ZIP-gated card can show the
--      amount due (invoice) or amount paid (receipt) — no extra factor, since
--      the buyer already proved email/order# + shipping ZIP.
--   2. The itemized line items, behind a SECOND factor (the order number), so
--      a casual email+ZIP match can't enumerate exactly what was purchased.
--
-- Both RPCs are SECURITY DEFINER and expose only the buyer's own order data
-- (amounts + their own line items) — no address, no internal notes, no PII
-- beyond what the buyer received in their invoice email.

-- ── lookup_order — now also returns invoice totals + a paid flag ─────────────
-- Return signature changes, so the old function must be dropped first.
drop function if exists lookup_order(text, text);

create or replace function lookup_order(p_identifier text, p_zip text)
returns table (
  order_number    text,
  status          text,
  carrier         text,
  tracking_number text,
  placed_at       timestamptz,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  subtotal_cents  integer,
  shipping_cents  integer,
  total_cents     integer,
  payment_method  text,
  paid            boolean
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
    o.delivered_at,
    o.subtotal_cents,
    o.shipping_cents,
    o.invoice_amount_cents as total_cents,
    o.payment_method,
    (o.paid_at is not null or o.status in ('paid', 'fulfilled') or o.delivered_at is not null) as paid
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

-- ── lookup_order_lines — itemized read, gated by order number + ZIP ──────────
-- The "View full details" second factor. Returns the order's line items only
-- when the supplied order number AND shipping ZIP both match.
create or replace function lookup_order_lines(p_order_number text, p_zip text)
returns table (
  sku              text,
  product_name     text,
  quantity         integer,
  unit_price_cents integer,
  item_note        text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.sku,
    l.product_name,
    l.quantity,
    l.unit_price_cents,
    l.item_note
  from order_lines l
  join orders o on o.id = l.order_id
  where nullif(btrim(p_zip), '') is not null
    and nullif(btrim(p_order_number), '') is not null
    and lower(btrim(o.ship_zip)) = lower(btrim(p_zip))
    and lower(btrim(o.order_number)) = lower(btrim(p_order_number));
$$;

grant execute on function lookup_order_lines(text, text) to anon, authenticated;
