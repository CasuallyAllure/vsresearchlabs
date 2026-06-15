-- =============================================================================
-- VS Research Labs — Product Overrides (S4)
-- =============================================================================
-- Until products move to Postgres entirely, product_stock is the per-SKU
-- override layer: the live values that override what's baked into
-- products.json + biopeptideManifest.json at build time.
--
-- Three new override fields land here:
--   • hidden            — true hides the SKU from the public catalog
--   • price_cents_override — non-null replaces the lib/pricing computation
--   • deleted_at        — soft delete; row stays for audit, hidden from UI
--
-- Reads stay simple: any public surface that wants to honor these fields
-- joins product_stock by SKU and applies them. Mutations route through
-- SECURITY DEFINER RPCs that audit-log every change.
--
-- Additive — no existing column or constraint touched. Re-runnable.
-- =============================================================================

-- ── Columns ────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'hidden') then
    alter table product_stock
      add column hidden boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'price_cents_override') then
    alter table product_stock
      add column price_cents_override integer check (price_cents_override is null or price_cents_override >= 0);
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'product_stock' and column_name = 'deleted_at') then
    alter table product_stock
      add column deleted_at timestamptz;
  end if;
end $$;

create index if not exists product_stock_hidden_idx     on product_stock (hidden) where hidden = true;
create index if not exists product_stock_deleted_idx    on product_stock (deleted_at) where deleted_at is not null;

-- ── Read access for the public catalog ─────────────────────────────────────
-- Public users need to know whether a SKU is hidden / deleted / overridden
-- so the catalog renders the truth without a redeploy. We do NOT expose the
-- audit fields (notes, last_counted) — just the override surface.

create or replace view public_product_overrides as
  select sku, on_hand, hidden, price_cents_override, deleted_at
  from product_stock;

grant select on public_product_overrides to anon, authenticated;

-- The view itself bypasses RLS, but the underlying table is RLS-protected.
-- We expose this view as a read-only "is this SKU visible / what's its price /
-- is it in stock" lookup that public users may consult. No PII or audit data.

-- ── RPCs ───────────────────────────────────────────────────────────────────

create or replace function set_product_hidden(
  p_sku    text,
  p_hidden boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before boolean;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  insert into product_stock (sku, on_hand) values (p_sku, 0)
    on conflict (sku) do nothing;

  select hidden into v_before from product_stock where sku = p_sku;

  update product_stock
    set hidden     = p_hidden,
        updated_at = now()
    where sku = p_sku;

  perform log_audit(
    'product.visibility_changed', 'product', p_sku,
    format('%s %s', p_sku, case when p_hidden then 'hidden from catalog' else 'restored to catalog' end),
    jsonb_build_object('hidden', v_before),
    jsonb_build_object('hidden', p_hidden),
    null
  );
end;
$$;

grant execute on function set_product_hidden(text, boolean) to authenticated;


create or replace function set_product_price(
  p_sku   text,
  p_cents integer
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before integer;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if p_cents is not null and p_cents < 0 then
    raise exception 'Price cannot be negative';
  end if;

  insert into product_stock (sku, on_hand) values (p_sku, 0)
    on conflict (sku) do nothing;

  select price_cents_override into v_before from product_stock where sku = p_sku;

  update product_stock
    set price_cents_override = p_cents,
        updated_at           = now()
    where sku = p_sku;

  perform log_audit(
    'product.price_changed', 'product', p_sku,
    case
      when p_cents is null then format('%s — price override cleared', p_sku)
      else format('%s — price set to $%s', p_sku, (p_cents/100.0)::numeric(10,2))
    end,
    jsonb_build_object('price_cents_override', v_before),
    jsonb_build_object('price_cents_override', p_cents),
    null
  );
end;
$$;

grant execute on function set_product_price(text, integer) to authenticated;


create or replace function mark_product_deleted(
  p_sku text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before timestamptz;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  insert into product_stock (sku, on_hand) values (p_sku, 0)
    on conflict (sku) do nothing;

  select deleted_at into v_before from product_stock where sku = p_sku;
  if v_before is not null then
    raise exception 'Product already deleted';
  end if;

  update product_stock
    set deleted_at = now(),
        hidden     = true,
        updated_at = now()
    where sku = p_sku;

  perform log_audit(
    'product.deleted', 'product', p_sku,
    format('%s removed from listing (soft delete)', p_sku),
    jsonb_build_object('deleted_at', null),
    jsonb_build_object('deleted_at', now()),
    null
  );
end;
$$;

grant execute on function mark_product_deleted(text) to authenticated;


create or replace function restore_product(
  p_sku text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before timestamptz;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  select deleted_at into v_before from product_stock where sku = p_sku;
  if v_before is null then
    raise exception 'Product is not deleted';
  end if;

  update product_stock
    set deleted_at = null,
        hidden     = false,
        updated_at = now()
    where sku = p_sku;

  perform log_audit(
    'product.restored', 'product', p_sku,
    format('%s restored to listing', p_sku),
    jsonb_build_object('deleted_at', v_before),
    jsonb_build_object('deleted_at', null),
    null
  );
end;
$$;

grant execute on function restore_product(text) to authenticated;
