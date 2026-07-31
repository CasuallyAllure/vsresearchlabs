-- =============================================================================
-- VS Research Labs — Restore the objects 013_order_receipt.sql was supposed to
-- create (schema-drift repair)
-- =============================================================================
-- DO NOT DELETE THIS AS "REDUNDANT". It looks like a duplicate of
-- 013_order_receipt.sql on purpose.
--
-- WHY THIS EXISTS
-- ---------------
-- 013_order_receipt.sql is recorded as APPLIED in production's migration
-- ledger, but the objects it uniquely creates are NOT PRESENT in the production
-- database. This was discovered on 2026-07-30 when
-- 079_function_grant_hardening.sql aborted (and rolled back atomically) on
--
--     revoke execute on function clear_order_flag(p_order_id uuid) …
--
-- Two independent confirmations that the routine is genuinely absent, not just
-- unreachable: PostgreSQL refused the REVOKE, and PostgREST answers
-- POST /rest/v1/rpc/clear_order_flag with PGRST202 ("not found in the schema
-- cache"). mark_receipt_sent — the other routine created ONLY by 013 — answers
-- PGRST202 as well.
--
-- The pattern is diagnostic: every object 013 creates that a LATER migration
-- also recreates is present (revert_order_status, rebuilt by 044 and again by
-- 068). Only the objects whose sole definition site is 013 are missing. That is
-- what you would see if 013 had been marked applied without ever executing —
-- e.g. a `supabase migration repair --status applied`, or a historical partial
-- restore. The exact cause is not established; the repair does not depend on it.
--
-- The migration ledger cannot be trusted to prove an object exists, so this
-- migration re-runs 013's object definitions rather than assuming them. It is a
-- strict no-op on any database where they already exist (the local stack, CI,
-- any developer machine): `create or replace` on an identical body, and 013's
-- own `if not exists`-guarded column block.
--
-- Companion change: 079 is now drift-TOLERANT (it resolves each routine through
-- to_regprocedure and skips-with-notice what is absent), so it applies whether
-- or not this migration has run. 080 supplies the missing objects AND their
-- correct grant posture; 079 stops a future absence from blocking a security
-- migration again. Both are needed — neither replaces the other.
--
-- GRANTS ARE NOT OPTIONAL HERE
-- ----------------------------
-- A function created in this project's `public` schema is born callable by the
-- anonymous browser, twice over: PostgreSQL's built-in `EXECUTE TO PUBLIC`
-- default for routines (PUBLIC contains anon), plus whatever the schema's
-- ALTER DEFAULT PRIVILEGES entry adds. That is the exact bug class 078 and 079
-- exist to close, so restoring these two routines without immediately
-- re-stating their ACLs would re-open it. The posture below matches, verbatim,
-- what 079 assigns each of them:
--
--   clear_order_flag  → revoke public/anon/authenticated, grant authenticated.
--     079 §2c. Its body opens with `if not is_admin() then raise
--     'Unauthorized: admin role required'`, so the real fence is inside the
--     function; `authenticated` is as narrow as an ACL can express for an
--     admin-console RPC called from a signed-in session.
--
--   mark_receipt_sent → revoke public/anon/authenticated, NO re-grant to
--     anon/authenticated; service_role only. 079 §2d. Its guard is
--     deliberately permissive — `if auth.uid() is not null and not is_admin()
--     then raise` — so a NULL-uid anonymous caller walks straight through it.
--     The GRANT, not the guard, is what stands between the internet and
--     stamping receipt_sent_at on arbitrary orders. Only the send-receipt edge
--     function (service_role) is supposed to call it. NOTE that 013 granted it
--     to `authenticated, service_role`; 079 drops `authenticated` and keeps
--     service_role, and that is the posture reproduced here — the admin surface
--     does not call it directly.
--
-- Both service_role grants are stated explicitly rather than inherited from the
-- schema's default privileges: 079 §1 has already rewritten those defaults, and
-- an edge function losing EXECUTE is not a failure mode worth leaving to an
-- ambient rule.
--
-- Additive. Re-runnable. No data touched.
-- =============================================================================

-- ── Columns (verbatim from 013) ─────────────────────────────────────────────
-- Included because the two routines below write these four columns, and 013 is
-- their only creation site as well — if 013 never executed, the columns are
-- missing too and a "restored" function would fail at its first call. plpgsql
-- bodies are not semantically validated at CREATE time, so nothing else would
-- catch that. Every branch is `if not exists`-guarded, so this is a no-op
-- wherever 013 did run.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='receipt_sent_at') then
    alter table orders add column receipt_sent_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='receipt_count') then
    alter table orders add column receipt_count integer not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='flag_note') then
    alter table orders add column flag_note text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='orders' and column_name='flagged_at') then
    alter table orders add column flagged_at timestamptz;
  end if;
end $$;

-- ── mark_receipt_sent — atomic stamp + increment (verbatim from 013) ────────

create or replace function mark_receipt_sent(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Callable by the service-role edge function; also admin-safe.
  if auth.uid() is not null and not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  update orders
    set receipt_sent_at = now(),
        receipt_count   = coalesce(receipt_count, 0) + 1,
        updated_at      = now()
    where id = p_order_id;
end;
$$;

revoke execute on function mark_receipt_sent(uuid) from public, anon, authenticated;
grant  execute on function mark_receipt_sent(uuid) to service_role;

-- ── clear_order_flag — dismiss the reverted/compromised marker (from 013) ───

create or replace function clear_order_flag(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;
  update orders set flag_note = null, flagged_at = null, updated_at = now()
    where id = p_order_id;
  perform log_audit('order.flag_cleared', 'order', p_order_id::text, 'Cleared order flag', null, null, null);
end;
$$;

revoke execute on function clear_order_flag(uuid) from public, anon, authenticated;
grant  execute on function clear_order_flag(uuid) to authenticated, service_role;
