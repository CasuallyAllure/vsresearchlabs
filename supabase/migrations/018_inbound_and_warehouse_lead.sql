-- 018_inbound_and_warehouse_lead.sql
--
-- Two real-inventory concepts the master sheet's been encoding informally:
--
--   1. Inbound stock — units we've already paid for that are in transit but
--      not yet on a shelf. Should count as purchasable inventory (we can
--      promise & fulfill the order, the supplier window is just slower than
--      24h). Encoded in the master sheet as `wN` in the `hidden` column,
--      e.g. `w20` = 20 units on the way. Stored here as
--      product_variant_stock.inbound_units (integer, default 0).
--
--   2. Warehouse drop-ship — items we don't physically hold but our supplier
--      will drop-ship directly. Encoded in the master sheet as the letter
--      `x` in the `lead_days` column (vs a numeric N which means
--      order-on-demand at a known SLA). On import `x` translates to a
--      default 7-day lead so the existing lead_days plumbing keeps working;
--      the public catalog hides that number anyway (see migration notes
--      below — frontend now reads "in stock" for any source).
--
-- Together with the existing on_hand column they form the three buckets:
--    on_hand    → fast ship (24h / same-day eligible)
--    inbound    → in-transit, counted as inventory
--    lead_days  → drop-ship from warehouse SLA (admin sees the truth)
--
-- Visibility rule the public catalog will use after this migration:
--    publicly purchasable IF price_cents IS NOT NULL
--                        AND (on_hand > 0 OR inbound_units > 0
--                             OR lead_days IS NOT NULL)
-- A SKU with no price stays in the DB but hidden from the public catalog.

-- ── 1. Schema: inbound_units column ──────────────────────────────────────────

alter table product_variant_stock
  add column if not exists inbound_units integer not null default 0
    check (inbound_units >= 0);

-- ── 2. Public view — expose inbound_units alongside on_hand + lead_days ──────

create or replace view public_variant_overrides as
  select sku, dose, on_hand, inbound_units, price_cents, lead_days
  from product_variant_stock;

grant select on public_variant_overrides to anon, authenticated;

-- ── 3. import_inventory RPC — parse `x` and `wN` natively ────────────────────
--
-- The default warehouse SLA used when lead_days is `x`. Picking the midpoint
-- of the 5–10 business-day window the supplier quotes. Public catalog still
-- shows "in stock" — this number is internal/admin only.
--
-- The hidden column now has two valid value families:
--   • Boolean-ish ('true'/'t'/'1'/'yes'/'y'/'hidden') → set product_stock.hidden
--   • `w<N>` pattern → store N as product_variant_stock.inbound_units, do NOT
--     touch the hidden flag (these rows are actually *purchasable*, the
--     keyword is just a holding bay for the inbound count)
-- Empty / null leaves both fields alone.

