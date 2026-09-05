-- 093_reward_on_admin_order.sql
-- ---------------------------------------------------------------------------
-- A member's 300-point reward voucher can now be spent on an ADMIN-created
-- order.
--
-- WHY. reward_vouchers (050) mints one active "40% off one item" voucher per
-- member, and exactly one code path has ever redeemed it: the place-order edge
-- function, which picks the member's active voucher (handler.ts:683-695),
-- claims it through consume_reward_voucher (064) and materialises it as one
-- source='reward' order_coupons row (handler.ts:1430-1447). Orders the owner
-- builds — `+ New order`, and the prepared-cart conversion an owner uses when
-- the member has already paid off-site — go through admin_create_order (085)
-- via admin_convert_prepared_cart (083) and never touch vouchers at all. So a
-- member who had spent 300 points could not have that reward honoured on the
-- one order path the owner actually drives; the voucher sat active forever and
-- the discount had to be faked as an ad-hoc p_discount, which spends nothing
-- and leaves the voucher live to be spent AGAIN at self-checkout.
--
-- WHAT THIS ADDS. An optional `p_reward` object on both RPCs:
--   {"voucher_id": "<uuid>", "line_index": <int>}
-- The admin names the voucher and the line it applies to; everything else is
-- re-derived server-side from reward_vouchers.percent and that line's
-- unit_price_cents. Nothing about the amount is taken from the client.
--
-- RELATIONSHIP TO 052. This function only INSERTS the order_coupons row.
-- recompute_order_totals (052:73-114) is still the single money source of
-- truth: it re-derives every discount_cents from amount_cents, and it re-reads
-- `percent` off the reward row to fence the discounted item's remaining
-- (100−pct)% away from percent coupons — remainder = discount × (100−pct)/pct.
-- Writing a second opinion on the totals here is exactly how the two drift, so
-- the insert happens BEFORE the recompute and the recompute has the last word.
-- `discount_cents` is nevertheless written on the row, field-for-field with
-- what place-order writes, so the row is never momentarily zero-valued.
--
-- NO CATEGORY EXCLUSION IS ENFORCED, deliberately — parity with place-order,
-- which applies the reward to the highest unit price in the cart with no
-- product/tier/blend filter (orderTotals.ts:186-197). If an exclusion is ever
-- wanted it belongs in BOTH paths at once, not smuggled into this one.
--
-- ATOMICITY. consume_reward_voucher is called inside the same transaction as
-- the order insert, and any subsequent raise rolls the consume back with the
-- order — a voucher is never burned by an order that did not survive. It is
-- callable from here despite being revoked from authenticated (064) because
-- these SECURITY DEFINER bodies run as the function owner.
--
-- Both functions are DROPPED and recreated rather than `create or replace`d:
-- adding a defaulted argument makes a NEW signature, and leaving the 7-argument
-- overload in place would make every PostgREST named-argument call ambiguous.
-- The 5-name call from AdminNewOrder.tsx still resolves through the defaults.
--
-- Additive. Rollback: forward-fix only — deploy a later migration carrying
-- 085's and 083's bodies back under the 7-argument signatures.
-- ---------------------------------------------------------------------------

-- ── 1. admin_create_order — 085's body plus the reward ─────────────────────

drop function if exists admin_create_order(text, text, text, text, jsonb, uuid, jsonb);

