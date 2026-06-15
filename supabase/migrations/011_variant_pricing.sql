-- =============================================================================
-- VS Research Labs — Per-dose pricing & stock (variant overrides)
-- =============================================================================
-- Compounds sell in several doses (e.g. Semaglutide 2mg / 5mg / 10mg) and each
-- dose carries its OWN price and its OWN stock. product_stock is keyed by sku
-- only, so it can't hold that. This adds product_variant_stock, keyed by
-- (sku, dose), as the per-dose override layer:
--
--   • on_hand     — units of THAT dose on hand (absolute)
--   • price_cents — price for THAT dose; null → fall back to lib/pricing
--   • reorder_at  — low-stock threshold for THAT dose
--
-- Product-level concerns (hidden / deleted / cited clip) stay on product_stock.
-- A dose row makes a product "in stock" if ANY of its doses has on_hand > 0.
--
-- import_inventory is re-defined here to route rows that carry a `dose` to the
-- variant table, while rows without a dose keep the old per-sku behaviour
-- (equipment, single-variant items). Additive. Re-runnable.
-- =============================================================================

-- ── Per-dose override table ──────────────────────────────────────────────────

create table if not exists product_variant_stock (
  sku         text        not null,
  dose        text        not null,
  on_hand     integer     not null default 0 check (on_hand >= 0),
  reorder_at  integer,
  price_cents integer     check (price_cents is null or price_cents >= 0),
  updated_at  timestamptz not null default now(),
  primary key (sku, dose)
);

create index if not exists product_variant_stock_sku_idx on product_variant_stock (sku);

alter table product_variant_stock enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'product_variant_stock' and policyname = 'Admins can read product_variant_stock'
  ) then
    create policy "Admins can read product_variant_stock"
      on product_variant_stock for select using (is_admin());
  end if;
end $$;

-- ── Public read view (per-dose price + stock the catalog honours) ────────────

create or replace view public_variant_overrides as
  select sku, dose, on_hand, price_cents
  from product_variant_stock;

grant select on public_variant_overrides to anon, authenticated;

-- ── Bulk import — now dose-aware ─────────────────────────────────────────────
-- Per-row semantics unchanged: a present, non-empty field key is applied; an
-- absent/empty key is left untouched. New: when `dose` is present, on_hand /
-- price_cents / reorder_at apply to that (sku, dose) variant. Product-level
-- fields (hidden, the cited clip) always apply to the sku. Rows with no dose
-- keep the legacy per-sku on_hand / price behaviour.

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

    -- Ensure the per-sku row exists (product-level fields live here).
    insert into product_stock (sku, on_hand) values (v_sku, 0)
      on conflict (sku) do nothing;
    -- Ensure the per-dose row exists when a dose is given.
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
        -- per-dose stock (not logged to the sku-level ledger; dose isn't modelled there)
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

    -- price (USD in the sheet → cents on the wire as price_cents).
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

    -- hidden (truthy strings → true) — always product-level
    if nullif(btrim(v_row->>'hidden'), '') is not null then
      update product_stock
        set hidden = (lower(btrim(v_row->>'hidden')) in ('true','t','1','yes','y','hidden')),
            updated_at = now()
        where sku = v_sku;
      v_changed := v_changed || 'hidden';
    end if;

    -- cited clip — product-level; only touched when a url is present.
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
