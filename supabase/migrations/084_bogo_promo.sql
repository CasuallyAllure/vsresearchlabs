-- 084_bogo_promo.sql
-- ---------------------------------------------------------------------------
-- LAUNCH DAY BOGO — governance for the true buy-one-get-one promo, reusing the
-- promo_settings surface migration 055 built for B2G1 rather than standing up a
-- second one. Same shape, same single pinned row, same admin-RPC-only writes:
--   • bogo_enabled       master switch (default TRUE — the owner wants it live)
--   • bogo_ends_at       auto-expiring LTO boundary (null = runs until disabled)
--   • bogo_excluded_skus per-SKU carve-outs, seeded below
--
-- ELIGIBILITY IS NOT DEFINED HERE. place-order/promoPlan.ts decides it from
-- product_variant_stock: members only, 24-HOUR supply only (on_hand or inbound
-- > 0), admin-priced doses only. This table only supplies the master switch and
-- the exclusion list. Note that the 24-hour gate is the exact INVERSE of B2G1's
-- slow-ship gate, so the two promos are mutually exclusive per line by
-- construction — no arbitration needed at the line level.
--
-- SEEDED EXCLUSIONS (owner's list, resolved against real catalog data):
--   • VSR-RS-GSK  — Korean Glutathione. Exactly ONE sku; the
--     'korean-glutathione-hero' the brief anticipated is an IMAGE basename
--     (public/vials/korean-glutathione-hero.webp), not a product.
--   • the 8 laboratory / equipment / supplies SKUs. These already get no
--     automatic promo structurally (they price per-sku on product_stock and
--     resolve to NO product_variant_stock row, so promoPlan returns early), and
--     migration 063 already withholds wholesale_eligible from them. Enumerating
--     them here anyway is belt-and-braces AND makes the carve-out visible to
--     the owner in the admin panel instead of being an invisible side effect.
--     Enumerated rather than pattern-matched for the reason 063 states: the sku
--     prefix lies — 'VSR-RS-' means research supply, not compound, and three of
--     the eight carry it.
--   • "Laennec" — the third name on the owner's list — HAS NO SKU IN THIS
--     CATALOG. A repo-wide search returns zero hits: no product row, no image,
--     no test fixture. Nothing is seeded for it. If it is added later, it must
--     be appended to this list via set_bogo_promo().
--
-- Blends (the 8 `blend`-tagged compounds: GLOW, KLOW, Lipo-C, …) are NOT
-- excluded. The member-discount carve-out that once hid them was reversed by
-- the owner on 2026-07-23 ("the blend IS eligible"), recorded in
-- src/lib/memberPricing.ts. Excluding them here would silently re-litigate a
-- settled decision.
--
-- Requires 055. Additive and idempotent. Rollback:
--   drop function set_bogo_promo(boolean, timestamptz, text[]);
--   alter table promo_settings drop column bogo_enabled, drop column
--     bogo_ends_at, drop column bogo_excluded_skus;
-- ---------------------------------------------------------------------------

alter table promo_settings
  add column if not exists bogo_enabled       boolean     not null default true,
  add column if not exists bogo_ends_at       timestamptz,
  add column if not exists bogo_excluded_skus text[]      not null default '{}';

-- ── The promo window ────────────────────────────────────────────────────────
-- Owner: launch Saturday 2026-08-01, runs THROUGH the end of Monday
-- 2026-08-03 in the STORE'S timezone (America/Los_Angeles), not UTC.
--
-- Written as an EXCLUSIVE upper bound at Tuesday 00:00:00 local rather than
-- 23:59:59, because both liveness gates (SQL and TS) test `ends_at > now()` —
-- live strictly before the bound. An exclusive midnight boundary expresses
-- "through the end of Monday" exactly, with no sub-second gap where the promo
-- is neither live nor cleanly expired.
--
-- The literal is resolved by Postgres against the IANA tz database, so DST is
-- handled for us: in August the offset is PDT (UTC-7), making the real instant
-- 2026-08-04 07:00:00+00. Writing the UTC instant directly would have been a
-- silent trap — a naive '2026-08-03 23:59:59' would have killed the promo at
-- 4:59pm Monday local, mid-session, for every customer on the West Coast.
--
-- timestamptz stores an absolute instant, so every comparison downstream
-- (Postgres now(), the edge function's Date.now(), the browser) is an
-- unambiguous instant comparison with no timezone reinterpretation.
update promo_settings
   set bogo_ends_at = timestamptz '2026-08-04 00:00:00 America/Los_Angeles'
 where id = 1
   and bogo_ends_at is null;

-- Seed the exclusion list only if it has never been set — re-running must not
-- clobber an owner edit made through set_bogo_promo().
update promo_settings
   set bogo_excluded_skus = array[
         'VSR-RS-GSK',      -- Korean Glutathione
         'VSR-RS-GSH',      -- Glutathione (owner: exclude BOTH glutathiones)
         'VSR-LE-BAL-220',  -- Analytical Balance
         'VSR-LE-CEN-024',  -- Microcentrifuge
         'VSR-LE-PHM-001',  -- pH Meter
         'VSR-LE-PIP-SET',  -- Micropipette Set
         'VSR-LE-VTX-001',  -- Vortex Mixer
         'VSR-RS-ACE-003',  -- Acetic Acid
         'VSR-RS-BAC-030',  -- Bacteriostatic Water
         'VSR-RS-SYR-100'   -- Research Syringes
       ]
 where id = 1
   and coalesce(array_length(bogo_excluded_skus, 1), 0) = 0;

-- RLS was enabled on this table by 055 and the existing "Anyone reads promo
-- settings" SELECT policy already covers the new columns (policies are
-- row-scoped, not column-scoped). The storefront needs to read them to render
-- the banner and preview the discount; none of it is sensitive.
--
-- Grants are re-asserted narrowly rather than assumed. `revoke all` FIRST is
-- the standing rule here after the 078 incident: a bare `grant select` on a
-- relation that already carried inherited DML leaves the DML in place, and the
-- RLS-bypass that produced was a production bug. Writes stay RPC-only — no
-- insert/update/delete policy exists, and none is granted.
revoke all on promo_settings from anon, authenticated;
grant select on promo_settings to anon, authenticated;

-- ── THE SERVER IS THE CLOCK ─────────────────────────────────────────────────
-- A device clock must never be able to grant or deny a discount. This view
-- hands the storefront the SERVER's verdict (`bogo_live`) and the SERVER's
-- current instant (`server_now`) alongside the raw config, so the client never
-- has to ask its own clock whether the promo is live.
--
-- The client still needs `server_now` as well as `bogo_live`, because a page
-- left open across the boundary would otherwise hold a stale `true` forever:
-- src/lib/promoSettings.ts advances the fetched server instant using the
-- device clock as a STOPWATCH ONLY (a monotonic elapsed delta), never as an
-- absolute clock. A device skewed hours forward or back changes nothing.
--
-- security_invoker so the base table's RLS still governs the read (its policy
-- is `using (true)` for select — the config is public and non-sensitive).
create or replace view public_promo_settings
  with (security_invoker = true)