create or replace function admin_create_order(
  p_buyer_name         text,
  p_buyer_contact      text,
  p_buyer_organization text default null,
  p_notes              text default null,
  p_lines              jsonb default '[]'::jsonb,
  p_user_id            uuid default null,
  p_discount           jsonb default null,
  p_reward             jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin       uuid;
  v_name        text;
  v_contact     text;
  v_org         text;
  v_notes       text;
  v_order_id    uuid;
  v_order_no    text;
  v_token       text;
  v_line        jsonb;
  v_sku         text;
  v_pname       text;
  v_qty         integer;
  v_unit        integer;
  v_idx         integer := 0;
  v_count       integer := 0;
  v_kind        text;
  v_percent     numeric;
  v_amount      integer;
  v_code        text;
  v_voucher_id  uuid;
  v_reward_pct  integer;
  v_reward_idx  integer;
  v_reward_unit integer;
  v_reward_amt  integer;
  v_consumed    jsonb;
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

  -- Validate the reward the same way, and for the same reason: a voucher is a
  -- spent 300 points. Every field is checked here, before a row exists, so a
  -- malformed reward can never half-apply. The voucher is NOT consumed yet —
  -- the consume needs the order id, so it happens after the insert, still in
  -- this transaction.
  if p_reward is not null and jsonb_typeof(p_reward) <> 'null' then
    if jsonb_typeof(p_reward) <> 'object' then
      raise exception 'p_reward must be a JSON object';
    end if;
    -- No p_user_id means no orders.user_id, so the reward could not be tied to
    -- the member it belongs to and the ownership check below has nothing to
    -- check against.
    if p_user_id is null then
      raise exception 'A reward voucher needs a member (p_user_id)';
    end if;
    begin
      v_voucher_id := (p_reward->>'voucher_id')::uuid;
    exception when others then
      raise exception 'Reward voucher_id is not a uuid';
    end;
    if v_voucher_id is null then
      raise exception 'Reward voucher_id is not a uuid';
    end if;
    begin
      v_reward_idx := (p_reward->>'line_index')::integer;
    exception when others then
      raise exception 'Reward line_index out of range';
    end;
    if v_reward_idx is null
       or v_reward_idx < 0
       or v_reward_idx >= jsonb_array_length(p_lines) then
      raise exception 'Reward line_index out of range';
    end if;
    -- OWNERSHIP. consume_reward_voucher (064) gates on status only — it never
    -- looks at user_id — so without this predicate an admin typo could spend
    -- one member's voucher on another member's order.
    select percent into v_reward_pct
      from reward_vouchers
     where id = v_voucher_id
       and user_id = p_user_id
       and status = 'active';
    if not found then
      raise exception 'Reward voucher is not active for this member';
    end if;
    -- Same arithmetic place-order uses (orderTotals.ts:190): percent of ONE
    -- unit price, not of the line and not of the cart.
    v_reward_unit := (p_lines->v_reward_idx->>'unit_price_cents')::integer;
    v_reward_amt  := round(v_reward_unit * v_reward_pct / 100.0)::integer;
    if v_reward_amt <= 0 then
      raise exception 'Reward line has no price to discount';
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

  -- CLAIM FIRST, then materialise — the order of operations place-order uses
  -- (handler.ts:1430-1447). consume_reward_voucher is one guarded
  -- `update … where status='active' returning`, so of two racing callers
  -- exactly one wins the flip; a loser raises and this whole order rolls back
  -- rather than shipping a discount against a voucher it did not win.
  if v_voucher_id is not null then
    v_consumed := consume_reward_voucher(v_voucher_id, v_order_id);
    if coalesce((v_consumed->>'ok')::boolean, false) is not true then
      raise exception 'Reward voucher could not be consumed (%)', coalesce(v_consumed->>'reason', 'unknown');
    end if;
    -- `percent` is informational on a fixed row, but recompute_order_totals
    -- (052) reads it to re-derive the fenced remainder of the reward item:
    -- remainder = discount × (100−pct)/pct.
    insert into order_coupons (order_id, code, kind, percent, amount_cents, free_label, discount_cents, source)
    values (v_order_id, 'REWARD', 'fixed', v_reward_pct, v_reward_amt,
            format('%s%% off one item', v_reward_pct), v_reward_amt, 'reward');
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
      'discount',     p_discount,
      'reward',       p_reward
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

comment on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb, jsonb) is
  'Admin-composed order. Unit prices are hand-set and recorded as given — this is the admin path, not place-order, which fails closed on any client-supplied price. p_user_id stamps orders.user_id so reward points mint (mark_order_paid, 044) and the order reaches the member''s portal; p_discount materialises the admin-agreed discount as one source=''account'' order_coupons row. p_reward {voucher_id, line_index} (093) spends the member''s 300-point voucher (050) on the named line: ownership and active status are re-checked here, the amount is re-derived from reward_vouchers.percent and that line''s unit price, and consume_reward_voucher (064) claims it in this transaction — a later raise rolls the claim back with the order. recompute_order_totals remains the only writer of the money.';


-- ── 2. admin_convert_prepared_cart — 083's body, reward passed through ─────
-- Verbatim 083 apart from the new trailing argument and the two places it
-- travels: the delegated admin_create_order call and the audit meta.

drop function if exists admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb);

create or replace function admin_convert_prepared_cart(
  p_cart_id            uuid,
  p_buyer_name         text,
  p_buyer_contact      text,
  p_buyer_organization text default null,
  p_notes              text default null,
  p_lines              jsonb default '[]'::jsonb,
  p_discount           jsonb default null,
  p_reward             jsonb default null
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

  -- The cart's own user_id is what the reward is checked against — the admin
  -- names a voucher, never a member.
  v_created := admin_create_order(
    p_buyer_name, p_buyer_contact, p_buyer_organization, p_notes,
    p_lines, v_user_id, p_discount, p_reward
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
      'discount',     p_discount,
      'reward',       p_reward
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

comment on function admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb, jsonb) is
  'Admin-only. Pushes a prepared cart through into a real order in ONE transaction: delegates creation to admin_create_order (so numbering, lines, start status, totals, the reward voucher claim and the order.created audit row stay in one place), stamps the cart converted, and revokes the link so a cart that became an order cannot also be claimed and bought again. A second conversion returns {ok:false, reason:''already_converted''} with the order it already became. p_reward (093) is passed straight through and is validated against the CART''s member, not a caller-supplied one.';


-- ── 3. Grants ──────────────────────────────────────────────────────────────
-- Same posture 083/085 left behind: revoked from everyone, handed back to
-- authenticated, and the bodies' is_admin() is the real gate. Revoke before
-- grant, always — a fresh function inherits PUBLIC EXECUTE by default.

revoke execute on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function admin_create_order(text, text, text, text, jsonb, uuid, jsonb, jsonb) to authenticated;

revoke execute on function admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function admin_convert_prepared_cart(uuid, text, text, text, text, jsonb, jsonb, jsonb) to authenticated;
