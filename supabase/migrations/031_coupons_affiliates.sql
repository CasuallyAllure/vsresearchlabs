-- 031_coupons_affiliates.sql
--
-- Coupons + affiliate (influencer) codes + commission ledger.
--
--   • coupons             — discount codes: percent off, fixed amount off, or a
--                           free item (sku+dose) added to the order. Optional
--                           usage caps, validity window, once-per-contact rule,
--                           and an affiliate link for commission attribution.
--   • affiliates          — influencers/partners who hold codes and earn a
--                           commission on orders placed with their code.
--   • coupon_redemptions  — one row per order that used a code. Doubles as the
--                           commission ledger: commission_status walks
--                           pending → paid (or void), so payouts are auditable.
--
-- Money flow (authoritative on the server):
--   cart → validate_coupon() (anon RPC, preview only)
--   place-order Edge Fn → validate_coupon() again with the buyer contact,
--     computes discount server-side, writes orders.discount_cents +
--     orders.coupon_code, then redeem_coupon() (service-role-only RPC)
--     atomically re-checks limits, bumps used_count, and writes the
--     redemption/commission row.
--
-- The three invoice surfaces (email, /track doc, admin print) already derive
--   discount = subtotal + shipping − invoice_amount_cents
-- so an explicit discount flows through them without display changes.

-- ── Order columns ─────────────────────────────────────────────────────────────

alter table orders
  add column if not exists discount_cents integer not null default 0
    check (discount_cents >= 0),
  add column if not exists coupon_code text;

-- ── Affiliates ────────────────────────────────────────────────────────────────

create table if not exists affiliates (
  id                         uuid        primary key default gen_random_uuid(),
  name                       text        not null,
  contact                    text,
  default_commission_percent integer     not null default 10
    check (default_commission_percent between 0 and 100),
  active                     boolean     not null default true,
  notes                      text,
  created_at                 timestamptz not null default now()
);

-- ── Coupons ───────────────────────────────────────────────────────────────────

create table if not exists coupons (
  id                 uuid        primary key default gen_random_uuid(),
  code               text        not null unique
    check (code = upper(btrim(code)) and length(code) between 3 and 40),
  kind               text        not null check (kind in ('percent', 'fixed', 'free_item')),
  percent            integer     check (percent between 1 and 100),
  amount_cents       integer     check (amount_cents > 0),
  free_sku           text,
  free_dose          text,
  free_label         text,
  min_subtotal_cents integer     not null default 0 check (min_subtotal_cents >= 0),
  max_uses           integer     check (max_uses > 0),
  used_count         integer     not null default 0,
  once_per_contact   boolean     not null default false,
  starts_at          timestamptz,
  expires_at         timestamptz,
  active             boolean     not null default true,
  affiliate_id       uuid        references affiliates(id) on delete set null,
  -- null → use the affiliate's default_commission_percent
  commission_percent integer     check (commission_percent between 0 and 100),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- each kind carries the fields it needs
  check (kind <> 'percent'   or percent is not null),
  check (kind <> 'fixed'     or amount_cents is not null),
  check (kind <> 'free_item' or (free_sku is not null and free_label is not null))
);

-- ── Redemption / commission ledger ────────────────────────────────────────────

create table if not exists coupon_redemptions (
  id                uuid        primary key default gen_random_uuid(),
  coupon_id         uuid        not null references coupons(id),
  order_id          uuid        references orders(id) on delete set null,
  affiliate_id      uuid        references affiliates(id),
  code              text        not null,
  buyer_contact     text,
  discount_cents    integer     not null default 0 check (discount_cents >= 0),
  -- commission base = the order's net subtotal (after discount)
  order_net_cents   integer     not null default 0 check (order_net_cents >= 0),
  commission_cents  integer     not null default 0 check (commission_cents >= 0),
  -- none: no affiliate on the code · pending: owed · paid: settled · void:
  -- cancelled (e.g. order refunded / never paid)
  commission_status text        not null default 'none'
    check (commission_status in ('none', 'pending', 'paid', 'void')),
  created_at        timestamptz not null default now()
);