as
  select
    id,
    b2g1_enabled,
    b2g1_ends_at,
    b2g1_excluded_skus,
    bogo_enabled,
    bogo_ends_at,
    bogo_excluded_skus,
    (bogo_enabled and (bogo_ends_at is null or bogo_ends_at > now())) as bogo_live,
    (b2g1_enabled and (b2g1_ends_at is null or b2g1_ends_at > now())) as b2g1_live,
    now() as server_now,
    updated_at
  from promo_settings;

-- `revoke all` BEFORE granting — NON-NEGOTIABLE on every new view here. A bare
-- `create view; grant select` silently inherits whatever DML the role already
-- holds on the view name, and that is exactly the RLS-bypass that reached
-- production and had to be repaired by migration 078. Reads only.
revoke all on public_promo_settings from anon, authenticated;
grant select on public_promo_settings to anon, authenticated;

-- ── Admin writer — set the whole BOGO config atomically ─────────────────────
-- Mirrors set_b2g1_promo (055) exactly: is_admin()-gated in the BODY (the ACL
-- can only express `authenticated`; the guard is the real fence), audit-logged,
-- security definer with a PINNED search_path so a caller-controlled path can
-- never re-resolve `promo_settings` or `is_admin` to something else.
create or replace function set_bogo_promo(
  p_enabled       boolean,
  p_ends_at       timestamptz,
  p_excluded_skus text[]
)
returns promo_settings
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row promo_settings;
begin
  if not is_admin() then
    raise exception 'Unauthorized: admin role required';
  end if;

  update promo_settings
     set bogo_enabled       = coalesce(p_enabled, true),
         bogo_ends_at       = p_ends_at,               -- null clears the end date
         bogo_excluded_skus = coalesce(p_excluded_skus, '{}'),
         updated_at         = now()
   where id = 1
  returning * into v_row;

  perform log_audit(
    'promo.bogo_updated', 'promo_settings', '1',
    format('BOGO %s%s · %s excluded',
      case when v_row.bogo_enabled then 'ON' else 'OFF' end,
      case when v_row.bogo_ends_at is null then '' else ' · ends ' || v_row.bogo_ends_at::text end,
      coalesce(array_length(v_row.bogo_excluded_skus, 1), 0)
    ),
    null,
    to_jsonb(v_row),
    jsonb_build_object('source', 'admin_promo_panel')
  );

  return v_row;
end;
$$;

-- Routines are EXECUTE-TO-PUBLIC by PostgreSQL default AND this schema carries
-- an ALTER DEFAULT PRIVILEGES granting EXECUTE to anon/authenticated (see 079).
-- Revoke BOTH sources before granting, or this RPC ships anon-callable.
-- Allowlisted by name in tests/integration/functionGrantHardening.test.ts.
revoke execute on function set_bogo_promo(boolean, timestamptz, text[]) from public, anon, authenticated;
grant execute on function set_bogo_promo(boolean, timestamptz, text[]) to authenticated;
