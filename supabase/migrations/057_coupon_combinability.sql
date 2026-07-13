-- 057_coupon_combinability.sql
-- ---------------------------------------------------------------------------
-- Admin-configurable coupon stacking. Four type-level combinability toggles
-- per coupon, enforced at WRITE TIME (when an order_coupons row is admitted)
-- through validate_coupon — the single function every writer already calls
-- (client preview, place-order checkout, admin_apply_coupon). recompute_order_
-- totals (052) only re-prices already-admitted rows, so it needs NO change:
-- if writers never admit a conflicting code, the stored set is always
-- conflict-free. This is what keeps the three compute sites from drifting.
--
-- Defaults preserve today's behavior exactly (everything stacks). Requires
-- 031/048 (coupons + validate_coupon), 036 (admin_apply_coupon), 050/054
-- (reward/promo order_coupons sources). Additive.
-- Rollback: drop the 4 columns; drop coupon_combinability_reason; restore
-- validate_coupon to the 048 3-arg signature; restore admin_apply_coupon (036).
-- ---------------------------------------------------------------------------

-- ── 1. Combinability flags ──────────────────────────────────────────────────
alter table coupons
  add column if not exists exclusive             boolean not null default false,
  add column if not exists combines_with_codes   boolean not null default true,
  add column if not exists combines_with_promos  boolean not null default true,
  add column if not exists combines_with_account boolean not null default true;

comment on column coupons.exclusive is
  'Use alone — cannot combine with any other code or automatic promo/reward/account discount.';
comment on column coupons.combines_with_promos is
  'May stack with automatic promos: Buy-2-Get-1-Free and the 40% reward voucher.';