create index if not exists coupon_redemptions_coupon_idx    on coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_affiliate_idx on coupon_redemptions (affiliate_id);
create index if not exists coupon_redemptions_order_idx     on coupon_redemptions (order_id);

-- ── RLS: admin-managed, service-role writes redemptions ──────────────────────

alter table affiliates         enable row level security;
alter table coupons            enable row level security;
alter table coupon_redemptions enable row level security;

drop policy if exists "Admins manage affiliates" on affiliates;
create policy "Admins manage affiliates"
  on affiliates for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Admins manage coupons" on coupons;
create policy "Admins manage coupons"
  on coupons for all
  using (is_admin()) with check (is_admin());

drop policy if exists "Admins read redemptions" on coupon_redemptions;
create policy "Admins read redemptions"
  on coupon_redemptions for select
  using (is_admin());

-- Admin may settle/void commissions (mark paid) but rows are created only by
-- the service role (place-order via redeem_coupon).
drop policy if exists "Admins update redemptions" on coupon_redemptions;
create policy "Admins update redemptions"
  on coupon_redemptions for update
  using (is_admin()) with check (is_admin());

grant select, insert, update, delete on affiliates to authenticated;
grant select, insert, update, delete on coupons    to authenticated;
grant select, update                 on coupon_redemptions to authenticated;
revoke all on affiliates, coupons, coupon_redemptions from anon;

-- ── validate_coupon — public preview + server-side pre-check ─────────────────
--
-- Callable by anon (the cart's "Apply" button) and re-called by place-order
-- with the buyer contact before billing. Never exposes affiliate/commission
-- data. Returns jsonb:
--   invalid → { valid:false, reason:'…' }
--   valid   → { valid:true, code, kind, percent, amount_cents,
--               free_sku, free_dose, free_label,
--               discount_cents,          -- computed for percent/fixed, 0 for free_item
--               min_subtotal_cents }

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
    'min_subtotal_cents', c.min_subtotal_cents
  );
end;
$$;

grant execute on function validate_coupon(text, integer, text) to anon, authenticated;

-- ── redeem_coupon — service-role only, atomic ────────────────────────────────
--
-- Called by place-order AFTER the order row exists. Locks the coupon row,
-- re-checks every limit (so two simultaneous checkouts can't both take the
-- last use), bumps used_count, computes the commission from the linked
-- affiliate, and writes the ledger row.

