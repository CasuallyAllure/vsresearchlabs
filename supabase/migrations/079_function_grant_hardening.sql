-- =============================================================================
-- VS Research Labs — Function EXECUTE grant hardening (companion to 078)
-- =============================================================================
-- CLASS OF BUG
-- ------------
-- 078 closed the ambient-grant hole for RELATIONS. It does not close it for
-- ROUTINES: `ALTER DEFAULT PRIVILEGES … ON TABLES` and `… ON FUNCTIONS` are
-- separate ACL channels, and this project's `public` schema carries both. The
-- hosted-parity bootstrap in .github/workflows/ci.yml spells the routine one
-- out verbatim:
--
--     alter default privileges for role postgres in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- On top of that, PostgreSQL's own built-in default for a new function is
-- `EXECUTE TO PUBLIC` — and PUBLIC contains anon. So a bare
--
--     create function do_a_thing(...) ... security definer ...;
--
-- comes out of the box callable by an unauthenticated browser, twice over.
-- PostgREST publishes every `public` routine the caller's role can EXECUTE as
-- `POST /rest/v1/rpc/<name>`; no application code has to reference it. And
-- because these RPCs are `security definer`, they run as `postgres` — RLS on
-- the tables they touch is not a second line of defence, it is bypassed.
--
-- Every locked-down RPC in this repo is locked down only because its author
-- remembered an explicit `revoke execute` (061 squash_dose_text, 057
-- coupon_combinability_reason, 065 lookup_order_bump, …). That is the same
-- per-author diligence step that was forgotten five separate times on the three
-- views 078 had to repair. 029_harden_public_surface.sql already caught one
-- routine instance of it: `mark_payment_claimed` was anon-callable and let
-- anyone flip any order to `payment_claimed`.
--
-- WHAT THE AUDIT FOUND (local stack, migrations 001–078)
-- ------------------------------------------------------
-- 70 of the 80 `public` routines on this branch were executable by anon and/or
-- authenticated (71 of 81 on a stack that also carries the unmerged 077).
-- Most are `security definer` admin RPCs that open with `if not is_admin()
-- then raise` — anon reaches them but gets "Unauthorized", so the grant is
-- surplus rather than exploitable. Four were neither guarded nor meant to be
-- called from a browser at all:
--
--   • _apply_order_stock(...)  — CRITICAL. security definer, NO auth guard,
--     writes product_variant_stock / product_stock / stock_movements directly.
--     Anon-callable: an unauthenticated POST could add or drain inventory for
--     any sku. This is the same shape of hole as the 078 price-rewrite.
--   • log_audit(...)           — HIGH. security definer, NO guard, INSERTs into
--     audit_log. Anon-callable: forge or flood the audit trail — the record the
--     admin surface trusts when reconstructing who changed what.
--   • mark_receipt_sent(...)   — MEDIUM. Its guard is deliberately permissive
--     for the service-role edge function: `if auth.uid() is not null and not
--     is_admin() then raise`. An anon caller has a NULL uid, so it walks
--     straight through and can stamp receipt_sent_at / bump receipt_count on
--     any order id. Only send-receipt (service_role) is supposed to call it.
--   • _resolve_line_dose(...), gen_order_number() — internal helpers, low
--     impact, but nothing outside a definer function should reach them.
--
-- THE FIX (metadata/ACL only — no function bodies changed, no data touched)
-- ------------------------------------------------------------------------
--   1. Prospective (PARTIAL — see §1): strip the bootstrap's named
--      anon/authenticated grants out of the schema's function defaults.
--      PostgreSQL will not let ALTER DEFAULT PRIVILEGES remove the built-in
--      `EXECUTE TO PUBLIC` baseline, so §3's audit + CI allowlist is the guard
--      that actually holds the line going forward.
--   2. Retroactive: re-state every existing routine's grant explicitly, at the
--      narrowest role its real caller needs. PUBLIC is revoked everywhere —
--      PUBLIC includes anon, so leaving it is the same exposure by another name.
--   3. A service_role-only audit function + regression test pinning the result
--      to an explicit allowlist, so the next leaked routine fails CI loudly.
--
-- service_role is untouched throughout: every routine in `public` already holds
-- an explicit service_role EXECUTE grant (verified — zero exceptions), so
-- revoking PUBLIC cannot strip the edge functions' access.
--
-- Forward-fix only. Idempotent + re-runnable. Metadata/ACL changes only, safe
-- to apply to a live database — no locks beyond a catalog row per statement.
--
-- WHY §2 IS A LOOP AND NOT 70 FLAT STATEMENTS (schema-drift tolerance)
-- --------------------------------------------------------------------
-- The first production attempt at this migration aborted and rolled back
-- atomically on
--
--     revoke execute on function clear_order_flag(p_order_id uuid) …
--
-- because `clear_order_flag` DOES NOT EXIST on production — even though
-- 013_order_receipt.sql, the migration that creates it, is recorded as applied.
-- `REVOKE … ON FUNCTION` errors on a missing routine, and one such error takes
-- the whole (single-transaction) migration down with it, so a single drifted
-- object blocks a 70-statement security fix indefinitely.
--
-- §2 therefore resolves each routine through `to_regprocedure()`, which returns
-- NULL instead of raising when the name, the argument types or even the schema
-- are absent. A missing routine is SKIPPED and announced with `raise notice`,
-- never swallowed: `supabase db push` prints the notices, so drift is loud but
-- non-fatal, and the remaining 69 routines still get hardened.
--
-- This is deliberately generic. The 013 objects are restored by
-- 080_restore_013_functions.sql, but the tolerance stays — the failure mode
-- (a migration recorded as applied whose objects are absent) is a property of
-- the migration ledger, not of 013.
--
-- Consequence to keep in mind: a routine that is absent is also UNHARDENED. If
-- it is later created, it is born with the ambient EXECUTE grants again. The
-- backstop for that is unchanged — §3's audit function plus
-- tests/integration/functionGrantHardening.test.ts, which pins the
-- anon/authenticated-callable set to an explicit allowlist and fails CI by
-- name. That is why the notices matter: they name exactly what to go fix.
--
-- Signatures below are written with argument TYPES only (not parameter names).
-- `to_regprocedure` parses its argument with the type parser, which accepts
-- `lookup_order(text, text)` but rejects `lookup_order(p_identifier text, …)`.
-- =============================================================================


