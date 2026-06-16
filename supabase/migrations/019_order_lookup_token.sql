-- 019_order_lookup_token.sql
--
-- Secure client invoice/receipt access (replaces the enumerable 016 design
-- that 018 reverted).
--
-- Each order gets a high-entropy secret `lookup_token` (256-bit, two UUIDs).
-- The full invoice — totals, payment method, paid state, AND itemized lines —
-- is exposed to anon ONLY when the exact token is presented. The token is not
-- guessable, so there's no enumeration path. The admin shares a link
-- (/track?t=<token>); the public order-number/email + ZIP form remains
-- status/tracking-only (lookup_order, migration 018).

-- ── token column: add, backfill, default, enforce ───────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'orders' and column_name = 'lookup_token'
  ) then
    alter table orders add column lookup_token text;
  end if;
end $$;

-- Backfill existing rows. gen_random_uuid() is core (no pgcrypto needed);
-- two of them stripped of dashes give a 64-hex-char (256-bit) secret.
update orders
  set lookup_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  where lookup_token is null;

alter table orders
  alter column lookup_token set default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
alter table orders alter column lookup_token set not null;
create unique index if not exists orders_lookup_token_key on orders (lookup_token);

-- ── get_order_by_token — token-gated full invoice / receipt ──────────────────
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
    'total_cents',     o.invoice_amount_cents,
    'payment_method',  o.payment_method,
    'paid',            (o.paid_at is not null or o.status in ('paid', 'fulfilled') or o.delivered_at is not null),
    'lines',           coalesce((
                         select jsonb_agg(jsonb_build_object(
                           'sku',              l.sku,
                           'product_name',     l.product_name,
                           'quantity',         l.quantity,
                           'unit_price_cents', l.unit_price_cents,
                           'item_note',        l.item_note
                         ) order by l.product_name)
                         from order_lines l where l.order_id = o.id
                       ), '[]'::jsonb)
  )
  from orders o
  where nullif(btrim(p_token), '') is not null
    and o.lookup_token = p_token
  limit 1;
$$;

grant execute on function get_order_by_token(text) to anon, authenticated;
