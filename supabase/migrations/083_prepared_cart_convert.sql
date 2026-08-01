-- =============================================================================
-- 083_prepared_cart_convert.sql — push a prepared cart through into a real order
-- =============================================================================
-- THE BUG THIS CLOSES
-- -------------------
-- The owner builds a prepared cart for a member and sends it. The member pays
-- him directly (Zelle, off-site) and never completes checkout. Because a
-- prepared cart only becomes an order when the MEMBER checks out, there was no
-- order at all: nothing to fulfil, nothing to invoice, nothing to mark paid.
-- This was discovered after a real client had already paid.
--
-- So: the admin converts the cart himself. He has already collected the money,
-- so the figures he types ARE the record — this path deliberately does not
-- re-price anything.
--
-- WHY THIS IS NOT place-order
-- ---------------------------
-- place-order's verifyLinePrices rejects the whole order (409) when a line
-- price is not byte-identical to the live catalog ("FAIL CLOSED … to the cent,
-- no tolerance"). That is correct for the customer checkout path and fatal
-- here: an admin-agreed price would make the order unplaceable, not cheaper.
-- The admin path is admin_create_order (041), which has always taken a
-- hand-typed unit price — the same one AdminNewOrder's "Unit $" box writes.
--
-- WHAT THIS MIGRATION CHANGES, AND WHY EACH PIECE IS FORCED
-- ---------------------------------------------------------
--  1. prepared_carts.converted_at / converted_order_id — the cart must not be
--     convertible twice (two orders, one payment), and the panel has to be able
--     to say "converted → ORDER-1234" instead of silently offering the button
--     again.
--
--  2. admin_create_order gains p_user_id and p_discount.
--
--     p_user_id is the REGRESSION THIS FIXES. `+ New order` has never set
--     orders.user_id, and two things hang off it:
--       • mark_order_paid (044:118-127) mints reward points only `if v_user_id
--         is not null` — a converted cart would otherwise earn the member
--         nothing, on an order they actually paid for;
--       • the account portal's own-orders RLS policy is `user_id = auth.uid()`
--         (028), so the order would never appear in their history.
--     This flow knows exactly who the member is, so leaving it null would be a
--     choice, not a limitation.
--
--     p_discount is what makes the owner's number the recorded number. It
--     materialises as ONE order_coupons row (036/045) — kind 'percent' or
--     'fixed', source 'account' — which is the only discount representation
--     recompute_order_totals reads. Anything not written there is silently
--     erased by the next line edit, so a discount that lived only on
--     orders.discount_cents would be worse than none.
--
--     Both parameters have defaults and are appended, so the existing 5-argument
--     PostgREST call from AdminNewOrder.tsx keeps resolving unchanged. The old
--     5-argument signature is dropped first: leaving it in place would create an
--     overload pair where a 5-name call is ambiguous.
--
--  3. admin_convert_prepared_cart — one transactional verb that DELEGATES to
--     admin_create_order rather than re-implementing it. There is no second
--     order-creation path here: order numbering, line insertion, the
--     'pending_invoice' start state, recompute_order_totals and the
--     'order.created' audit row all stay where they already live. What this adds
--     is what only it can do atomically — stamp the cart converted, revoke the
--     link, and audit the conversion, in the same transaction as the order.
--     Two client-side RPCs could not: a failure between them leaves a live link
--     on an order the member could buy a second time.
--
--  4. admin_prepared_carts — 'converted' is now a status, checked BEFORE
--     'revoked'. Converting revokes, so without this the panel would report a
--     converted cart as merely revoked and lose the order it became.
--
-- GRANTS — revoke BEFORE grant, on every routine
-- ----------------------------------------------
-- A new routine is born EXECUTE-to-PUBLIC (PostgreSQL's own default) and the
-- bootstrap ALTER DEFAULT PRIVILEGES adds anon + authenticated on top; 079
-- found 70 of 80 public routines callable that way. Every routine below is
-- revoked from public, anon, authenticated and then granted to `authenticated`
-- only — as narrow as an ACL can express for an admin RPC, with the
-- `if not is_admin() then raise` body as the real fence. THE REAL GUARD IS THE
-- TEST: admin_convert_prepared_cart is registered in
-- tests/integration/functionGrantHardening.test.ts's AUTHENTICATED_ONLY
-- allowlist and must never appear in ANON_CALLABLE.
--
-- Additive, idempotent and re-runnable. No data rewritten. Forward-fix only.
-- =============================================================================


-- ── 1. The conversion stamp ────────────────────────────────────────────────
-- converted_order_id is ON DELETE SET NULL rather than CASCADE: delete_order
-- (062) hard-deletes orders, and a deleted order must not take the cart's
-- history with it. converted_at survives the null, so the cart still cannot be
-- converted a second time — which is the property that matters.

alter table prepared_carts
  add column if not exists converted_at       timestamptz,
  add column if not exists converted_order_id uuid references orders(id) on delete set null;

create index if not exists prepared_carts_converted_order_idx
  on prepared_carts (converted_order_id) where converted_order_id is not null;

comment on column prepared_carts.converted_at is
  'Set when an admin pushed this cart through into a real order (083). Non-null means the cart is spent: admin_convert_prepared_cart refuses a second conversion, and the link was revoked in the same transaction so the member cannot also claim and buy it.';
comment on column prepared_carts.converted_order_id is
  'The order this cart became. ON DELETE SET NULL — a hard-deleted order must not erase the fact that the cart was converted.';


-- ── 2. admin_create_order — 041 body + owner stamp + admin-set discount ────
-- Verbatim 041 apart from the two appended parameters and the two blocks that
-- consume them. Dropped first so the 5-argument overload cannot linger and make
-- a 5-name PostgREST call ambiguous.

drop function if exists admin_create_order(text, text, text, text, jsonb);

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

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_no);
end;
$$;

comment on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb) is
  'Admin-composed order. Unit prices are hand-set and recorded as given — this is the admin path, not place-order, which fails closed on any client-supplied price. p_user_id stamps orders.user_id so reward points mint (mark_order_paid, 044) and the order reaches the member''s portal; p_discount materialises the admin-agreed discount as one source=''account'' order_coupons row, the only representation recompute_order_totals reads.';