-- ── 1. Prospective: shrink what a new routine inherits ─────────────────────
-- This removes the Supabase bootstrap's named `anon`/`authenticated` grants
-- from the schema's function defaults. Applies to the DEFAULT PRIVILEGES owned
-- by the executing role (`postgres`), which creates every routine in this repo;
-- service_role keeps its default grant, so edge functions are unaffected. Like
-- 078's clause it is evaluated at CREATE time and changes nothing about
-- routines that already exist — those are re-stated explicitly in §2.
--
-- READ THIS BEFORE TRUSTING IT — it is a PARTIAL close, not a full one.
-- PostgreSQL's effective default for a new object is
-- `acldefault(objtype, owner)` MERGED WITH the pg_default_acl entry, and that
-- merge is a union: an ALTER DEFAULT PRIVILEGES entry can only ADD privileges
-- to the built-in baseline, never subtract from it. For FUNCTIONS the built-in
-- baseline includes `EXECUTE TO PUBLIC` — so `… revoke execute on functions
-- from public` is a no-op. Verified empirically on the PostgreSQL 17.6 stack
-- this repo runs: in a virgin schema, `alter default privileges … revoke
-- execute on functions from public` stored no pg_default_acl row at all and the
-- next `create function` still came out with `=X/postgres` (PUBLIC EXECUTE).
--
-- Net effect after this migration: a bare `create function` in `public` is born
-- with `{=X, postgres=X, service_role=X}` instead of
-- `{=X, postgres=X, anon=X, authenticated=X, service_role=X}`. PUBLIC contains
-- anon, so it is STILL reachable anonymously through PostgREST. What this buys
-- is that the one-line habit `revoke execute on function f(...) from public;`
-- now genuinely locks a routine down, where before it silently left the two
-- named grants behind.
--
-- The real prospective guard is therefore NOT this statement — it is §3's audit
-- function plus tests/integration/functionGrantHardening.test.ts, which pins
-- the anon/authenticated-callable set to an explicit allowlist. A future
-- migration that adds a routine and forgets to revoke fails CI by name.

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;


