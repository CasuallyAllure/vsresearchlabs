-- 061_inquiry_lines_priced.sql
-- ---------------------------------------------------------------------------
-- create_order_from_inquiry has been writing order_lines with a NULL
-- unit_price_cents since 027 (:73) — inquiry_items carries no price column of
-- any kind, so the insert simply omitted the column. Nothing downstream treats
-- that as an error: sum(unit_price_cents * quantity) folds NULL to $0 per line,
-- so an admin converting an inquiry gets a clean-looking, fully itemized
-- invoice whose total is silently missing the money. The failure is invisible
-- precisely because it renders.
--
-- Fail closed. A line whose price cannot be resolved from a priced variant now
-- raises and aborts the whole conversion, naming the inquiry and the offending
-- line so an admin can price the variant and retry. The previous behavior
-- (write it as NULL and move on) is not recoverable after the fact: once the
-- invoice is sent, the wrong number is the number the buyer saw.
--
-- Price resolution mirrors place-order's priceCheck.ts precedence so the two
-- paths cannot disagree about what a SKU costs:
--   1. product_variant_stock (sku, dose) price_cents — longest dose match
--   2. product_stock.price_cents_override            — per-sku fallback
--   3. raise                                          — never NULL, never $0
--
-- There is no dose column to join on: the dose is baked into product_name by
-- cartActions.variantProduct ("BPC-157 — 5mg"), so a variant row matches when
-- its squashed dose appears as a substring of the squashed name. Longest match
-- wins, so the "15mg" row is never claimed by the "5mg" row — the live
-- IGF-1 LR3 0.1mg/1mg pair depends on this.
--
-- Two deliberate divergences from priceCheck.ts, both tightening:
--   · Matches product_name ONLY, never item_note. priceCheck currently
--     includes the note in its haystack; the note is buyer-supplied free text
--     from the inquiry form, and letting it steer price resolution makes it an
--     identity signal. (SER-A6 removes note from the checkout matcher for the
--     same reason; this migration does not wait for it.)
--   · Requires price_cents > 0, not merely NOT NULL. A zero-priced variant is
--     an unpriced variant wearing a number. Genuine free items are granted
--     through the coupon/promo path at checkout (save_order_lines, 036:69),
--     never by converting an inquiry.
--
-- Also adds the CHECK that should have made the original bug unrepresentable.
--
-- Requires 027, 057. Additive. Re-runnable.
-- Rollback: re-apply 027's create_order_from_inquiry;
--           alter table order_lines drop constraint order_lines_unit_price_cents_present;
-- ---------------------------------------------------------------------------

-- ── 1. Constraint: no NULL-priced line can be created, ever again ───────────
-- NOT VALID is the point, not a shortcut: it enforces on every INSERT and
-- UPDATE from here on while leaving already-written legacy rows readable. A
-- validating constraint would refuse to apply at all if any legacy NULL line
-- exists — and the rows this migration exists because of are exactly those.
--
-- >= 0 rather than > 0: place-order legitimately writes $0 lines for B2G1 and
-- free_item coupon grants (036:69), and clampCents (place-order/index.ts:222)
-- returns a number for every input — it coerces a missing price to 0, never
-- NULL. So this constraint cannot break checkout: that path already never
-- inserts NULL. ($0 lines reaching checkout at all are a separate defect,
-- owned by PAR-H2a/SER-A9 — deliberately not addressed here.)
--
-- To finish the job once legacy rows are audited, run:
--     select id, order_id, sku, product_name from order_lines
--      where unit_price_cents is null;
--   -- price or delete each, then:
--     alter table order_lines validate constraint order_lines_unit_price_cents_present;
--   -- and only then consider: alter table order_lines
--   --   alter column unit_price_cents set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_lines'::regclass
      and conname  = 'order_lines_unit_price_cents_present'
  ) then
    alter table order_lines
      add constraint order_lines_unit_price_cents_present
      check (unit_price_cents is not null and unit_price_cents >= 0)
      not valid;
  end if;
end $$;

comment on constraint order_lines_unit_price_cents_present on order_lines is
  'A line must carry a price. NOT VALID: enforced on new writes; legacy NULL rows (from create_order_from_inquiry before 061) are grandfathered until audited. $0 is permitted — free promo/coupon lines are real.';

