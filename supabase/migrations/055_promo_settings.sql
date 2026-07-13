-- 055_promo_settings.sql
-- ---------------------------------------------------------------------------
-- Governance for the Buy-2-Get-1-Free promo (054): a master switch, an
-- auto-expiring end date (LTO), and a per-SKU exclusion list — so the owner
-- can run it as a limited-time offer and pull specific compounds off it.
--
-- Single-row table (id is pinned to 1). Publicly READABLE so the storefront
-- can show "Limited time — ends <date>" messaging and hide the promo on
-- excluded/expired items; place-order (service role) reads it authoritatively
-- to decide whether to actually apply the discount. WRITES only through the
-- is_admin()-gated set_b2g1_promo() RPC (audit-logged), never direct.
--
-- Requires 054. Additive. Rollback: drop set_b2g1_promo; drop table promo_settings.
-- ---------------------------------------------------------------------------

create table if not exists promo_settings (
  id                 integer     primary key default 1 check (id = 1),
  b2g1_enabled       boolean     not null default true,
  -- null = no end date (runs until disabled); set = auto-off at this instant.
  b2g1_ends_at       timestamptz,
  -- SKUs pulled OFF the promo even while it's live.
  b2g1_excluded_skus text[]      not null default '{}',
  updated_at         timestamptz not null default now()
);

-- Seed the one row (default: enabled, no end date, nothing excluded).
insert into promo_settings (id) values (1) on conflict (id) do nothing;

alter table promo_settings enable row level security;

-- Public read — promo config is not sensitive and the storefront needs it.
drop policy if exists "Anyone reads promo settings" on promo_settings;
create policy "Anyone reads promo settings"
  on promo_settings for select using (true);

grant select on promo_settings to anon, authenticated;
-- No insert/update/delete policies → all writes go through the RPC below.

-- ── Admin writer — set the whole B2G1 config atomically ─────────────────────
create or replace function set_b2g1_promo(
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
     set b2g1_enabled       = coalesce(p_enabled, true),
         b2g1_ends_at       = p_ends_at,               -- null clears the end date
         b2g1_excluded_skus = coalesce(p_excluded_skus, '{}'),
         updated_at         = now()
   where id = 1
  returning * into v_row;

  perform log_audit(
    'promo.b2g1_updated', 'promo_settings', '1',
    format('B2G1 %s%s · %s excluded',
      case when v_row.b2g1_enabled then 'ON' else 'OFF' end,
      case when v_row.b2g1_ends_at is null then '' else ' · ends ' || v_row.b2g1_ends_at::text end,
      coalesce(array_length(v_row.b2g1_excluded_skus, 1), 0)
    ),
    null,
    to_jsonb(v_row),
    jsonb_build_object('source', 'admin_promo_panel')
  );

  return v_row;
end;
$$;

revoke execute on function set_b2g1_promo(boolean, timestamptz, text[]) from public, anon;
grant execute on function set_b2g1_promo(boolean, timestamptz, text[]) to authenticated;
