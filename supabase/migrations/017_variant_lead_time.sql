-- =============================================================================
-- VS Research Labs — Per-dose lead time (order-on-demand fulfillment)
-- =============================================================================
-- Some doses aren't held in local stock but are still offered on a lead time
-- (e.g. 15 days): ordered in when the customer orders. Adds lead_days to the
-- per-dose override layer. Availability for a dose becomes:
--
--   on_hand > 0                 → in stock (ships fast)
--   on_hand = 0 AND lead_days>0  → order-on-demand ("Ships in N days"); the
--                                  storefront also shows "Buy 2, get 1 free"
--   on_hand = 0 AND no lead_days  → out of stock
--
-- The buy-2-get-1-free incentive is presentational (badge) and applied by the
-- admin at invoice time — no cart math. Additive. Re-runnable.
-- =============================================================================

alter table product_variant_stock
  add column if not exists lead_days integer
    check (lead_days is null or lead_days >= 0);

-- Admin-only cost (what we paid per kit, incl. allocated shipping). NEVER
-- exposed publicly — it stays out of the public_variant_overrides view below,
-- and the base table is RLS-locked to admins. For margin math only.
alter table product_variant_stock
  add column if not exists cost_cents integer
    check (cost_cents is null or cost_cents >= 0);

-- Public read view — carries lead_days but NOT cost_cents.
create or replace view public_variant_overrides as
  select sku, dose, on_hand, price_cents, lead_days
  from product_variant_stock;

grant select on public_variant_overrides to anon, authenticated;

-- Bulk import — accept lead_days on dose rows.
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

    -- lead_days — order-on-demand window (per dose). Empty string clears it.
    if v_dose is not null and (v_row ? 'lead_days') then
      if nullif(btrim(v_row->>'lead_days'), '') is null then
        update product_variant_stock set lead_days = null, updated_at = now()
          where sku = v_sku and dose = v_dose;
      else
        update product_variant_stock
          set lead_days = floor((v_row->>'lead_days')::numeric)::int, updated_at = now()
          where sku = v_sku and dose = v_dose;
      end if;
      v_changed := v_changed || 'lead_days';
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

    -- hidden (product-level)
    if nullif(btrim(v_row->>'hidden'), '') is not null then
      update product_stock
        set hidden = (lower(btrim(v_row->>'hidden')) in ('true','t','1','yes','y','hidden')),
            updated_at = now()
        where sku = v_sku;
      v_changed := v_changed || 'hidden';
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