-- ── 2. squash_dose_text — the dose-matching normalizer, defined once ────────
-- Mirrors priceCheck.ts's squash (:59-60): lowercase, drop all whitespace, and
-- strip the Unicode format/control characters that could otherwise hide a dose
-- token from the substring match below.
--
-- Built from regexp_replace + translate rather than a single regex with \uXXXX
-- escapes inside a bracket range: [\s[:cntrl:]] is unambiguous ARE that covers
-- the Cc class, and translate() over an explicit chr() list covers the Cf
-- characters that matter without depending on how ARE parses escape ranges.
-- Less clever, and correct for reasons that can be read off the page.
--
-- Cf coverage: ZWSP/ZWNJ/ZWJ/LRM/RLM (200B-200F), word joiner (2060),
-- bidi embedding + overrides (202A-202E), BOM/ZWNBSP (FEFF).
create or replace function squash_dose_text(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    translate(
      regexp_replace(coalesce(p_text, ''), '[\s[:cntrl:]]+', '', 'g'),
      chr(8203) || chr(8204) || chr(8205) || chr(8206) || chr(8207) ||
      chr(8288) || chr(8234) || chr(8235) || chr(8236) || chr(8237) ||
      chr(8238) || chr(65279),
      ''
    )
  );
$$;

-- No grant: the only caller is create_order_from_inquiry, which is SECURITY
-- DEFINER and so executes this as the owner regardless. Granting execute to
-- authenticated would add reachable surface for no gain.
revoke execute on function squash_dose_text(text) from public, anon;

comment on function squash_dose_text(text) is
  'Dose-match normalizer: lowercase, strip whitespace/control/zero-width chars. SQL mirror of place-order/priceCheck.ts squash. Used by create_order_from_inquiry (061).';

-- ── 3. create_order_from_inquiry — resolve every price or abort ─────────────
-- Identical to 027's definition except for the line-insert, which was a bare
-- column-copy from inquiry_items and is now a priced, fail-closed loop.
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
  v_item     inquiry_items%rowtype;
  v_cents    integer;
  v_hay      text;
  v_lines    integer := 0;
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

  -- Per-line price resolution. Any failure raises, which rolls back the order
  -- row inserted above along with every line already written — the conversion
  -- is all-or-nothing by design. A half-converted inquiry is worse than none:
  -- it looks like a real order.
  for v_item in
    select * from inquiry_items where inquiry_id = p_inquiry_id order by id
  loop
    v_hay := squash_dose_text(v_item.product_name);

    -- 1. Longest dose match among this SKU's priced variant rows.
    select s.price_cents into v_cents
      from product_variant_stock s
     where s.sku = v_item.sku
       and s.price_cents is not null
       and s.price_cents > 0
       and length(squash_dose_text(s.dose)) > 0
       and position(squash_dose_text(s.dose) in v_hay) > 0
     -- s.dose breaks length ties. Without it two equal-length doses that both
     -- appear in the name resolve to whichever row the plan happened to reach
     -- first, so the same inquiry could price differently across runs. Ties are
     -- a data defect either way, but an arbitrary price is the wrong way to
     -- report one.
     order by length(squash_dose_text(s.dose)) desc, s.dose
     limit 1;

    -- 2. Per-SKU override.
    if v_cents is null then
      select p.price_cents_override into v_cents
        from product_stock p
       where p.sku = v_item.sku
         and p.price_cents_override is not null
         and p.price_cents_override > 0;
    end if;

    -- 3. Fail closed, naming what to fix.
    if v_cents is null then
      raise exception
        'Cannot convert inquiry % (%): no price for line "%" (sku %, qty %). '
        'Price that variant in Inventory — set a per-dose price for the dose '
        'named in the line, or a per-SKU override — then retry. No order was created.',
        v_inq.reference_id, p_inquiry_id, v_item.product_name, v_item.sku, v_item.quantity;
    end if;

    insert into order_lines (order_id, sku, product_name, quantity, unit_price_cents, item_note)
    values (v_order_id, v_item.sku, v_item.product_name, v_item.quantity, v_cents, v_item.item_note);

    v_lines := v_lines + 1;
  end loop;

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
      'contact',      v_inq.contact,
      'lines',        v_lines
    ),
    null
  );

  return v_order_id;
end;
$$;

revoke execute on function create_order_from_inquiry(uuid) from public, anon;
grant  execute on function create_order_from_inquiry(uuid) to authenticated;
