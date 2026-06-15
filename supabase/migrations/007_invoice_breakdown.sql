-- =============================================================================
-- VS Research Labs — Invoice Breakdown + Ship-To (S6)
-- =============================================================================
-- Adds the data needed for a real invoice email:
--   • ship-to address captured at inquiry / order time
--   • subtotal + shipping separated from the single invoice total
--
-- Additive across inquiries + orders. Existing rows are unaffected; new
-- rows fill these in when the cart form collects an address.
-- =============================================================================

-- ── inquiries: ship-to ─────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'inquiries' and column_name = 'ship_street') then
    alter table inquiries
      add column ship_street  text,
      add column ship_city    text,
      add column ship_state   text,
      add column ship_zip     text,
      add column ship_country text default 'US';
  end if;
end $$;

-- ── orders: ship-to + breakdown ────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'orders' and column_name = 'ship_street') then
    alter table orders
      add column ship_street  text,
      add column ship_city    text,
      add column ship_state   text,
      add column ship_zip     text,
      add column ship_country text default 'US';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'orders' and column_name = 'subtotal_cents') then
    alter table orders
      add column subtotal_cents integer check (subtotal_cents is null or subtotal_cents >= 0),
      add column shipping_cents integer check (shipping_cents is null or shipping_cents >= 0);
  end if;
end $$;

-- ── create_order_from_inquiry now copies the ship-to ──────────────────────

create or replace function create_order_from_inquiry(
  p_inquiry_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inq      inquiries%rowtype;
  v_order_id uuid;
  v_order_no text;
  v_admin    uuid;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  v_admin := auth.uid();

  select * into v_inq from inquiries where id = p_inquiry_id;
  if not found then
    raise exception 'Inquiry not found';
  end if;

  v_order_no := 'VSR-ORD-' ||
                to_char(now() at time zone 'utc', 'YYMMDD') ||
                '-' ||
                lpad((floor(extract(epoch from clock_timestamp()) * 10)::bigint % 1000)::text,
                     3, '0');

  insert into orders (
    order_number, inquiry_id, status,
    buyer_name, buyer_contact, buyer_organization, notes,
    ship_street, ship_city, ship_state, ship_zip, ship_country,
    created_by
  )
  values (
    v_order_no, p_inquiry_id, 'pending_invoice',
    v_inq.name, v_inq.contact, v_inq.organization, v_inq.notes,
    v_inq.ship_street, v_inq.ship_city, v_inq.ship_state,
    v_inq.ship_zip, v_inq.ship_country,
    v_admin
  )
  returning id into v_order_id;

  insert into order_lines (order_id, sku, product_name, quantity, item_note)
  select v_order_id, sku, product_name, quantity, item_note
  from inquiry_items
  where inquiry_id = p_inquiry_id;

  update inquiries
    set status = 'REVIEWING'
    where id = p_inquiry_id
      and status = 'OPEN';

  perform log_audit(
    'order.created', 'order', v_order_id::text,
    format('Created %s from inquiry %s', v_order_no, v_inq.reference_id),
    null,
    jsonb_build_object(
      'order_number', v_order_no,
      'inquiry_id',   p_inquiry_id,
      'buyer',        v_inq.name,
      'contact',      v_inq.contact
    ),
    null
  );

  return v_order_id;
end;
$$;

-- ── mark_order_invoiced now takes subtotal + shipping ─────────────────────
-- Keeps p_invoice_amount_cents for back-compat: if the new fields are
-- provided, the total is derived; otherwise we fall back to the legacy
-- single-field flow.

create or replace function mark_order_invoiced(
  p_order_id             uuid,
  p_invoice_url          text,
  p_invoice_amount_cents integer,
  p_payment_method       text default 'Zelle (info@velariss.co)',
  p_subtotal_cents       integer default null,
  p_shipping_cents       integer default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order_no text;
  v_total    integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_invoice_amount_cents is not null and p_invoice_amount_cents < 0 then
    raise exception 'Invoice amount cannot be negative';
  end if;

  -- Derive total if subtotal + shipping provided.
  if p_subtotal_cents is not null then
    v_total := p_subtotal_cents + coalesce(p_shipping_cents, 0);
  else
    v_total := p_invoice_amount_cents;
  end if;

  update orders
    set status               = 'invoice_sent',
        invoice_url          = p_invoice_url,
        invoice_amount_cents = v_total,
        subtotal_cents       = coalesce(p_subtotal_cents, subtotal_cents),
        shipping_cents       = coalesce(p_shipping_cents, shipping_cents),
        payment_method       = p_payment_method,
        invoiced_at          = now(),
        updated_at           = now()
    where id = p_order_id
      and status = 'pending_invoice'
    returning order_number into v_order_no;

  if v_order_no is null then
    raise exception 'Order must be pending_invoice to mark invoiced';
  end if;

  perform log_audit(
    'order.invoiced', 'order', p_order_id::text,
    format('Invoice sent for %s ($%s)', v_order_no, (v_total/100.0)::numeric(10,2)),
    jsonb_build_object('status', 'pending_invoice'),
    jsonb_build_object(
      'status',         'invoice_sent',
      'invoice_url',    p_invoice_url,
      'subtotal_cents', p_subtotal_cents,
      'shipping_cents', p_shipping_cents,
      'total_cents',    v_total,
      'payment_method', p_payment_method
    ),
    null
  );
end;
$$;

grant execute on function mark_order_invoiced(uuid, text, integer, text, integer, integer)
  to authenticated;
