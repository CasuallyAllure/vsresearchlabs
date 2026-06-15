-- =============================================================================
-- VS Research Labs — Bulk inventory import
-- =============================================================================
-- One admin-gated RPC that applies a whole spreadsheet of per-SKU overrides in
-- a single call: stock (absolute), price, visibility, reorder point, and the
-- cited clip (url + title + description + thumbnail) — the same fields we set by
-- hand for MOTS-C, now fillable in bulk.
--
-- Semantics: each row MUST carry a `sku`. Any field KEY that is present and
-- non-empty is applied; an ABSENT or empty key is left unchanged (so a half-
-- filled sheet never wipes existing data). Stock is set to an ABSOLUTE value
-- and recorded as a normal stock_movement so history stays consistent.
--
-- Returns: { applied, skipped, errors: [{ sku, message }] }.
--
-- Additive. Re-runnable.
-- =============================================================================

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
    v_sku := nullif(btrim(v_row->>'sku'), '');
    if v_sku is null then
      v_skipped := v_skipped + 1;
      v_errors  := v_errors || jsonb_build_array(jsonb_build_object('sku', null, 'message', 'Missing sku'));
      continue;
    end if;

    -- Ensure the stock row exists (seed at 0 like the catalog seeder).
    insert into product_stock (sku, on_hand) values (v_sku, 0)
      on conflict (sku) do nothing;

    v_changed := array[]::text[];

    -- on_hand — absolute set, recorded as a movement so the stock log is honest.
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
      select on_hand into v_before from product_stock where sku = v_sku;
      v_delta := v_target - coalesce(v_before, 0);
      if v_delta <> 0 then
        update product_stock set on_hand = v_target, updated_at = now() where sku = v_sku;
        insert into stock_movements (sku, delta, reason, notes, admin_id, on_hand_after)
          values (v_sku, v_delta, 'manual_adjustment', 'Bulk import', v_admin, v_target);
        v_changed := v_changed || 'on_hand';
      end if;
    end if;

    -- price (USD in the sheet → cents on the wire as price_cents).
    if nullif(btrim(v_row->>'price_cents'), '') is not null then
      update product_stock
        set price_cents_override = floor((v_row->>'price_cents')::numeric)::int,
            updated_at = now()
        where sku = v_sku;
      v_changed := v_changed || 'price';
    end if;

    -- hidden (truthy strings → true)
    if nullif(btrim(v_row->>'hidden'), '') is not null then
      update product_stock
        set hidden = (lower(btrim(v_row->>'hidden')) in ('true','t','1','yes','y','hidden')),
            updated_at = now()
        where sku = v_sku;
      v_changed := v_changed || 'hidden';
    end if;

    -- reorder point
    if nullif(btrim(v_row->>'reorder_at'), '') is not null then
      update product_stock
        set reorder_at = floor((v_row->>'reorder_at')::numeric)::int,
            updated_at = now()
        where sku = v_sku;
      v_changed := v_changed || 'reorder_at';
    end if;

    -- cited clip — only touched when a url is present; the other three ride along.
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
      v_skipped := v_skipped + 1; -- row present but nothing to change
    else
      v_applied := v_applied + 1;
      perform log_audit(
        'inventory.imported', 'stock', v_sku,
        format('Bulk import — %s', array_to_string(v_changed, ', ')),
        null,
        to_jsonb(v_changed),
        jsonb_build_object('source', 'csv_import')
      );
    end if;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

grant execute on function import_inventory(jsonb) to authenticated;
