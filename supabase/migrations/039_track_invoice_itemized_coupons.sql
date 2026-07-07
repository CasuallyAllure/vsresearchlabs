-- 039_track_invoice_itemized_coupons.sql
-- ---------------------------------------------------------------------------
-- The /track invoice doc (opened by the buyer via their secure lookup_token)
-- showed a single lumped "Discount" line. Add the per-coupon breakdown +
-- explicit discount_cents to get_order_by_token so the online invoice itemizes
-- each code exactly like the admin editor and the emailed invoice.
--
-- Token-gated (the caller already holds the order's unguessable lookup_token),
-- so exposing THIS order's own coupon lines is not an enumeration risk. Same
-- return shape as 021 + two additive keys ('discount_cents', 'coupons').
-- ---------------------------------------------------------------------------

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
