-- =============================================================================
-- VS Research Labs — View grant hardening (CRITICAL security fix)
-- =============================================================================
-- CLASS OF BUG
-- ------------
-- This project's `public` schema carries a schema-level ALTER DEFAULT
-- PRIVILEGES (installed by the Supabase bootstrap, not by any migration in
-- this repo) that grants the FULL table privilege set — arwdDxtm, i.e.
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER — to `anon`,
-- `authenticated` and `service_role` on every newly created relation.
--
-- That default silently applies to VIEWS too. So the idiomatic-looking pair
--
--     create view public_thing as select ... from base_table;
--     grant select on public_thing to anon, authenticated;
--
-- does NOT produce a read-only view. The `grant select` is a no-op — the view
-- already had SELECT from the ambient default, along with every write
-- privilege. Three further facts turn that into a full authentication bypass:
--
--   1. A "simple" view (single FROM, no aggregates/DISTINCT/set ops) is
--      AUTO-UPDATABLE in Postgres: INSERT/UPDATE/DELETE against the view are
--      rewritten straight through onto the base table.
--   2. A view runs with the privileges of its OWNER unless it is created (or
--      altered) with `security_invoker = true`. All three views below are
--      owned by `postgres`, a superuser-equivalent role. RLS on the base
--      tables is therefore NOT enforced — for reads OR for writes.
--   3. PostgREST exposes every relation `anon` holds privileges on as a REST
--      endpoint. No application code has to reference the view for it to be
--      reachable.
--
-- Net effect, proven empirically against a local stack holding nothing but the
-- public anon key:
--
--   • POST /rest/v1/public_variant_overrides  → HTTP 201, and a row with
--     price_cents = 1 landed in product_variant_stock. Anyone on the internet
--     could rewrite catalog pricing, stock and lead times.
--   • GET  /rest/v1/customer_with_history     → HTTP 200 with the full
--     customer table: names, e-mail/phone contacts, organizations, order and
--     inquiry history. `customers` has RLS enabled with an admin-only SELECT
--     policy; the owner-privileged view walked straight past it.
--
-- THE FIX (metadata/ACL only — no table rewrites, no data touched)
-- ----------------------------------------------------------------
--   1–2. Both `public_*_overrides` views: strip the inherited write
--        privileges, then re-grant SELECT only. These MUST stay anon-readable
--        — the logged-out storefront catalog reads them on every page load.
--   3.   `customer_with_history`: strip everything, grant SELECT to
--        `authenticated` only, AND flip the view to `security_invoker`.
--        Narrowing the grant alone is NOT enough: every signed-in
--        customer-portal member is also `authenticated`, so without invoker
--        mode the view would still execute as `postgres` and any logged-in
--        customer could read every other customer's PII. With
--        `security_invoker = true` the view honours the `using (is_admin())`
--        policies already defined on customers/orders/inquiries — admins see
--        everything, a plain member sees zero rows, anon sees nothing at all.
--   4.   Close the source prospectively so the next `create view` in this
--        repo cannot reintroduce the bug.
--   5.   A service_role-only audit function so this class is detectable —
--        and assertable in CI — on ANY future view, not just these three.
--
-- Migrations 071 (member_roster_base) and 077 (public_product_flags) already
-- use the correct `revoke all` → `grant select` order; this migration brings
-- the pre-existing views in line with that pattern and makes it the default.
--
-- Forward-fix only. Idempotent + re-runnable. Metadata/ACL changes only.
-- =============================================================================


-- ── 1. public_product_overrides — public catalog read, nothing more ─────────
-- Defined in migration 005, last replaced in 007. Auto-updatable onto
-- product_overrides. Must remain readable by signed-out visitors: the
-- storefront catalog (src/lib/productOverrides.ts) reads it before any auth.

revoke all on public_product_overrides from anon, authenticated;
grant select on public_product_overrides to anon, authenticated;


-- ── 2. public_variant_overrides — per-dose price/stock read, nothing more ───
-- Defined in migration 011, last replaced in 047. Auto-updatable onto
-- product_variant_stock — this is the view the price-rewrite exploit used.
-- Same public-read requirement as above (catalog + scripts/inventory.mjs).

revoke all on public_variant_overrides from anon, authenticated;
grant select on public_variant_overrides to anon, authenticated;


-- ── 3. customer_with_history — admin-only, and RLS-enforced for real ────────
-- Defined in migration 004. Read by the admin Customers page and Reports
-- (src/pages/admin/AdminCustomers.tsx, AdminReports.tsx) through the signed-in
-- admin's own session, so `authenticated` + invoker mode is exactly right:
-- is_admin() is true for those callers and the rows still come back.
--
-- anon loses the grant entirely (hard permission denied, not an empty result),
-- which is stronger than relying on RLS alone.

revoke all on customer_with_history from anon, authenticated;
grant select on customer_with_history to authenticated;

-- security_invoker requires PostgreSQL 15+. If this statement fails, the
-- deployment target is too old and the PII exposure is NOT fixed by the grant
-- narrowing alone — failing loudly here is deliberate.
alter view customer_with_history set (security_invoker = true);


-- ── 4. Close the source: stop handing writes to every new relation ──────────
-- Prospective only — Postgres DEFAULT PRIVILEGES are evaluated at CREATE time,
-- so this changes nothing about relations that already exist (they were fixed
-- explicitly above, and every pre-existing TABLE keeps the grants it has today,
-- with RLS still doing the real gating). From here on, a bare `create view` or
-- `create table` in this schema comes out read-only for anon/authenticated and
-- any write path has to be granted deliberately — or, per this codebase's
-- convention, routed through a security-definer RPC.
--
-- NOTE: SELECT is deliberately NOT revoked from the defaults. The `products`
-- table (migration 001) has no explicit grant at all — it relies entirely on
-- this ambient default SELECT plus its `using (true)` policy. Revoking default
-- SELECT would take the live public catalog dark. Read exposure is governed by
-- RLS; write exposure was not, which is why only writes are revoked here.
--
-- This applies to the DEFAULT PRIVILEGES owned by the role executing the
-- migration (`postgres`), which is the role that creates every relation in
-- this repo. The parallel set owned by `supabase_admin` is left alone — it is
-- platform-managed and no repo migration creates objects as that role.

alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;


-- ── 5. admin_audit_public_view_write_grants — the standing guard ────────────
-- Returns one row per (view, role, privilege) where a `public` view still
-- hands a write privilege to anon or authenticated. Zero rows == clean.
-- The regression test asserts zero rows, so this catches the bug class on any
-- view added later, not just the three repaired above.
--
-- Reads pg_class.relacl via aclexplode rather than information_schema, which
-- filters rows by the querying role's memberships and would under-report.
-- Grants to PUBLIC (grantee OID 0) are reported too: PUBLIC includes anon, so
-- such a grant is the same exposure by another name.
--
-- security definer + pinned search_path: catalog access must not depend on the
-- caller's privileges or on a hijackable search_path. service_role only —
-- this is an operational/CI probe, never something the browser should call.

create or replace function admin_audit_public_view_write_grants()
returns table (
  view_name      text,
  grantee        text,
  privilege_type text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    c.relname::text,
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end,
    a.privilege_type::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public'
    and c.relkind in ('v', 'm')            -- views and materialized views
    and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  order by 1, 2, 3;
$$;

revoke execute on function admin_audit_public_view_write_grants() from public, anon, authenticated;
grant  execute on function admin_audit_public_view_write_grants() to service_role;