-- ── 2. Retroactive: re-state every existing routine's grant explicitly ──────
-- One row per routine: (identity signature, roles to re-grant EXECUTE to).
-- A NULL grantee list means "revoke only" — see §2d. Every row revokes from
-- `public, anon, authenticated` first, exactly as the flat statements did, so
-- the applied result is identical on a database where every routine exists.

do $$
declare
  v_spec    record;
  v_fn      regprocedure;
  v_total   integer := 0;
  v_missing text[] := '{}';
begin
  for v_spec in
    select * from (values

      -- ── 2a. Legitimately anon-callable — the logged-out storefront surface ──
      -- These five are reachable without a session BY DESIGN and must stay that
      -- way; narrowing any of them takes down order tracking, the cart, or every
      -- RLS policy in the schema. PUBLIC is still revoked and the grant re-stated
      -- explicitly, so the ACL says what it means.
      --
      --   lookup_order / get_order_by_token / confirm_order_shipping — the
      --     token-gated order-lookup design (docs: Order Lookup Security). The
      --     buyer has no account; the order number + ZIP, or an emailed token, IS
      --     the credential. lookup_order is additionally rate-limited via
      --     lookup_order_bump (065/066), which stays service_role-only.
      --   validate_coupon — the cart prices coupons before checkout and guests
      --     check out without signing in (src/lib/coupons.ts).
      --   is_admin — NOT optional for anon. It is referenced by ~40 RLS policies
      --     across 003/004/005/…; policy expressions are evaluated with the
      --     calling role's privileges, so revoking EXECUTE from anon would turn
      --     every anon-visible table into a permission error. It only reports
      --     whether the CALLER has an active admin_users row — it discloses
      --     nothing.
      ('lookup_order(text, text)'::text,                                          'anon, authenticated'::text),
      ('get_order_by_token(text)',                                                'anon, authenticated'),
      ('confirm_order_shipping(text, text, text, text, text, text)',              'anon, authenticated'),
      ('validate_coupon(text, integer, text, text[], boolean, boolean, boolean)', 'anon, authenticated'),
      ('is_admin()',                                                              'anon, authenticated'),

      -- ── 2b. Customer portal — self-scoped by auth.uid(), authenticated only ─
      -- Every one of these derives its scope from auth.uid(), which is NULL for
      -- anon, so the anon grant bought nothing but reachability.
      -- src/lib/accountData.ts and src/lib/customerAuth.ts call them from a
      -- signed-in session.
      ('get_my_order(text)',        'authenticated'),
      ('get_my_referral_code()',    'authenticated'),
      ('get_my_reward_summary()',   'authenticated'),
      ('redeem_reward()',           'authenticated'),
      ('link_my_orders()',          'authenticated'),

      -- ── 2c. Admin RPCs — is_admin()-gated, authenticated only ──────────────
      -- Every routine below opens with `if not is_admin() then raise
      -- 'Unauthorized'` and is called from a signed-in admin page
      -- (src/pages/admin/**, src/components/admin/**), i.e. always as
      -- `authenticated`. Dropping anon and PUBLIC removes an unauthenticated
      -- attacker's ability to even reach the guard: defence in depth, and it
      -- keeps them out of the CI allowlist for anon. `authenticated` is
      -- deliberately kept rather than narrowed further — the is_admin() check
      -- inside each body is the real fence, and PostgREST has no way to grant
      -- "authenticated AND admin" at the ACL level.
      ('adjust_stock(text, integer, stock_movement_reason, text)',                        'authenticated'),
      ('admin_adjust_reward_points(uuid, integer, text)',                                 'authenticated'),
      ('admin_apply_coupon(uuid, text)',                                                  'authenticated'),
      ('admin_clear_coupon(uuid)',                                                        'authenticated'),
      ('admin_clear_coupons(uuid)',                                                       'authenticated'),
      ('admin_create_order(text, text, text, text, jsonb)',                               'authenticated'),
      ('admin_deactivate_customer_discount(uuid)',                                        'authenticated'),
      ('admin_email_log(integer, integer)',                                               'authenticated'),
      ('admin_invitable_guests(integer)',                                                 'authenticated'),
      ('admin_log_member_invite(text, integer, text)',                                    'authenticated'),
      ('admin_member_activity(uuid)',                                                     'authenticated'),
      ('admin_member_attention()',                                                        'authenticated'),
      ('admin_member_invites(text, integer, integer)',                                    'authenticated'),
      ('admin_member_referrals(integer, integer)',                                        'authenticated'),
      ('admin_member_roster(text, text, text, integer, integer)',                         'authenticated'),
      ('admin_member_spend_distribution()',                                               'authenticated'),
      ('admin_member_stats()',                                                            'authenticated'),
      ('admin_member_vouchers(text, integer, integer)',                                   'authenticated'),
      ('admin_remove_coupon(uuid, text)',                                                 'authenticated'),
      ('admin_set_automation_kind(text, boolean)',                                        'authenticated'),
      ('admin_set_customer_discount(uuid, text, numeric, text, timestamp with time zone)','authenticated'),
      ('admin_set_profile_flags(uuid, text, text, text, text, boolean)',                  'authenticated'),
      ('admin_upsert_coupon(uuid, jsonb)',                                                'authenticated'),
      ('admin_void_voucher(uuid, boolean, text)',                                         'authenticated'),
      ('cancel_order(uuid, text)',                                                        'authenticated'),
      ('clear_order_flag(uuid)',                                                          'authenticated'),
      ('confirm_order_fulfilled(uuid, text, text)',                                       'authenticated'),
      ('create_order_from_inquiry(uuid)',                                                 'authenticated'),
      ('delete_order(uuid, text)',                                                        'authenticated'),
      ('import_inventory(jsonb)',                                                         'authenticated'),
      ('mark_order_delivered(uuid)',                                                      'authenticated'),
      -- Two live overloads (010 added the subtotal/shipping form); both are admin.
      ('mark_order_invoiced(uuid, text, integer, text)',                                  'authenticated'),
      ('mark_order_invoiced(uuid, text, integer, text, integer, integer)',                'authenticated'),
      ('mark_order_paid(uuid)',                                                           'authenticated'),
      ('mark_product_deleted(text)',                                                      'authenticated'),
      ('restore_product(text)',                                                           'authenticated'),
      ('revert_order_status(uuid, text)',                                                 'authenticated'),
      ('save_order_lines(uuid, jsonb)',                                                   'authenticated'),
      ('seed_stock_row(text, integer)',                                                   'authenticated'),
      ('set_b2g1_promo(boolean, timestamp with time zone, text[])',                       'authenticated'),
      ('set_customer_notes(uuid, text)',                                                  'authenticated'),
      ('set_customer_status(uuid, text)',                                                 'authenticated'),
      ('set_order_shipping(uuid, integer)',                                               'authenticated'),
      ('set_order_tracking(uuid, text, text)',                                            'authenticated'),
      ('set_product_hidden(text, boolean)',                                               'authenticated'),
      ('set_product_price(text, integer)',                                                'authenticated'),
      ('set_product_video(text, text, text, text, text)',                                 'authenticated'),
      ('set_variant_hidden(text, text, boolean)',                                         'authenticated'),

      -- ── 2d. Nothing outside the database should call these ─────────────────
      -- No grant is re-issued: `postgres` (the owner) and the pre-existing
      -- explicit service_role grant are all the access these need.
      --
      -- Definer-internal helpers. Their only callers are other `security
      -- definer` routines, which execute as `postgres` and therefore need no
      -- grant of their own. _apply_order_stock is the critical one — unguarded
      -- direct writes to product_variant_stock / product_stock /
      -- stock_movements, reachable today by an anonymous POST
      -- /rest/v1/rpc/_apply_order_stock.
      ('_apply_order_stock(text, text, integer, boolean, stock_movement_reason, uuid, uuid, text)', null),
      ('_resolve_line_dose(text, text)',                                                            null),
      ('gen_order_number()',                                                                        null),
      ('log_audit(text, text, text, text, jsonb, jsonb, jsonb)',                                    null),
      ('squash_dose_text(text)',                                                                    null),

      -- coupon_combinability_reason: 057 granted it to anon/authenticated
      -- alongside validate_coupon, but no client ever calls it — validate_coupon
      -- (definer) invokes it internally. Removing the grant closes a
      -- coupon-metadata oracle that read the `coupons` table for arbitrary codes.
      ('coupon_combinability_reason(text, text[], boolean, boolean, boolean)',                      null),

      -- mark_receipt_sent: only send-receipt (service_role) calls it. Its guard
      -- is `auth.uid() is not null and not is_admin()`, which an anon caller
      -- (NULL uid) passes — so the grant, not the guard, was what stood between
      -- the internet and stamping receipt_sent_at on arbitrary orders. The body
      -- is deliberately left alone: the permissive uid check is what lets the
      -- edge function through.
      ('mark_receipt_sent(uuid)',                                                                   null),

      -- Trigger functions. Postgres checks EXECUTE when the trigger is CREATED,
      -- not when it fires, so these grants never did anything except pad the
      -- surface — and PostgREST cannot invoke a trigger-returning routine
      -- anyway. Revoked so the CI allowlist stays an honest list of things a
      -- browser may call.
      ('bump_customer_order_count()',                                                               null),
      ('guard_customer_profile_columns()',                                                          null),
      ('handle_new_customer()',                                                                     null),
      ('touch_customer_profile_updated_at()',                                                       null),
      ('upsert_customer_from_inquiry()',                                                            null)

    ) as t(signature, grantees)
  loop
    -- to_regprocedure returns NULL — rather than raising — when the routine,
    -- its argument types or its schema are absent. That NULL is the whole
    -- drift-tolerance mechanism; see the header.
    v_total := v_total + 1;
    v_fn := to_regprocedure('public.' || v_spec.signature);

    if v_fn is null then
      v_missing := v_missing || v_spec.signature;
      raise notice '079: SKIPPED public.% — routine absent from this database, left unhardened', v_spec.signature;
      continue;
    end if;

    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);

    if v_spec.grantees is not null then
      execute format('grant execute on function %s to %s', v_fn, v_spec.grantees);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise notice '079: % of % routines were absent and are NOT hardened: %',
      cardinality(v_missing), v_total, array_to_string(v_missing, ', ');
  end if;
end $$;


-- ── 3. admin_audit_public_function_grants — the standing guard ──────────────
-- Companion to 078's admin_audit_public_view_write_grants(). Returns one row
-- per (routine, grantee) where a `public` routine is EXECUTE-able by anon,
-- authenticated, or PUBLIC. Unlike the view guard this is NOT expected to be
-- empty — a storefront needs some anon RPCs — so the regression test pins it
-- to an explicit allowlist instead. Any routine added later that leaks EXECUTE
-- shows up as an unexpected row and fails CI; a deliberate addition requires
-- editing the list on purpose.
--
-- Reads pg_proc.proacl via aclexplode rather than information_schema, which
-- filters by the querying role's memberships and would under-report.
-- `coalesce(proacl, acldefault('f', proowner))` is essential: a NULL proacl is
-- not "no grants", it is the built-in default — which includes EXECUTE TO
-- PUBLIC. Reading proacl alone would silently miss exactly the routines this
-- migration exists to catch. Grantee OID 0 is reported as 'PUBLIC'.
--
-- security definer + pinned search_path, service_role only, matching 078.

create or replace function admin_audit_public_function_grants()
returns table (
  function_name text,
  arguments     text,
  grantee       text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p.proname::text,
    pg_get_function_identity_arguments(p.oid),
    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public'
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  order by 1, 2, 3;
$$;

revoke execute on function admin_audit_public_function_grants() from public, anon, authenticated;
grant  execute on function admin_audit_public_function_grants() to service_role;
