-- 085_admin_order_no_contact.sql
--
-- An order for a walk-in buyer who leaves no email and no phone.
--
-- WHY. The owner takes orders in person and over the phone. admin_create_order
-- has required a contact string since 041, and the composer additionally
-- demanded it parse as an email — so an order for someone who will be handed a
-- link by text, or who simply reads the order number off a screen, could not be
-- created at all. The buyer NAME stays required: an order no one can be matched
-- back to is a different problem from an order with no contact.
--
-- WHAT THIS IS NOT. No new link mechanism. Every order has carried a 64-hex
-- `lookup_token` since 019, anon-readable through get_order_by_token, and /track
-- already renders it. This migration only RETURNS that existing token from
-- admin_create_order, so the composer can show the link at the one moment it is
-- useful instead of making the owner go find the order again.
--
-- The token is a capability: whoever holds the URL sees that order. That is
-- unchanged from 019/041 and is the same trade /track has always made — it is
-- why the token is 64 hex characters and never derived from the order number.
--
-- Body is 083's verbatim, minus the contact guard, plus the token in the return
-- payload. Dropped first so the 7-argument overload cannot linger.

-- The column has been NOT NULL since 003. Dropping the RPC's guard alone would
-- only move the failure one layer down into a constraint violation, so the
-- column has to give first. Nothing reads it unconditionally: place-order
-- always supplies one at checkout, and link_my_orders (043) matches on
-- lower(buyer_contact), which simply does not match a null.
alter table orders alter column buyer_contact drop not null;

drop function if exists admin_create_order(text, text, text, text, jsonb, uuid, jsonb);

create or replace function admin_create_order(
  p_buyer_name         text,
  p_buyer_contact      text,
  p_buyer_organization text default null,
  p_notes              text default null,
  p_lines              jsonb default '[]'::jsonb,
  p_user_id            uuid default null,
  p_discount           jsonb default null
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
  v_token    text;
  v_line     jsonb;
  v_sku      text;
  v_pname    text;
  v_qty      integer;
  v_unit     integer;
  v_idx      integer := 0;
  v_count    integer := 0;
  v_kind     text;
  v_percent  numeric;
  v_amount   integer;
  v_code     text;
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

  -- Validate the discount before mutating anything, for the same reason. An
  -- admin-set discount is MONEY ALREADY COLLECTED — a malformed one must fail
  -- loudly here, never round to something plausible.
  if p_discount is not null and jsonb_typeof(p_discount) <> 'null' then
    if jsonb_typeof(p_discount) <> 'object' then
      raise exception 'p_discount must be a JSON object';
    end if;
    v_kind := nullif(btrim(coalesce(p_discount->>'kind', '')), '');
    v_code := nullif(btrim(coalesce(p_discount->>'code', '')), '');
    -- `is null or` is load-bearing: `null not in (...)` evaluates to NULL, which
    -- an `if` treats as false — a discount with no kind would slip through.
    if v_kind is null or v_kind not in ('percent', 'fixed') then
      raise exception 'Discount kind must be percent or fixed (got %)', coalesce(v_kind, 'null');
    end if;
    if v_code is null then
      raise exception 'A discount needs a code to appear on the invoice';
    end if;
    if v_kind = 'percent' then
      begin
        v_percent := (p_discount->>'percent')::numeric;
      exception when others then
        raise exception 'Discount percent is not a number';
      end;
      if v_percent is null or v_percent <= 0 or v_percent > 100 then
        raise exception 'Discount percent must be above 0 and at most 100';
      end if;
    else
      begin
        v_amount := (p_discount->>'amount_cents')::integer;
      exception when others then
        raise exception 'Discount amount_cents is not an integer';
      end;
      if v_amount is null or v_amount <= 0 then
        raise exception 'Discount amount_cents must be above zero';
      end if;
    end if;
  end if;

  v_order_no := gen_order_number();

  -- user_id (083): NULL for the plain `+ New order` composer, which has no
  -- account behind it; the member's id when a prepared cart was converted.
  -- Points and portal visibility both hang off it — see the header.
  insert into orders (
    order_number, status,
    buyer_name, buyer_contact, buyer_organization, notes,
    created_by, user_id
  )
  values (
    v_order_no, 'pending_invoice',
    v_name, v_contact, v_org, v_notes,
    v_admin, p_user_id
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

  -- The discount as ONE order_coupons row, source 'account'. Not a coupon in
  -- the redeemable sense: no coupon_redemptions row, no redeem_coupon call, no
  -- affiliate — exactly the arrangement place-order uses to materialise a
  -- member's standing rate (handler.ts:1212-1226). discount_cents is left for
  -- recompute_order_totals to fill, because that function is the single money
  -- source of truth and writing a second opinion here is how the two drift.
  if v_kind = 'percent' then
    insert into order_coupons (order_id, code, kind, percent, source)
    values (v_order_id, v_code, 'percent', v_percent, 'account');
  elsif v_kind = 'fixed' then
    insert into order_coupons (order_id, code, kind, amount_cents, source)
    values (v_order_id, v_code, 'fixed', v_amount, 'account');
  end if;

  perform recompute_order_totals(v_order_id);

  perform log_audit(
    'order.created', 'order', v_order_id::text,
    format('Order %s created by admin (%s item%s)',
      v_order_no, v_count, case when v_count = 1 then '' else 's' end),
    null,
    jsonb_build_object(
      'order_number', v_order_no,
      'buyer',        v_name,
      'contact',      v_contact,
      'user_id',      p_user_id,
      'discount',     p_discount
    ),
    null
  );

  select lookup_token into v_token from orders where id = v_order_id;

  return jsonb_build_object(
    'order_id',     v_order_id,
    'order_number', v_order_no,
    'lookup_token', v_token
  );
end;
$$;


-- Same grant shape 083 left behind: revoked from everyone, handed back to
-- authenticated, and the body's is_admin() is the real gate.
revoke execute on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant  execute on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb) to authenticated;
