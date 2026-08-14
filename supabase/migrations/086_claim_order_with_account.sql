-- 086_claim_order_with_account.sql
--
-- The walk-in buyer signs up, and the order they were sent becomes theirs —
-- at their member rate.
--
-- WHY. 085 lets the owner create an order for someone with no email and no
-- phone, and hand them `/track?t=<lookup_token>`. That page now invites them to
-- create an account before they pay. The invitation has to be able to keep its
-- promise: attach this order to the new account, and apply the member rate to
-- it. `link_my_orders` (043) cannot do it — it matches guest orders by EMAIL,
-- and this order has none. The token is the only thing tying the buyer to the
-- order, so the token is what this function accepts as proof.
--
-- THE DISCOUNT IS NOT INVENTED HERE. The rate comes from
-- effective_customer_discount (045/069/074) — the same function place-order
-- calls at checkout — and materialises the same way admin_create_order (083)
-- materialises one: ONE order_coupons row, kind 'percent', source 'account',
-- with discount_cents left for recompute_order_totals to fill. That function
-- stays the single money source of truth; a second opinion written here is
-- exactly how the two drift.
--
-- WHAT IT REFUSES
--   • an order already owned by somebody else — the token grants a claim on an
--     UNCLAIMED order, never the power to take one off another account;
--   • re-pricing an order that is already paid, or no longer an open invoice.
--     It still ATTACHES in that case (so it shows up in their history) but the
--     money is settled and is left alone. The result says which happened rather
--     than reporting a discount that was not applied;
--   • a second discount row on a re-claim. Calling twice is idempotent: the
--     guard is `not exists (... source = 'account')`, so a buyer who reloads
--     the page cannot compound their own rate.
--
-- THE TRADE, STATED. Whoever holds the link can attach this order to their
-- account. That is the same capability the link already carried — it shows the
-- invoice and confirms the delivery address (019/041) — and it is the point of
-- the flow: the owner texts a link to the person standing in front of him. It
-- is why the token is 64 hex characters from a column default and is never
-- derived from the order number.

create or replace function claim_order_with_account(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user     uuid;
  v_token    text;
  v_order    orders%rowtype;
  v_entitle  jsonb;
  v_percent  numeric;
  v_label    text;
  v_repriced boolean := false;
  v_email    text;
begin
  v_user := auth.uid();
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  v_token := nullif(btrim(p_token), '');
  if v_token is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_order from orders where lookup_token = v_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_order.user_id is not null and v_order.user_id <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  -- Attach. Also backfill the contact when the order was created without one —
  -- a walk-in order's only contact detail is the account they just made.
  select email into v_email from auth.users where id = v_user;

  update orders
     set user_id       = v_user,
         buyer_contact = coalesce(buyer_contact, v_email)
   where id = v_order.id;

  -- Re-price only while the invoice is still open and unpaid. Stated as the
  -- statuses that are NOT open rather than the ones that are: order_status is
  -- an enum (003/004/020), and a label that does not exist raises rather than
  -- returning false, so the closed set — every one of which is a real label —
  -- is the safe side to enumerate.
  if v_order.paid_at is null
     and v_order.status not in (
       'paid', 'payment_claimed', 'fulfilled', 'cancelled', 'refunded'
     )
     and not exists (
       select 1 from order_coupons
        where order_id = v_order.id and source = 'account'
     )
  then
    v_entitle := effective_customer_discount(v_user);
    if coalesce((v_entitle->>'found')::boolean, false) then
      v_percent := (v_entitle->>'percent')::numeric;
      v_label   := coalesce(v_entitle->>'label', 'Account-holder rate');
      if v_percent > 0 then
        insert into order_coupons (order_id, code, kind, percent, source)
        values (v_order.id, v_label, 'percent', v_percent, 'account');
        perform recompute_order_totals(v_order.id);
        v_repriced := true;
      end if;
    end if;
  end if;

  perform log_audit(
    'order.claimed', 'order', v_order.id::text,
    format('Order %s claimed by an account holder%s',
      v_order.order_number,
      case when v_repriced then format(' and re-priced at %s%%', v_percent) else '' end),
    null,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'user_id',      v_user,
      'repriced',     v_repriced,
      'percent',      v_percent
    ),
    null
  );

  return jsonb_build_object(
    'ok',           true,
    'order_number', v_order.order_number,
    'repriced',     v_repriced,
    'percent',      v_percent
  );
end;
$$;

comment on function claim_order_with_account(text) is
  'Attaches the order behind a lookup_token to the calling account and, while the invoice is still open and unpaid, applies that account''s effective_customer_discount as a single source=account order_coupons row (086). Refuses an order already owned by another user; idempotent on re-call.';

-- Revoke before grant: a new routine is born EXECUTE-to-PUBLIC and the
-- bootstrap default privileges add anon + authenticated on top (see 079).
-- anon must NOT hold this — claiming requires an account by definition.
revoke execute on function claim_order_with_account(text) from public, anon, authenticated;
grant  execute on function claim_order_with_account(text) to authenticated;
