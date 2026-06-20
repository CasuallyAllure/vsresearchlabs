-- 021_public_status_mapping_new_stages.sql
--
-- Migration 020 added two new internal order statuses (pending_review,
-- payment_claimed) but the public-facing lookup RPCs from migration 012/019
-- still map only the old enum values. As a result:
--   • pending_review and pending_invoice both fall through to 'received',
--     which is fine but bunches them. Acceptable.
--   • payment_claimed (buyer clicked "I've sent payment") silently falls
--     through to 'received' too, which is WRONG — buyer should see they
--     advanced a stage. Goes to a new public stage 'payment_verifying'.
--
-- This migration redefines both lookup_order and get_order_by_token to add
-- a payment_verifying public status. Nothing else changes; same arguments,
-- same return shape, additive case branch.

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
      when o.status = 'payment_claimed'   then 'payment_verifying'
      when o.status = 'invoice_sent'      then 'awaiting_payment'
      else 'received'
    end as status,
    case when o.shipped_at is not null then o.carrier        end as carrier,
    case when o.shipped_at is not null then o.tracking_number end as tracking_number,
    o.created_at  as placed_at,
    o.shipped_at,
    o.delivered_at
  from orders o
  join inquiries i on i.id = o.inquiry_id
  where
    (
      lower(o.order_number) = lower(btrim(p_identifier))
      or lower(i.contact)   = lower(btrim(p_identifier))
    )
    and o.ship_zip is not null
    and replace(o.ship_zip, ' ', '') = replace(btrim(p_zip), ' ', '')
  order by o.created_at desc
  limit 1;
$$;

grant execute on function lookup_order(text, text) to anon, authenticated;

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
    'total_cents',     coalesce(o.invoice_amount_cents, o.subtotal_cents),
    'payment_method',  o.payment_method,
    'paid',            o.paid_at is not null,
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
    )
  )
  from orders o
  where o.lookup_token = p_token
  limit 1;
$$;

grant execute on function get_order_by_token(text) to anon, authenticated;
