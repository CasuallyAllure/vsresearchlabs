-- 077_product_flags.sql
-- ---------------------------------------------------------------------------
-- WS-3 Early-access admin control — the last code-file switch, replaced by a
-- DB-backed per-SKU toggle.
--
-- Today "member early access" is set by hand-editing a product's tags
-- (EARLY_ACCESS_TAG in src/lib/earlyAccess.ts / products.json) — a code
-- deploy for what is really a merchandising decision. This adds an
-- admin-owned table + audited RPC so staff can flip it from the Inventory
-- editor instead, without touching the tag mechanism at all.
--
--   • product_flags        — one row per SKU that has ever been toggled.
--     early_access boolean, default false. Admin-only table (mirrors
--     075's automation_settings: RLS select-gated to is_admin(), all writes
--     go through the RPC below — no insert/update/delete policy exists).
--   • public_product_flags — narrow view (sku, early_access only), granted
--     select to anon/authenticated. Mirrors 047's product_variant_stock /
--     public_variant_overrides split: the admin table keeps its audit
--     columns private, the storefront catalog gate only ever sees the two
--     columns it needs to decide early-access.
--   • admin_set_product_flag() — the one write path. admin-gated, audited,
--     upserts (a SKU is only inserted into product_flags the first time an
--     admin touches it — untouched SKUs simply have no row, which the
--     catalog gate treats as "flag not set").
--
-- Catalog gate (src/lib/earlyAccess.ts): early-access = flag OR tag. The tag
-- stays the OR-fallback — with zero rows in product_flags (the ship state,
-- and true of every SKU until an admin explicitly flips one), every
-- product's early-access status is decided by the tag exactly as today.
-- Byte-for-byte inert on deploy.
--
-- Additive. Re-runnable.
-- Rollback notes: DB is forward-fix only. To revert, deploy a later migration
--   dropping admin_set_product_flag(), public_product_flags and
--   product_flags. The tag path in earlyAccess.ts keeps working regardless —
--   it never depended on this table.
-- ---------------------------------------------------------------------------

-- ── 1. product_flags — admin-owned per-SKU switches ─────────────────────────

create table if not exists product_flags (
  sku          text        primary key,
  early_access boolean     not null default false,
  updated_by   uuid        references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table product_flags enable row level security;
drop policy if exists "Admins read product flags" on product_flags;
create policy "Admins read product flags" on product_flags for select using (is_admin());
revoke all on product_flags from anon, authenticated;
grant select on product_flags to authenticated;  -- RLS narrows this to admins only
-- No insert/update/delete policies → all writes go through admin_set_product_flag.

-- ── 2. public_product_flags — narrow public read for the catalog gate ──────
-- The storefront never reads product_flags directly (admin-only above); it
-- reads this view instead, which exposes only what the gate needs.
--
-- Read-only, deliberately: a bare `create view` inherits schema-level DEFAULT
-- PRIVILEGES, which on this project grant anon/authenticated the FULL set
-- (select/insert/update/delete) on every newly created relation — and
-- Postgres auto-updatable simple views forward writes straight through to
-- the base table. The explicit `revoke all` below strips that default grant
-- before the narrow `grant select` — without it, any signed-out visitor
-- could write early_access for any SKU directly through this view via the
-- public REST API, bypassing admin_set_product_flag and its audit trail
-- entirely.

drop view if exists public_product_flags;
create view public_product_flags as
  select sku, early_access from product_flags;

revoke all on public_product_flags from anon, authenticated;
grant select on public_product_flags to anon, authenticated;

-- ── 3. admin_set_product_flag — the one write path (audited) ───────────────

create or replace function admin_set_product_flag(
  p_sku          text,
  p_early_access boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_sku    text := nullif(btrim(p_sku), '');
  v_before boolean;
  v_after  product_flags;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  if v_sku is null then
    raise exception 'sku is required';
  end if;

  select early_access into v_before from product_flags where sku = v_sku;

  insert into product_flags (sku, early_access, updated_by, updated_at)
  values (v_sku, coalesce(p_early_access, false), auth.uid(), now())
  on conflict (sku) do update
    set early_access = excluded.early_access,
        updated_by   = excluded.updated_by,
        updated_at   = excluded.updated_at
  returning * into v_after;

  perform log_audit(
    'product.early_access_toggled', 'product', v_sku,
    format('%s early access %s', v_sku, case when v_after.early_access then 'ENABLED' else 'disabled' end),
    jsonb_build_object('sku', v_sku, 'earlyAccess', v_before),
    jsonb_build_object('sku', v_sku, 'earlyAccess', v_after.early_access),
    null
  );

  return jsonb_build_object('sku', v_after.sku, 'earlyAccess', v_after.early_access);
end;
$$;

revoke execute on function admin_set_product_flag(text, boolean) from public, anon;
grant  execute on function admin_set_product_flag(text, boolean) to authenticated;
