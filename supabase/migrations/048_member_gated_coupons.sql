-- 048_member_gated_coupons.sql
-- ---------------------------------------------------------------------------
-- Member-gated coupon codes. A coupon flagged `requires_account` only works for
-- a signed-in customer whose checkout is stamped to their account. This is how
-- "you'll have access to certain discounts (e.g. 15% off for Q3)" is delivered:
-- create a normal coupon (031 engine), flag it members-only, set an expiry.
--
--   • coupons.requires_account (default false) — additive, existing codes
--     stay open to everyone.
--   • validate_coupon returns `requires_account` so the cart preview can gate
--     UX (show "sign in to use this code") — the AUTHORITATIVE gate is in
--     place-order, which rejects a members-only code unless the order is
--     stamped to a verified account (a client preview can't be trusted).
--
-- Additive + idempotent. No grant changes; validate_coupon keeps its
-- anon+authenticated grant and unchanged signature.
--
-- Rollback: re-apply 031's validate_coupon body; drop column
-- coupons.requires_account (data-safe to leave).
-- ---------------------------------------------------------------------------

alter table coupons
  add column if not exists requires_account boolean not null default false;

-- validate_coupon — 031 body VERBATIM, plus `requires_account` in the success
-- payload. No logic change: eligibility by account is enforced server-side in
-- place-order, not here (this RPC is called both by the anon cart preview and
-- by place-order's service-role client, where auth.uid() is null — so it must
-- not itself block on auth state).
create or replace function validate_coupon(
  p_code           text,
  p_subtotal_cents integer default 0,
  p_contact        text    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_subtotal integer := greatest(coalesce(p_subtotal_cents, 0), 0);
  c          coupons%rowtype;
  v_discount integer := 0;
begin
  if length(v_code) < 3 then
    return jsonb_build_object('valid', false, 'reason', 'Enter a code.');
  end if;

  select * into c from coupons where code = v_code;
  if not found or not c.active then
    return jsonb_build_object('valid', false, 'reason', 'This code is not valid.');
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('valid', false, 'reason', 'This code is not active yet.');
  end if;
  if c.expires_at is not null and now() > c.expires_at then
    return jsonb_build_object('valid', false, 'reason', 'This code has expired.');
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return jsonb_build_object('valid', false, 'reason', 'This code has reached its usage limit.');
  end if;
  if v_subtotal < c.min_subtotal_cents then
    return jsonb_build_object('valid', false, 'reason',
      case when c.kind = 'free_item'
        then 'Add a product to your order to use this code.'
        else 'Your order does not meet the minimum for this code.'
      end);
  end if;
  if c.once_per_contact and p_contact is not null and exists (
    select 1 from coupon_redemptions
    where coupon_id = c.id
      and lower(btrim(coalesce(buyer_contact, ''))) = lower(btrim(p_contact))
  ) then
    return jsonb_build_object('valid', false, 'reason', 'This code was already used with this contact.');
  end if;

  if c.kind = 'percent' then
    v_discount := round(v_subtotal * c.percent / 100.0)::integer;
  elsif c.kind = 'fixed' then
    v_discount := least(c.amount_cents, v_subtotal);
  else
    v_discount := 0; -- free_item: value is the added line, not a subtraction
  end if;

  return jsonb_build_object(
    'valid', true,
    'code', c.code,
    'kind', c.kind,
    'percent', c.percent,
    'amount_cents', c.amount_cents,
    'free_sku', c.free_sku,
    'free_dose', c.free_dose,
    'free_label', c.free_label,
    'discount_cents', v_discount,
    'min_subtotal_cents', c.min_subtotal_cents,
    'requires_account', c.requires_account
  );
end;
$$;

grant execute on function validate_coupon(text, integer, text) to anon, authenticated;
