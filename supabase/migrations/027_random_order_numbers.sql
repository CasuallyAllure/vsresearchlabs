-- 027_random_order_numbers.sql
--
-- New order-number style: VSR-XXXXXX — a short, unguessable code instead of
-- VSR-ORD-YYMMDD-NNN. Cleaner to read AND non-enumerable (the old dated form
-- leaked order volume and could be guessed; ~1000/day). Alphabet excludes
-- ambiguous characters (O/0/I/1/L) so it's easy to read aloud.
--
-- Safe to switch now: the pre-launch reset left zero existing orders, so there
-- are no legacy numbers to migrate. The storefront path (place-order Edge
-- Function) is updated to match separately.

create or replace function gen_order_number()
returns text
language plpgsql
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  text;
begin
  loop
    v_code := 'VSR-' || (
      select string_agg(
        substr(v_alpha, (floor(random() * length(v_alpha)) + 1)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from orders where order_number = v_code);
  end loop;
  return v_code;
end;
$$;

-- Redefine create_order_from_inquiry to use the new generator. Identical to
-- the live definition except for the order-number line.
create or replace function create_order_from_inquiry(p_inquiry_id uuid)
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

  v_order_no := gen_order_number();

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
