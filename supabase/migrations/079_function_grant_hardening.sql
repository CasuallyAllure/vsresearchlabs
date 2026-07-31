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


-- ── 2a. Legitimately anon-callable — the logged-out storefront surface ──────
-- These five are reachable without a session BY DESIGN and must stay that way;
-- narrowing any of them takes down order tracking, the cart, or every RLS
-- policy in the schema. PUBLIC is still revoked and the grant re-stated
-- explicitly, so the ACL says what it means.
--
--   lookup_order / get_order_by_token / confirm_order_shipping — the
--     token-gated order-lookup design (docs: Order Lookup Security). The buyer
--     has no account; the order number + ZIP, or an emailed token, IS the
--     credential. lookup_order is additionally rate-limited via
--     lookup_order_bump (065/066), which stays service_role-only.
--   validate_coupon — the cart prices coupons before checkout and guests
--     check out without signing in (src/lib/coupons.ts).
--   is_admin — NOT optional for anon. It is referenced by ~40 RLS policies
--     across 003/004/005/…; policy expressions are evaluated with the calling
--     role's privileges, so revoking EXECUTE from anon would turn every
--     anon-visible table into a permission error. It only reports whether the
--     CALLER has an active admin_users row — it discloses nothing.

revoke execute on function lookup_order(p_identifier text, p_zip text) from public, anon, authenticated;
grant  execute on function lookup_order(p_identifier text, p_zip text) to anon, authenticated;

revoke execute on function get_order_by_token(p_token text) from public, anon, authenticated;
grant  execute on function get_order_by_token(p_token text) to anon, authenticated;

revoke execute on function confirm_order_shipping(p_token text, p_street text, p_city text, p_state text, p_zip text, p_country text) from public, anon, authenticated;
grant  execute on function confirm_order_shipping(p_token text, p_street text, p_city text, p_state text, p_zip text, p_country text) to anon, authenticated;

revoke execute on function validate_coupon(p_code text, p_subtotal_cents integer, p_contact text, p_applied_codes text[], p_has_reward boolean, p_has_promo boolean, p_has_account boolean) from public, anon, authenticated;
grant  execute on function validate_coupon(p_code text, p_subtotal_cents integer, p_contact text, p_applied_codes text[], p_has_reward boolean, p_has_promo boolean, p_has_account boolean) to anon, authenticated;

revoke execute on function is_admin() from public, anon, authenticated;
grant  execute on function is_admin() to anon, authenticated;


-- ── 2b. Customer portal — self-scoped by auth.uid(), authenticated only ─────
-- Every one of these derives its scope from auth.uid(), which is NULL for anon,
-- so the anon grant bought nothing but reachability. src/lib/accountData.ts and
-- src/lib/customerAuth.ts call them from a signed-in session.

revoke execute on function get_my_order(p_order_number text) from public, anon, authenticated;
grant  execute on function get_my_order(p_order_number text) to authenticated;

revoke execute on function get_my_referral_code() from public, anon, authenticated;
grant  execute on function get_my_referral_code() to authenticated;

revoke execute on function get_my_reward_summary() from public, anon, authenticated;
grant  execute on function get_my_reward_summary() to authenticated;

revoke execute on function redeem_reward() from public, anon, authenticated;
grant  execute on function redeem_reward() to authenticated;

revoke execute on function link_my_orders() from public, anon, authenticated;
grant  execute on function link_my_orders() to authenticated;