create or replace function redeem_coupon(
  p_code            text,
  p_order_id        uuid,
  p_contact         text,
  p_discount_cents  integer,
  p_order_net_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code       text := upper(btrim(coalesce(p_code, '')));
  c            coupons%rowtype;
  a            affiliates%rowtype;
  v_pct        integer := 0;
  v_commission integer := 0;
  v_status     text := 'none';
begin
  select * into c from coupons where code = v_code for update;
  if not found or not c.active then
    return jsonb_build_object('ok', false, 'reason', 'not_valid');
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if c.expires_at is not null and now() > c.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;
  if c.once_per_contact and p_contact is not null and exists (
    select 1 from coupon_redemptions
    where coupon_id = c.id
      and lower(btrim(coalesce(buyer_contact, ''))) = lower(btrim(p_contact))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  update coupons
     set used_count = used_count + 1, updated_at = now()
   where id = c.id;

  if c.affiliate_id is not null then
    select * into a from affiliates where id = c.affiliate_id;
    if found and a.active then
      v_pct        := coalesce(c.commission_percent, a.default_commission_percent, 0);
      v_commission := greatest(round(greatest(coalesce(p_order_net_cents, 0), 0) * v_pct / 100.0)::integer, 0);
      v_status     := case when v_commission > 0 then 'pending' else 'none' end;
    end if;
  end if;

  insert into coupon_redemptions
    (coupon_id, order_id, affiliate_id, code, buyer_contact,
     discount_cents, order_net_cents, commission_cents, commission_status)
  values
    (c.id, p_order_id, c.affiliate_id, c.code, nullif(btrim(coalesce(p_contact, '')), ''),
     greatest(coalesce(p_discount_cents, 0), 0),
     greatest(coalesce(p_order_net_cents, 0), 0),
     v_commission, v_status);

  return jsonb_build_object('ok', true, 'commission_cents', v_commission);
end;
$$;

-- Service role only — the checkout Edge Function is the sole caller.
revoke execute on function redeem_coupon(text, uuid, text, integer, integer) from public, anon, authenticated;

-- ── save_order_lines — preserve an explicit discount on admin line edits ─────
--
-- 024 set invoice_amount_cents = subtotal + shipping on every line save (no
-- discounts existed). Now the billed total must keep subtracting the order's
-- discount_cents, or editing lines on a couponed order would silently erase
-- the discount. Validation + audit logic carried forward from 024 unchanged.

create or replace function save_order_lines(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_line     jsonb;
  v_sku      text;
  v_name     text;
  v_qty      integer;
  v_unit     integer;
  v_subtotal integer := 0;
  v_count    integer := 0;
  v_total    integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  -- Validate each row before mutating anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku  := nullif(btrim(v_line->>'sku'), '');
    v_name := nullif(btrim(v_line->>'product_name'), '');
    v_qty  := nullif(v_line->>'quantity', '')::int;
    v_unit := nullif(v_line->>'unit_price_cents', '')::int;
    if v_sku is null or v_name is null then
      raise exception 'Every line needs sku and product_name';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'Quantity must be 1-9999 (got: %)', v_qty;
    end if;
    if v_unit is null or v_unit < 0 then
      raise exception 'unit_price_cents must be a non-negative integer';
    end if;
    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_count    := v_count + 1;
  end loop;

  -- Replace lines wholesale.
  delete from order_lines where order_id = p_order_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note, fast_ship)
    values (
      p_order_id,
      btrim(v_line->>'sku'),
      btrim(v_line->>'product_name'),
      (v_line->>'quantity')::int,
      (v_line->>'unit_price_cents')::int,
      nullif(btrim(v_line->>'item_note'), ''),
      (v_line->>'fast_ship')::boolean
    );
  end loop;

  -- Sync the header: subtotal from the lines; billed total tracks
  -- subtotal + shipping − discount (clamped at zero).
  update orders
    set subtotal_cents       = v_subtotal,
        invoice_amount_cents = greatest(
          v_subtotal + coalesce(shipping_cents, 0) - coalesce(discount_cents, 0), 0),
        updated_at           = now()
    where id = p_order_id
    returning invoice_amount_cents into v_total;
  if not found then
    raise exception 'Order not found';
  end if;

  perform log_audit(
    'order.lines_saved', 'order', p_order_id::text,
    format('Lines saved (%s item%s, subtotal %s, total %s)',
      v_count, case when v_count = 1 then '' else 's' end,
      to_char(v_subtotal::numeric / 100, 'FM999,999,999.00'),
      to_char(v_total::numeric / 100, 'FM999,999,999.00')),
    null, null,
    jsonb_build_object('line_count', v_count, 'subtotal_cents', v_subtotal, 'invoice_amount_cents', v_total)
  );

  return jsonb_build_object(
    'line_count',           v_count,
    'subtotal_cents',       v_subtotal,
    'invoice_amount_cents', v_total
  );
end;
$$;

grant execute on function save_order_lines(uuid, jsonb) to authenticated;

-- ── Launch seed codes ─────────────────────────────────────────────────────────

-- FREEBH2O — one free Bacteriostatic Water 10 mL with any purchase, once per
-- buyer contact.
insert into coupons (code, kind, free_sku, free_dose, free_label, min_subtotal_cents, once_per_contact)
values ('FREEBH2O', 'free_item', 'VSR-RS-BAC-030', '10 mL',
        'Bacteriostatic Water — 10 mL', 100, true)
on conflict (code) do nothing;

-- Q3FAMFREN26 — 20% off the order subtotal, through the end of Q3 2026.
insert into coupons (code, kind, percent, expires_at)
values ('Q3FAMFREN26', 'percent', 20, '2026-09-30 23:59:59-07')
on conflict (code) do nothing;