-- ── 3. admin_convert_prepared_cart — the whole conversion, one transaction ──
-- Delegates order creation to admin_create_order (above). What it owns is what
-- must not be split across two client calls: the double-conversion guard, the
-- cart stamp, and revoking the link so a converted cart cannot ALSO be claimed
-- and bought by the member.
--
-- Returns {ok:false, reason} for a missed or spent cart rather than raising, so
-- a double-tap or a stale panel is a calm, informative no-op — and the
-- already_converted branch hands back the order it became, so the owner is told
-- what happened rather than that nothing did. A non-admin still gets a raise:
-- "already done" and "you may not do this" must never look alike.

create or replace function admin_convert_prepared_cart(
  p_cart_id            uuid,
  p_buyer_name         text,
  p_buyer_contact      text,
  p_buyer_organization text default null,
  p_notes              text default null,
  p_lines              jsonb default '[]'::jsonb,
  p_discount           jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_user_id   uuid;
  v_converted timestamptz;
  v_prior     uuid;
  v_prior_no  text;
  v_created   jsonb;
  v_order_id  uuid;
  v_order_no  text;
  v_total     integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  -- FOR UPDATE, so two admins tapping Convert at the same moment serialise:
  -- the loser reads converted_at already set and returns already_converted
  -- instead of writing a second order against one payment.
  select user_id, converted_at, converted_order_id
    into v_user_id, v_converted, v_prior
    from prepared_carts
   where id = p_cart_id
     for update;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_converted is not null then
    select order_number into v_prior_no from orders where id = v_prior;
    return jsonb_build_object(
      'ok', false, 'reason', 'already_converted',
      'order_id', v_prior, 'order_number', v_prior_no
    );
  end if;

  v_created := admin_create_order(
    p_buyer_name, p_buyer_contact, p_buyer_organization, p_notes,
    p_lines, v_user_id, p_discount
  );
  v_order_id := (v_created->>'order_id')::uuid;
  v_order_no := v_created->>'order_number';

  -- Converting REVOKES. The member has already paid off-site; a link that still
  -- opens would let them load the same cart and check out again.
  update prepared_carts
     set converted_at       = now(),
         converted_order_id = v_order_id,
         revoked_at         = coalesce(revoked_at, now())
   where id = p_cart_id;

  select invoice_amount_cents into v_total from orders where id = v_order_id;

  perform log_audit(
    'member.prepared_cart.converted',
    'customer',
    v_user_id::text,
    format('Prepared cart converted to order %s', v_order_no),
    null,
    jsonb_build_object(
      'cart_id',      p_cart_id,
      'order_id',     v_order_id,
      'order_number', v_order_no,
      'total_cents',  v_total,
      'discount',     p_discount
    ),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_no,
    'total_cents', v_total
  );
end;
$$;

comment on function admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb) is
  'Admin-only. Pushes a prepared cart through into a real order in ONE transaction: delegates creation to admin_create_order (so numbering, lines, start status, totals and the order.created audit row stay in one place), stamps the cart converted, and revokes the link so a cart that became an order cannot also be claimed and bought again. A second conversion returns {ok:false, reason:''already_converted''} with the order it already became.';