create or replace function import_inventory(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin   uuid;
  v_row     jsonb;
  v_sku     text;
  v_dose    text;
  v_applied int := 0;
  v_skipped int := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_before  integer;
  v_target  integer;
  v_delta   integer;
  v_changed text[];
  v_lead_raw   text;
  v_lead_norm  text;
  v_hidden_raw text;
  v_hidden_norm text;
  v_w_match    text[];
  v_inbound    integer;
  WAREHOUSE_DEFAULT_LEAD constant integer := 7;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a JSON array of rows';
  end if;

  v_admin := auth.uid();

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_sku  := nullif(btrim(v_row->>'sku'), '');
    v_dose := nullif(btrim(v_row->>'dose'), '');
    if v_sku is null then
      v_skipped := v_skipped + 1;
      v_errors  := v_errors || jsonb_build_array(jsonb_build_object('sku', null, 'message', 'Missing sku'));
      continue;
    end if;

    insert into product_stock (sku, on_hand) values (v_sku, 0)
      on conflict (sku) do nothing;
    if v_dose is not null then
      insert into product_variant_stock (sku, dose) values (v_sku, v_dose)
        on conflict (sku, dose) do nothing;
    end if;

    v_changed := array[]::text[];

    -- on_hand — absolute set.
    if nullif(btrim(v_row->>'on_hand'), '') is not null then
      begin
        v_target := floor((v_row->>'on_hand')::numeric)::int;
      exception when others then
        v_skipped := v_skipped + 1;
        v_errors  := v_errors || jsonb_build_array(jsonb_build_object('sku', v_sku, 'message', 'on_hand is not a number'));
        continue;
      end;
      if v_target < 0 then
        v_skipped := v_skipped + 1;
        v_errors  := v_errors || jsonb_build_array(jsonb_build_object('sku', v_sku, 'message', 'on_hand cannot be negative'));
        continue;
      end if;
      if v_dose is not null then
        update product_variant_stock
          set on_hand = v_target, updated_at = now()
          where sku = v_sku and dose = v_dose;
        v_changed := v_changed || 'on_hand';
      else
        select on_hand into v_before from product_stock where sku = v_sku;
        v_delta := v_target - coalesce(v_before, 0);
        if v_delta <> 0 then
          update product_stock set on_hand = v_target, updated_at = now() where sku = v_sku;
          insert into stock_movements (sku, delta, reason, notes, admin_id, on_hand_after)
            values (v_sku, v_delta, 'manual_adjustment', 'Bulk import', v_admin, v_target);
          v_changed := v_changed || 'on_hand';
        end if;
      end if;
    end if;

    -- price
    if nullif(btrim(v_row->>'price_cents'), '') is not null then
      if v_dose is not null then
        update product_variant_stock
          set price_cents = floor((v_row->>'price_cents')::numeric)::int, updated_at = now()
          where sku = v_sku and dose = v_dose;
      else
        update product_stock
          set price_cents_override = floor((v_row->>'price_cents')::numeric)::int, updated_at = now()
          where sku = v_sku;
      end if;
      v_changed := v_changed || 'price';
    end if;

    -- cost (admin-only COGS per kit, USD→cents as cost_cents). Per dose.
    if v_dose is not null and nullif(btrim(v_row->>'cost_cents'), '') is not null then
      update product_variant_stock
        set cost_cents = floor((v_row->>'cost_cents')::numeric)::int, updated_at = now()
        where sku = v_sku and dose = v_dose;
      v_changed := v_changed || 'cost';
    end if;

    -- lead_days — per dose. Now accepts:
    --   ''  / NULL  → clear (no order-on-demand pathway)
    --   numeric N   → ships in N days
    --   'x' / 'xx'  → warehouse drop-ship → default WAREHOUSE_DEFAULT_LEAD
    if v_dose is not null and (v_row ? 'lead_days') then
      v_lead_raw  := btrim(v_row->>'lead_days');
      v_lead_norm := lower(v_lead_raw);
      if v_lead_raw is null or v_lead_raw = '' then
        update product_variant_stock set lead_days = null, updated_at = now()
          where sku = v_sku and dose = v_dose;
        v_changed := v_changed || 'lead_days';
      elsif v_lead_norm in ('x', 'xx') or v_lead_norm ~ '^x+$' then
        update product_variant_stock
          set lead_days = WAREHOUSE_DEFAULT_LEAD, updated_at = now()
          where sku = v_sku and dose = v_dose;
        v_changed := v_changed || 'lead_days';
      elsif v_lead_raw ~ '^[0-9]+(\.[0-9]+)?$' then
        update product_variant_stock
          set lead_days = floor(v_lead_raw::numeric)::int, updated_at = now()
          where sku = v_sku and dose = v_dose;
        v_changed := v_changed || 'lead_days';
      else
        -- Unrecognized token — skip silently to avoid blowing up the import
        -- on values like '?'. Reported per-row so user can audit.
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'sku', v_sku, 'message',
          format('lead_days value %L not understood (expected number, blank, or x)', v_lead_raw)
        ));
      end if;
    end if;

    -- reorder point
    if nullif(btrim(v_row->>'reorder_at'), '') is not null then
      if v_dose is not null then
        update product_variant_stock
          set reorder_at = floor((v_row->>'reorder_at')::numeric)::int, updated_at = now()
          where sku = v_sku and dose = v_dose;
      else
        update product_stock
          set reorder_at = floor((v_row->>'reorder_at')::numeric)::int, updated_at = now()
          where sku = v_sku;
      end if;
      v_changed := v_changed || 'reorder_at';
    end if;

    -- hidden — overloaded:
    --   boolean-ish  → product_stock.hidden flag
    --   'w<N>'       → product_variant_stock.inbound_units = N (per dose)
    --                  (purchasable; don't touch the hidden flag)
    if nullif(btrim(v_row->>'hidden'), '') is not null then
      v_hidden_raw  := btrim(v_row->>'hidden');
      v_hidden_norm := lower(v_hidden_raw);
      v_w_match := regexp_match(v_hidden_norm, '^w([0-9]+)$');
      if v_w_match is not null then
        v_inbound := v_w_match[1]::int;
        if v_dose is not null then
          update product_variant_stock
            set inbound_units = v_inbound, updated_at = now()
            where sku = v_sku and dose = v_dose;
          v_changed := v_changed || 'inbound';
        end if;
      else
        update product_stock
          set hidden = (v_hidden_norm in ('true','t','1','yes','y','hidden')),
              updated_at = now()
          where sku = v_sku;
        v_changed := v_changed || 'hidden';
      end if;
    end if;

    -- cited clip (product-level)
    if nullif(btrim(v_row->>'video_url'), '') is not null then
      update product_stock
        set video_url         = nullif(btrim(v_row->>'video_url'), ''),
            video_title       = nullif(btrim(v_row->>'video_title'), ''),
            video_description = nullif(btrim(v_row->>'video_description'), ''),
            video_thumbnail   = nullif(btrim(v_row->>'video_thumbnail'), ''),
            updated_at        = now()
        where sku = v_sku;
      v_changed := v_changed || 'clip';
    end if;

    if array_length(v_changed, 1) is null then
      v_skipped := v_skipped + 1;
    else
      v_applied := v_applied + 1;
      perform log_audit(
        'inventory.imported', 'stock', coalesce(v_sku || ' · ' || v_dose, v_sku),
        format('Bulk import — %s', array_to_string(v_changed, ', ')),
        null,
        to_jsonb(v_changed),
        jsonb_build_object('source', 'csv_import', 'dose', v_dose)
      );
    end if;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

grant execute on function import_inventory(jsonb) to authenticated;