-- ── 2. Resolution helper ─────────────────────────────────────────────────────
-- Combinability is a property of TYPED CODES only. Auto-promos (B2G1/reward)
-- and the account discount are automatic entitlements with no config — they
-- never object; they only appear as the counterpart a code may refuse. Among
-- two codes the EARLIER-applied one wins (the candidate is the later code).
-- Returns null when the candidate may be admitted, else a shopper-facing reason.
create or replace function coupon_combinability_reason(
  p_candidate    text,
  p_applied      text[]  default '{}',
  p_has_reward   boolean default false,
  p_has_promo    boolean default false,
  p_has_account  boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code      text := upper(btrim(coalesce(p_candidate, '')));
  cand        coupons%rowtype;
  v_env_auto  boolean := coalesce(p_has_reward, false) or coalesce(p_has_promo, false);
  v_applied   text[]  := coalesce(p_applied, '{}');
  v_other     record;
begin
  select * into cand from coupons where code = v_code;
  if not found then
    return null; -- validity is checked elsewhere; nothing to combine-gate
  end if;

  -- Exclusivity (dominant).
  if cand.exclusive then
    if array_length(v_applied, 1) is not null or v_env_auto or coalesce(p_has_account, false) then
      return format('%s must be used on its own — remove other discounts first.', v_code);
    end if;
  end if;
  for v_other in
    select c.code, c.exclusive, c.combines_with_codes
      from coupons c
      where c.code = any(v_applied) and c.code <> v_code
  loop
    if v_other.exclusive then
      return format('%s must be used on its own and can''t be combined with %s.', v_other.code, v_code);
    end if;
    if not v_other.combines_with_codes then
      return format('%s can''t be combined with other codes.', v_other.code);
    end if;
  end loop;

  -- Candidate ↔ other codes.
  if not cand.combines_with_codes and array_length(v_applied, 1) is not null then
    -- (only counts OTHER codes; an identical re-add is a no-op upstream)
    if exists (select 1 from unnest(v_applied) a where a <> v_code) then
      return format('%s can''t be combined with other codes.', v_code);
    end if;
  end if;

  -- Candidate ↔ automatic promos (B2G1 + 40% reward).
  if not cand.combines_with_promos and v_env_auto then
    return format('%s can''t be combined with the current promotion.', v_code);
  end if;

  -- Candidate ↔ member account discount.
  if not cand.combines_with_account and coalesce(p_has_account, false) then
    return format('%s can''t be combined with your account discount.', v_code);
  end if;

  return null;
end;
$$;

revoke execute on function coupon_combinability_reason(text, text[], boolean, boolean, boolean) from public;
grant execute on function coupon_combinability_reason(text, text[], boolean, boolean, boolean) to anon, authenticated;

-- ── 3. validate_coupon — +4 defaulted params, calls the helper ──────────────
-- Postgres can't add params via CREATE OR REPLACE → drop then create, re-grant.
drop function if exists validate_coupon(text, integer, text);
create function validate_coupon(
  p_code           text,
  p_subtotal_cents integer default 0,
  p_contact        text    default null,
  p_applied_codes  text[]  default '{}',
  p_has_reward     boolean default false,
  p_has_promo      boolean default false,
  p_has_account    boolean default false
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
  v_reason   text;
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

  -- Combinability (write-time stacking rule). Callers that don't supply the
  -- env context default to permissive; place-order re-checks authoritatively.
  v_reason := coupon_combinability_reason(v_code, p_applied_codes, p_has_reward, p_has_promo, p_has_account);
  if v_reason is not null then
    return jsonb_build_object('valid', false, 'reason', v_reason);
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
    'requires_account', c.requires_account,
    'exclusive', c.exclusive,
    'combines_with_codes', c.combines_with_codes,
    'combines_with_promos', c.combines_with_promos,
    'combines_with_account', c.combines_with_account
  );
end;
$$;

grant execute on function validate_coupon(text, integer, text, text[], boolean, boolean, boolean) to anon, authenticated;

-- ── 4. admin_apply_coupon — pass combinability context from stored rows ─────
create or replace function admin_apply_coupon(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code        text := upper(btrim(coalesce(p_code, '')));
  v_sub         integer;
  v_check       jsonb;
  v_applied     text[];
  v_has_reward  boolean;
  v_has_promo   boolean;
  v_has_account boolean;
begin
  if not is_admin() then raise exception 'Unauthorized: admin role required'; end if;
  if not exists (select 1 from orders where id = p_order_id) then raise exception 'Order not found'; end if;

  select coalesce(sum(unit_price_cents * quantity), 0) into v_sub
    from order_lines where order_id = p_order_id;

  -- Combinability context from what's already on the order (exclude this code
  -- so re-applying an existing code stays a no-op update).
  select coalesce(array_agg(code) filter (where code <> v_code), '{}')
    into v_applied
    from order_coupons where order_id = p_order_id and source = 'code';
  select exists(select 1 from order_coupons where order_id = p_order_id and source = 'reward')  into v_has_reward;
  select exists(select 1 from order_coupons where order_id = p_order_id and source = 'promo')   into v_has_promo;
  select exists(select 1 from order_coupons where order_id = p_order_id and source = 'account') into v_has_account;

  v_check := validate_coupon(v_code, v_sub, null, v_applied, v_has_reward, v_has_promo, v_has_account);
  if not coalesce((v_check->>'valid')::boolean, false) then
    return jsonb_build_object('applied', false, 'reason', coalesce(v_check->>'reason', 'This code is not valid.'));
  end if;

  insert into order_coupons (order_id, code, kind, percent, amount_cents, free_sku, free_dose, free_label)
  values (
    p_order_id, v_code, v_check->>'kind',
    nullif(v_check->>'percent', '')::numeric,
    nullif(v_check->>'amount_cents', '')::integer,
    v_check->>'free_sku', v_check->>'free_dose', v_check->>'free_label'
  )
  on conflict (order_id, code) do update
    set kind = excluded.kind, percent = excluded.percent, amount_cents = excluded.amount_cents,
        free_sku = excluded.free_sku, free_dose = excluded.free_dose, free_label = excluded.free_label;

  perform log_audit('order.coupon_applied', 'order', p_order_id::text, format('Coupon %s applied', v_code), null);
  return recompute_order_totals(p_order_id) || jsonb_build_object('applied', true, 'code', v_code, 'kind', v_check->>'kind');
end;
$$;
