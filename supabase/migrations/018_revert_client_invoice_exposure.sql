-- 018_revert_client_invoice_exposure.sql
--
-- SECURITY MITIGATION (reverts 016).
--
-- Migration 016 widened the anonymous order lookup to return invoice financials
-- (subtotal/shipping/total, payment_method, paid) AND a full itemized line read
-- (lookup_order_lines). Both were gated only by (order_number | buyer email) +
-- shipping ZIP. That gate is enumerable: order numbers are VSR-ORD-YYMMDD-NNN
-- where NNN is a centisecond bucket mod 1000 (<=1000 values/known day) and the
-- shipping ZIP is low-entropy. An anon attacker could therefore enumerate
-- orders and harvest each order's amounts and exact itemized contents.
--
-- This migration restores the anon surface to the status/tracking-only read
-- from migration 012 — no financials, no line items. A token-gated invoice
-- view (high-entropy lookup_token emailed with the invoice) is the intended
-- replacement and will be added separately.

-- Remove the itemized read entirely.
drop function if exists lookup_order_lines(text, text);

-- Restore lookup_order to its 012 (status/tracking-only) return shape.
drop function if exists lookup_order(text, text);

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