-- ── 2c. Admin RPCs — is_admin()-gated, authenticated only ───────────────────
-- Every routine below opens with `if not is_admin() then raise 'Unauthorized'`
-- and is called from a signed-in admin page (src/pages/admin/**,
-- src/components/admin/**), i.e. always as `authenticated`. Dropping anon and
-- PUBLIC removes an unauthenticated attacker's ability to even reach the guard:
-- defence in depth, and it keeps them out of the CI allowlist for anon.
-- `authenticated` is deliberately kept rather than narrowed further — the
-- is_admin() check inside each body is the real fence, and PostgREST has no way
-- to grant "authenticated AND admin" at the ACL level.

revoke execute on function adjust_stock(p_sku text, p_delta integer, p_reason stock_movement_reason, p_notes text) from public, anon, authenticated;
grant  execute on function adjust_stock(p_sku text, p_delta integer, p_reason stock_movement_reason, p_notes text) to authenticated;

revoke execute on function admin_adjust_reward_points(p_user_id uuid, p_points integer, p_note text) from public, anon, authenticated;
grant  execute on function admin_adjust_reward_points(p_user_id uuid, p_points integer, p_note text) to authenticated;

revoke execute on function admin_apply_coupon(p_order_id uuid, p_code text) from public, anon, authenticated;
grant  execute on function admin_apply_coupon(p_order_id uuid, p_code text) to authenticated;

revoke execute on function admin_clear_coupon(p_order_id uuid) from public, anon, authenticated;
grant  execute on function admin_clear_coupon(p_order_id uuid) to authenticated;

revoke execute on function admin_clear_coupons(p_order_id uuid) from public, anon, authenticated;
grant  execute on function admin_clear_coupons(p_order_id uuid) to authenticated;

revoke execute on function admin_create_order(p_buyer_name text, p_buyer_contact text, p_buyer_organization text, p_notes text, p_lines jsonb) from public, anon, authenticated;
grant  execute on function admin_create_order(p_buyer_name text, p_buyer_contact text, p_buyer_organization text, p_notes text, p_lines jsonb) to authenticated;

revoke execute on function admin_deactivate_customer_discount(p_id uuid) from public, anon, authenticated;
grant  execute on function admin_deactivate_customer_discount(p_id uuid) to authenticated;

revoke execute on function admin_email_log(p_limit integer, p_offset integer) from public, anon, authenticated;
grant  execute on function admin_email_log(p_limit integer, p_offset integer) to authenticated;

revoke execute on function admin_invitable_guests(p_limit integer) from public, anon, authenticated;
grant  execute on function admin_invitable_guests(p_limit integer) to authenticated;

revoke execute on function admin_log_member_invite(p_email text, p_points integer, p_channel text) from public, anon, authenticated;
grant  execute on function admin_log_member_invite(p_email text, p_points integer, p_channel text) to authenticated;

revoke execute on function admin_member_activity(p_customer_id uuid) from public, anon, authenticated;
grant  execute on function admin_member_activity(p_customer_id uuid) to authenticated;

revoke execute on function admin_member_attention() from public, anon, authenticated;
grant  execute on function admin_member_attention() to authenticated;

revoke execute on function admin_member_invites(p_filter text, p_limit integer, p_offset integer) from public, anon, authenticated;
grant  execute on function admin_member_invites(p_filter text, p_limit integer, p_offset integer) to authenticated;

revoke execute on function admin_member_referrals(p_limit integer, p_offset integer) from public, anon, authenticated;
grant  execute on function admin_member_referrals(p_limit integer, p_offset integer) to authenticated;

revoke execute on function admin_member_roster(p_segment text, p_sort text, p_search text, p_limit integer, p_offset integer) from public, anon, authenticated;
grant  execute on function admin_member_roster(p_segment text, p_sort text, p_search text, p_limit integer, p_offset integer) to authenticated;

revoke execute on function admin_member_spend_distribution() from public, anon, authenticated;
grant  execute on function admin_member_spend_distribution() to authenticated;

revoke execute on function admin_member_stats() from public, anon, authenticated;
grant  execute on function admin_member_stats() to authenticated;

revoke execute on function admin_member_vouchers(p_status text, p_limit integer, p_offset integer) from public, anon, authenticated;
grant  execute on function admin_member_vouchers(p_status text, p_limit integer, p_offset integer) to authenticated;

revoke execute on function admin_remove_coupon(p_order_id uuid, p_code text) from public, anon, authenticated;
grant  execute on function admin_remove_coupon(p_order_id uuid, p_code text) to authenticated;

revoke execute on function admin_set_automation_kind(p_kind text, p_enabled boolean) from public, anon, authenticated;
grant  execute on function admin_set_automation_kind(p_kind text, p_enabled boolean) to authenticated;

revoke execute on function admin_set_customer_discount(p_user_id uuid, p_scope text, p_percent numeric, p_label text, p_expires_at timestamp with time zone) from public, anon, authenticated;
grant  execute on function admin_set_customer_discount(p_user_id uuid, p_scope text, p_percent numeric, p_label text, p_expires_at timestamp with time zone) to authenticated;

revoke execute on function admin_set_profile_flags(p_user_id uuid, p_tier text, p_status text, p_account_type text, p_business_name text, p_free_shipping boolean) from public, anon, authenticated;
grant  execute on function admin_set_profile_flags(p_user_id uuid, p_tier text, p_status text, p_account_type text, p_business_name text, p_free_shipping boolean) to authenticated;

revoke execute on function admin_upsert_coupon(p_id uuid, p_payload jsonb) from public, anon, authenticated;
grant  execute on function admin_upsert_coupon(p_id uuid, p_payload jsonb) to authenticated;

revoke execute on function admin_void_voucher(p_voucher_id uuid, p_refund_points boolean, p_reason text) from public, anon, authenticated;
grant  execute on function admin_void_voucher(p_voucher_id uuid, p_refund_points boolean, p_reason text) to authenticated;

revoke execute on function cancel_order(p_order_id uuid, p_reason text) from public, anon, authenticated;
grant  execute on function cancel_order(p_order_id uuid, p_reason text) to authenticated;

revoke execute on function clear_order_flag(p_order_id uuid) from public, anon, authenticated;
grant  execute on function clear_order_flag(p_order_id uuid) to authenticated;

revoke execute on function confirm_order_fulfilled(p_order_id uuid, p_tracking_number text, p_carrier text) from public, anon, authenticated;
grant  execute on function confirm_order_fulfilled(p_order_id uuid, p_tracking_number text, p_carrier text) to authenticated;

revoke execute on function create_order_from_inquiry(p_inquiry_id uuid) from public, anon, authenticated;
grant  execute on function create_order_from_inquiry(p_inquiry_id uuid) to authenticated;

revoke execute on function delete_order(p_order_id uuid, p_reason text) from public, anon, authenticated;
grant  execute on function delete_order(p_order_id uuid, p_reason text) to authenticated;

revoke execute on function import_inventory(p_rows jsonb) from public, anon, authenticated;
grant  execute on function import_inventory(p_rows jsonb) to authenticated;

revoke execute on function mark_order_delivered(p_order_id uuid) from public, anon, authenticated;
grant  execute on function mark_order_delivered(p_order_id uuid) to authenticated;

-- Two live overloads (010 added the subtotal/shipping form); both are admin.
revoke execute on function mark_order_invoiced(p_order_id uuid, p_invoice_url text, p_invoice_amount_cents integer, p_payment_method text) from public, anon, authenticated;
grant  execute on function mark_order_invoiced(p_order_id uuid, p_invoice_url text, p_invoice_amount_cents integer, p_payment_method text) to authenticated;

revoke execute on function mark_order_invoiced(p_order_id uuid, p_invoice_url text, p_invoice_amount_cents integer, p_payment_method text, p_subtotal_cents integer, p_shipping_cents integer) from public, anon, authenticated;
grant  execute on function mark_order_invoiced(p_order_id uuid, p_invoice_url text, p_invoice_amount_cents integer, p_payment_method text, p_subtotal_cents integer, p_shipping_cents integer) to authenticated;

revoke execute on function mark_order_paid(p_order_id uuid) from public, anon, authenticated;
grant  execute on function mark_order_paid(p_order_id uuid) to authenticated;

revoke execute on function mark_product_deleted(p_sku text) from public, anon, authenticated;
grant  execute on function mark_product_deleted(p_sku text) to authenticated;

revoke execute on function restore_product(p_sku text) from public, anon, authenticated;
grant  execute on function restore_product(p_sku text) to authenticated;

revoke execute on function revert_order_status(p_order_id uuid, p_reason text) from public, anon, authenticated;
grant  execute on function revert_order_status(p_order_id uuid, p_reason text) to authenticated;

revoke execute on function save_order_lines(p_order_id uuid, p_lines jsonb) from public, anon, authenticated;
grant  execute on function save_order_lines(p_order_id uuid, p_lines jsonb) to authenticated;

revoke execute on function seed_stock_row(p_sku text, p_initial integer) from public, anon, authenticated;
grant  execute on function seed_stock_row(p_sku text, p_initial integer) to authenticated;

revoke execute on function set_b2g1_promo(p_enabled boolean, p_ends_at timestamp with time zone, p_excluded_skus text[]) from public, anon, authenticated;
grant  execute on function set_b2g1_promo(p_enabled boolean, p_ends_at timestamp with time zone, p_excluded_skus text[]) to authenticated;

revoke execute on function set_customer_notes(p_customer_id uuid, p_notes text) from public, anon, authenticated;
grant  execute on function set_customer_notes(p_customer_id uuid, p_notes text) to authenticated;

revoke execute on function set_customer_status(p_customer_id uuid, p_status text) from public, anon, authenticated;
grant  execute on function set_customer_status(p_customer_id uuid, p_status text) to authenticated;

revoke execute on function set_order_shipping(p_order_id uuid, p_cents integer) from public, anon, authenticated;
grant  execute on function set_order_shipping(p_order_id uuid, p_cents integer) to authenticated;

revoke execute on function set_order_tracking(p_order_id uuid, p_carrier text, p_tracking_number text) from public, anon, authenticated;
grant  execute on function set_order_tracking(p_order_id uuid, p_carrier text, p_tracking_number text) to authenticated;

revoke execute on function set_product_hidden(p_sku text, p_hidden boolean) from public, anon, authenticated;
grant  execute on function set_product_hidden(p_sku text, p_hidden boolean) to authenticated;

revoke execute on function set_product_price(p_sku text, p_cents integer) from public, anon, authenticated;
grant  execute on function set_product_price(p_sku text, p_cents integer) to authenticated;

revoke execute on function set_product_video(p_sku text, p_url text, p_title text, p_description text, p_thumbnail text) from public, anon, authenticated;
grant  execute on function set_product_video(p_sku text, p_url text, p_title text, p_description text, p_thumbnail text) to authenticated;

revoke execute on function set_variant_hidden(p_sku text, p_dose text, p_hidden boolean) from public, anon, authenticated;
grant  execute on function set_variant_hidden(p_sku text, p_dose text, p_hidden boolean) to authenticated;


-- ── 2d. Nothing outside the database should call these ──────────────────────
-- No grant is re-issued: `postgres` (the owner) and the pre-existing explicit
-- service_role grant are all the access these need.
--
-- Definer-internal helpers. Their only callers are other `security definer`
-- routines, which execute as `postgres` and therefore need no grant of their
-- own. _apply_order_stock is the critical one — unguarded direct writes to
-- product_variant_stock / product_stock / stock_movements, reachable today by
-- an anonymous POST /rest/v1/rpc/_apply_order_stock.

revoke execute on function _apply_order_stock(p_sku text, p_product_name text, p_quantity integer, p_deduct boolean, p_reason stock_movement_reason, p_order_id uuid, p_admin uuid, p_notes text) from public, anon, authenticated;
revoke execute on function _resolve_line_dose(p_sku text, p_product_name text) from public, anon, authenticated;
revoke execute on function gen_order_number() from public, anon, authenticated;
revoke execute on function log_audit(p_action text, p_entity_type text, p_entity_id text, p_summary text, p_before_value jsonb, p_after_value jsonb, p_context jsonb) from public, anon, authenticated;
revoke execute on function squash_dose_text(p_text text) from public, anon, authenticated;

-- coupon_combinability_reason: 057 granted it to anon/authenticated alongside
-- validate_coupon, but no client ever calls it — validate_coupon (definer)
-- invokes it internally. Removing the grant closes a coupon-metadata oracle
-- that read the `coupons` table for arbitrary codes.
revoke execute on function coupon_combinability_reason(p_candidate text, p_applied text[], p_has_reward boolean, p_has_promo boolean, p_has_account boolean) from public, anon, authenticated;

-- mark_receipt_sent: only send-receipt (service_role) calls it. Its guard is
-- `auth.uid() is not null and not is_admin()`, which an anon caller (NULL uid)
-- passes — so the grant, not the guard, was what stood between the internet and
-- stamping receipt_sent_at on arbitrary orders. The body is deliberately left
-- alone: the permissive uid check is what lets the edge function through.
revoke execute on function mark_receipt_sent(p_order_id uuid) from public, anon, authenticated;

-- Trigger functions. Postgres checks EXECUTE when the trigger is CREATED, not
-- when it fires, so these grants never did anything except pad the surface —
-- and PostgREST cannot invoke a trigger-returning routine anyway. Revoked so
-- the CI allowlist stays an honest list of things a browser may call.
revoke execute on function bump_customer_order_count() from public, anon, authenticated;
revoke execute on function guard_customer_profile_columns() from public, anon, authenticated;
revoke execute on function handle_new_customer() from public, anon, authenticated;
revoke execute on function touch_customer_profile_updated_at() from public, anon, authenticated;
revoke execute on function upsert_customer_from_inquiry() from public, anon, authenticated;


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
