-- =============================================================================
-- VS Research Labs — Explicit per-dose visibility (variant hidden flag)
-- =============================================================================
-- Until now a single dose could only be pulled from the storefront implicitly:
-- clear its price AND make sure it carried no supply signal (the master-sheet
-- "xx" convention, see migration 046 + isVariantPublic). That is fragile — a
-- dose with on-hand stock stays visible even when the owner meant to hide it,
-- and "no price" is overloaded to mean both "use the formula" and "hide".
--
-- This adds an unambiguous, owner-facing switch: product_variant_stock.hidden.
-- When true, the dose never lists on the public catalog regardless of price or
-- stock. The storefront reads it through public_variant_overrides and honours
-- it in isVariantPublic. Pricing/stock semantics are untouched.
--
-- Additive. Re-runnable.
-- =============================================================================

-- ── 1. Schema: hidden column ─────────────────────────────────────────────────

alter table product_variant_stock
  add column if not exists hidden boolean not null default false;

-- ── 2. Public view — expose hidden alongside the existing per-dose fields ────
-- Drop + recreate (not CREATE OR REPLACE) because we're appending a column and
-- the view was last defined in migration 018.

drop view if exists public_variant_overrides;
create view public_variant_overrides as
  select sku, dose, on_hand, inbound_units, price_cents, lead_days, hidden
  from product_variant_stock;

grant select on public_variant_overrides to anon, authenticated;

-- ── 3. set_variant_hidden RPC — per-dose visibility toggle ───────────────────
-- Admin-gated, security definer, audit-logged. Ensures both the per-sku and the
-- per-dose rows exist first (a freshly-seeded product may not have a variant row
-- yet), then flips the flag. Mirrors set_product_hidden at the dose grain.

create or replace function set_variant_hidden(
  p_sku    text,
  p_dose   text,
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
  if nullif(btrim(p_sku), '') is null or nullif(btrim(p_dose), '') is null then
    raise exception 'sku and dose are required';
  end if;

  -- Product-level row (product-level fields live here).
  insert into product_stock (sku, on_hand) values (p_sku, 0)
    on conflict (sku) do nothing;
  -- Per-dose row.
  insert into product_variant_stock (sku, dose) values (p_sku, p_dose)
    on conflict (sku, dose) do nothing;

  select hidden into v_before from product_variant_stock
    where sku = p_sku and dose = p_dose;

  update product_variant_stock
    set hidden     = p_hidden,
        updated_at = now()
    where sku = p_sku and dose = p_dose;

  perform log_audit(
    'variant.visibility_changed', 'variant', p_sku || ' · ' || p_dose,
    format('%s %s %s', p_sku, p_dose,
      case when p_hidden then 'hidden from catalog' else 'restored to catalog' end),
    jsonb_build_object('hidden', v_before),
    jsonb_build_object('hidden', p_hidden),
    jsonb_build_object('dose', p_dose)
  );
end;
$$;

grant execute on function set_variant_hidden(text, text, boolean) to authenticated;