-- ── 4. admin_prepared_carts — 'converted' outranks 'revoked' ───────────────
-- Verbatim 082 apart from the three converted_* fields and the new first branch
-- of the status case. Converting revokes, so without the reorder the panel would
-- report a converted cart as merely revoked and lose the order behind it.

create or replace function admin_prepared_carts(
  p_user_id uuid,
  p_limit   integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows  jsonb;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
             'id',                    pc.id,
             'created_at',            pc.created_at,
             'expires_at',            pc.expires_at,
             'claimed_at',            pc.claimed_at,
             'last_claimed_at',       pc.last_claimed_at,
             'claim_count',           pc.claim_count,
             'revoked_at',            pc.revoked_at,
             'converted_at',          pc.converted_at,
             'converted_order_id',    pc.converted_order_id,
             'converted_order_number',(select o.order_number from orders o where o.id = pc.converted_order_id),
             'coupon_code',           pc.coupon_code,
             'note',                  pc.note,
             -- Openability, plus the one terminal state that is not a failure.
             -- 'converted' is checked FIRST because converting also revokes.
             'status',                case
                                        when pc.converted_at is not null then 'converted'
                                        when pc.revoked_at is not null   then 'revoked'
                                        when pc.expires_at <= now()      then 'expired'
                                        else 'live'
                                      end,
             'lines',                 (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'sku', l.sku, 'dose', l.dose, 'quantity', l.quantity
                      ) order by l.position, l.sku), '[]'::jsonb)
                 from prepared_cart_lines l
                where l.cart_id = pc.id
             )
           ) as r
      from prepared_carts pc
     where pc.user_id = p_user_id
     order by pc.created_at desc
     limit v_limit
  ) s;

  return jsonb_build_object('rows', v_rows);
end;
$$;


-- ── 5. EXECUTE grants — revoke from all three roles, then narrow ───────────
-- See the header. `authenticated` is as narrow as an ACL can express for an
-- admin RPC; the is_admin() body guard is the real fence, and both are asserted
-- by tests/integration/functionGrantHardening.test.ts.

revoke execute on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant  execute on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb) to authenticated;

revoke execute on function admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb) to authenticated;

revoke execute on function admin_prepared_carts(uuid, integer) from public, anon, authenticated;
grant  execute on function admin_prepared_carts(uuid, integer) to authenticated;
